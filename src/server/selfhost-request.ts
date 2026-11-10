import { sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "./db";
import { env } from "./env";
import { limit, LIMITS } from "./rate-limit";
import { sendSystemEmail } from "./system-mail";

export const SelfHostRequestBody = z.object({
  email: z.string().trim().email().max(320),
  runsOn: z.enum(["vps", "home", "unsure"]),
  note: z.string().trim().max(2000).default(""),
  lang: z.enum(["en", "cs"]).default("en"),
  /** The ?ref= of the page. Anything odd in it just means no source, it never stops the form. */
  ref: z.string().trim().toLowerCase().regex(/^[a-z0-9_-]{1,40}$/).nullable().default(null).catch(null),
  /** A field people don't see: whatever fills it in is a bot. */
  website: z.string().max(500).default(""),
});

const RUNS_ON = { vps: "VPS", home: "Doma (NAS, počítač)", unsure: "Zatím neví" };

/**
 * Someone on kolbaba.app asks for help with running Kolbaba on their own server: it's kept for /admin and
 * lands in the team's inbox, where Reply goes to them. Nothing goes to the address they typed, so the form
 * can't be used to mail a stranger.
 */
export async function requestSelfHost(input: z.output<typeof SelfHostRequestBody>, ip: string) {
  const to = env.feedbackTo;
  if (input.website || !to) return;
  await limit(LIMITS.selfHostRequest(ip));
  const row = { runsOn: input.runsOn, note: input.note, lang: input.lang };
  await db()
    .insert(schema.waitlist)
    .values({ email: input.email.toLowerCase(), ref: input.ref, ...row })
    .onConflictDoUpdate({ target: schema.waitlist.email, set: { ...row, ref: sql`coalesce(${schema.waitlist.ref}, excluded.ref)` } });
  const lines = [input.email, `Kde to poběží: ${RUNS_ON[input.runsOn]}`, `Jazyk webu: ${input.lang}`, `Odkud: ${input.ref ?? "neznámo"}`, "", input.note || "(bez poznámky)"];
  await sendSystemEmail({ to, subject: `[Kolbaba] Pomoc s vlastním serverem: ${input.email}`, text: lines.join("\n"), replyTo: input.email });
}
