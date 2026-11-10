import { and, eq } from "drizzle-orm";
import { withUser } from "@/server/auth/session";
import { db, schema } from "@/server/db";
import { listAccounts, listDrafts } from "@/server/mail/service";
import { listSnippets } from "@/server/mail/snippets";
import { listFolders } from "@/server/mail/folders";
import { askNps } from "@/server/feedback";
import { isAdmin } from "@/server/admin";
import { hasBilling } from "@/server/billing";
import { env } from "@/server/env";
import { getPlus } from "@/server/plus";

/** Everything the app shell needs on launch, in one round trip. Threads load per folder afterwards. */
export const GET = withUser(async (user) => {
  const [accounts, drafts, snippets, folders, askForNps, [row], [google], plus, [passkey], vips] = await Promise.all([
    listAccounts(user.id),
    listDrafts(user.id),
    listSnippets(user.id),
    listFolders(user.id),
    askNps(user.id),
    db().select({ settings: schema.users.settings, createdAt: schema.users.createdAt }).from(schema.users).where(eq(schema.users.id, user.id)),
    // Signed in with Google: the welcome offers to connect that same Gmail right away.
    db()
      .select({ email: schema.identities.email })
      .from(schema.identities)
      .where(and(eq(schema.identities.userId, user.id), eq(schema.identities.provider, "google")))
      .limit(1),
    getPlus(user.id),
    db().select({ id: schema.passkeys.id }).from(schema.passkeys).where(eq(schema.passkeys.userId, user.id)).limit(1),
    db()
      .select({ emails: schema.contacts.emails })
      .from(schema.contacts)
      .where(and(eq(schema.contacts.userId, user.id), eq(schema.contacts.vip, true), eq(schema.contacts.hidden, false))),
  ]);
  return Response.json({ user: { ...user, googleEmail: google?.email ?? null, admin: isAdmin(user.email), since: row?.createdAt.getTime() ?? Date.now(), hasPasskey: !!passkey }, accounts, drafts, snippets, folders, askNps: askForNps, settings: row?.settings ?? {}, plus, billing: hasBilling(), selfHosted: env.selfHosted, ai: env.hasOpenAI, vips: vips.flatMap((v) => v.emails) });
});
