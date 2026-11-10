import { z } from "zod";
import { tk } from "@/lib/i18n";
import { assertSameOrigin, handle, readJson, userAgent } from "@/server/auth/http";
import { createSession, HttpError } from "@/server/auth/session";
import { peekSetupLink, redeemSetupLink } from "@/server/auth/setup-link";
import { db, schema } from "@/server/db";
import { eq } from "drizzle-orm";
import { env } from "@/server/env";

const body = z.object({
  token: z.string().min(20).max(200),
  peek: z.boolean().optional(),
  details: z
    .object({
      name: z.string().trim().min(1, { error: tk("Your name") }).max(80, { error: tk("That name is a little long") }),
      email: z.string().trim().email({ error: tk("That doesn't look like an email address") }).max(320),
    })
    .optional(),
});

/** The link from `kolbaba-link`: what it's for (`peek`), then using it (src/server/auth/setup-link.ts). Self-hosted copies only. */
export const POST = handle(async (req: Request) => {
  if (!env.selfHosted) throw new HttpError(404, "Not found", "not_found");
  assertSameOrigin(req);
  const { token, peek, details } = await readJson(req, body);
  if (peek) return Response.json(await peekSetupLink(token), { headers: { "Cache-Control": "no-store" } });
  const user = await redeemSetupLink(token, details);
  await createSession(user.id, userAgent(req));
  const [passkey] = await db().select({ id: schema.passkeys.id }).from(schema.passkeys).where(eq(schema.passkeys.userId, user.id)).limit(1);
  return Response.json({ user, hasPasskey: !!passkey }, { headers: { "Cache-Control": "no-store" } });
});
