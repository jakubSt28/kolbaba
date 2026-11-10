import { after } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { translate } from "@/lib/i18n";
import { assertSameOrigin, readJson } from "@/server/auth/http";
import { withUser } from "@/server/auth/session";
import { detectMailSettings, testConnection } from "@/server/autodetect";
import { testBody } from "@/server/autodetect/schemas";
import { db, schema } from "@/server/db";
import { requestLocale } from "@/server/i18n";
import { upsertAccount } from "@/server/mail/accounts";
import { listAccounts } from "@/server/mail/service";
import { loadAccount, syncAccount } from "@/server/sync/engine";
import { hasWorker, nudgeWorker } from "@/server/worker-client";
import { logWarn } from "@/server/log";
import { clientIp, limit, LIMITS } from "@/server/rate-limit";

/** The first import can take a while; without a worker it runs here after the response. */
export const maxDuration = 300;

export const GET = withUser(async (user) => Response.json(await listAccounts(user.id)));

const createBody = testBody.extend({ name: z.string().trim().max(60).optional() });

/**
 * Connect an IMAP/SMTP mailbox with a password. Servers are detected when the client doesn't send
 * them, the login is verified before anything is stored, and the first sync starts right away.
 */
export const POST = withUser(async (user, req) => {
  assertSameOrigin(req);
  const { email, password, name, ...given } = await readJson(req, createBody);
  await limit(LIMITS.mailboxAdd(user.id), ...LIMITS.mailboxTest(user.id, clientIp(req)));
  const locale = requestLocale(req);
  const detected = given.imap && given.smtp ? null : await detectMailSettings(email, { locale });
  if (detected && (!detected.supported || detected.method !== "password")) {
    const message = detected.message ?? translate(locale, "This mailbox connects with Google sign-in.");
    return Response.json({ ok: false, reason: "unsupported", message }, { status: 400 });
  }
  const imap = given.imap ?? detected?.imap;
  const smtp = given.smtp ?? detected?.smtp;
  if (!imap || !smtp) {
    return Response.json(
      { ok: false, reason: "servers_unknown", message: translate(locale, "We couldn't find the mail servers for this address. Enter them below.") },
      { status: 400 },
    );
  }

  const result = await testConnection({ email, password, imap, smtp, locale });
  if (!result.ok) return Response.json(result, { status: 400 });

  const [me] = await db().select({ name: schema.users.name }).from(schema.users).where(eq(schema.users.id, user.id));
  const { id } = await upsertAccount({
    userId: user.id,
    provider: "imap",
    providerLabel: detected?.providerLabel ?? "",
    email,
    name,
    fromName: me?.name ?? "",
    imap: result.imap,
    smtp: result.smtp,
    credentials: { kind: "password", password },
  });

  if (hasWorker()) await nudgeWorker({ kind: "account-added", accountId: id });
  else
    after(async () => {
      const row = await loadAccount(id);
      if (row) await syncAccount(row).catch((err) => logWarn(`initial sync failed ${id}`, err));
    });

  const account = (await listAccounts(user.id)).find((a) => a.id === id);
  return Response.json({ ok: true, account });
});
