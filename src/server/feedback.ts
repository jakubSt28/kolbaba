import { eq } from "drizzle-orm";
import { z } from "zod";
import type { Locale } from "@/lib/i18n";
import { browserName } from "./auth/devices";
import { passkeyLabel } from "./auth/passkeys";
import { db, schema } from "./db";
import { env } from "./env";
import { HttpError } from "./http-error";
import { logWarn } from "./log";
import { limit, LIMITS } from "./rate-limit";
import { sendSystemEmail } from "./system-mail";

/** Ask the 0–10 question once someone has used the app for a week, and then at most every three months. */
const NPS_AFTER_MS = 7 * 24 * 3600_000;
const NPS_EVERY_MS = 90 * 24 * 3600_000;

export const FeedbackBody = z.object({
  kind: z.enum(["nps", "idea"]),
  score: z.number().int().min(0).max(10).optional(),
  text: z.string().trim().max(5000).default(""),
  contact: z.boolean().default(false),
});

export async function askNps(userId: string): Promise<boolean> {
  if (env.selfHosted) return false;
  const [u] = await db().select({ createdAt: schema.users.createdAt, settings: schema.users.settings }).from(schema.users).where(eq(schema.users.id, userId));
  if (!u) return false;
  const now = Date.now();
  return now - u.createdAt.getTime() > NPS_AFTER_MS && now - (u.settings.npsAskedAt ?? 0) > NPS_EVERY_MS;
}

/** The question was shown (answered or dismissed): don't ask again for a while. */
export async function npsSeen(userId: string) {
  const [u] = await db().select({ settings: schema.users.settings }).from(schema.users).where(eq(schema.users.id, userId));
  if (u) await db().update(schema.users).set({ settings: { ...u.settings, npsAskedAt: Date.now() } }).where(eq(schema.users.id, userId));
}

export async function saveFeedback(
  user: { id: string; email: string; name: string },
  input: z.output<typeof FeedbackBody>,
  meta: { locale: Locale; userAgent: string | null },
) {
  await limit(LIMITS.feedback(user.id));
  if (input.kind === "nps" && input.score === undefined) throw new HttpError(400, "Invalid request", "bad_request");
  if (input.kind === "idea" && !input.text) throw new HttpError(400, "Write what would help you", "empty");
  const device = [passkeyLabel(meta.userAgent), browserName(meta.userAgent)].filter((x) => x && x !== "Passkey").join(" · ") || null;
  await db()
    .insert(schema.feedback)
    .values({ userId: user.id, kind: input.kind, score: input.score ?? null, text: input.text, contact: input.contact, locale: meta.locale, device });
  if (input.kind === "nps") await npsSeen(user.id);

  // A copy lands in the team's inbox; Reply goes to the user only if they said that's fine.
  const subject =
    input.kind === "nps"
      ? `[Kolbaba] NPS ${input.score ?? "–"}${input.text ? `: ${input.text.slice(0, 60)}` : ""}`
      : `[Kolbaba] Nápad: ${input.text.slice(0, 70) || "(bez textu)"}`;
  const lines = [
    input.kind === "nps" ? `Skóre: ${input.score ?? "–"} / 10` : "Návrh na vylepšení",
    "",
    input.text || "(bez textu)",
    "",
    `Od: ${user.name ? `${user.name} <${user.email}>` : user.email}${input.contact ? " (můžeme odpovědět)" : " (nechce odpověď)"}`,
    `Jazyk: ${meta.locale}${device ? ` · ${device}` : ""}`,
  ];
  const to = env.feedbackTo;
  if (!to) return;
  await sendSystemEmail({ to, subject, text: lines.join("\n"), ...(input.contact ? { replyTo: user.email } : {}) }).catch((err) =>
    logWarn("[feedback] email failed", err),
  );
}
