import { after } from "next/server";
import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { pathCookie, SECURE_COOKIES } from "@/server/auth/cookie-name";
import { translate } from "@/lib/i18n";
import { consumeChallenge } from "@/server/auth/challenges";
import { getUser } from "@/server/auth/session";
import { db, schema } from "@/server/db";
import { requestLocale } from "@/server/i18n";
import { upsertAccount } from "@/server/mail/accounts";
import { MailAuthError } from "@/server/mail/types";
import { adminConsentUrl, exchangeMicrosoftCode, IMAP_HOST, MicrosoftTokenError, smtpHost } from "@/server/microsoft";
import { loadAccount, syncAccount } from "@/server/sync/engine";
import { hasWorker, nudgeWorker } from "@/server/worker-client";
import { logWarn } from "@/server/log";

export const maxDuration = 300;

const COOKIE = pathCookie("kolbaba_mailbox_oauth");

/** Microsoft's "the organisation must approve it first" answers (AADSTS65001, AADSTS90094…). */
const needsAdmin = (description: string | null) => !!description && /AADSTS(65001|90094|900941)/.test(description);

/**
 * Back from Microsoft: store the refresh token (sealed), start the first sync, return to the app. Also
 * where an organisation's IT admin lands after approving Kolbaba for everyone there.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const locale = requestLocale(req);
  const back = (params: Record<string, string>) => Response.redirect(new URL(`/?${new URLSearchParams(params)}`, req.url), 303);

  // The IT admin approved Kolbaba for their organisation (adminconsent comes back without a code).
  if (url.searchParams.has("admin_consent")) {
    return back(
      url.searchParams.get("admin_consent") === "True"
        ? { connect_notice: translate(locale, "Approved for your organisation. People there can connect their mailboxes now.") }
        : { connect_error: translate(locale, "The approval didn't go through. Try again.") },
    );
  }

  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  jar.set(COOKIE, "", { path: "/api/accounts/microsoft", maxAge: 0, secure: SECURE_COOKIES });

  const user = await getUser();
  if (!user) return Response.redirect(new URL("/login", req.url), 303);
  const error = url.searchParams.get("error");
  if (error) {
    if (needsAdmin(url.searchParams.get("error_description"))) return back({ connect_admin: adminConsentUrl() });
    return back({ connect_error: translate(locale, "Microsoft sign-in was cancelled") });
  }

  const challenge = await consumeChallenge<{ codeVerifier: string }>(token, "mailbox-oauth");
  const code = url.searchParams.get("code");
  if (!challenge || challenge.userId !== user.id || challenge.challenge !== url.searchParams.get("state") || !code) {
    return back({ connect_error: translate(locale, "That took too long. Please try again.") });
  }

  try {
    const grant = await exchangeMicrosoftCode(code, challenge.data.codeVerifier);
    const [me] = await db().select({ name: schema.users.name }).from(schema.users).where(eq(schema.users.id, user.id));
    const { id } = await upsertAccount({
      userId: user.id,
      provider: "imap",
      providerLabel: grant.personal ? "Outlook.com" : "Microsoft 365",
      email: grant.email,
      fromName: grant.name || me?.name || "",
      imap: { ...IMAP_HOST, username: grant.email },
      smtp: { ...smtpHost(grant.personal), username: grant.email },
      credentials: {
        kind: "oauth",
        issuer: "microsoft",
        refreshToken: grant.refreshToken,
        accessToken: grant.accessToken,
        expiresAt: grant.expiresAt,
        scope: grant.scope,
      },
    });
    if (hasWorker()) await nudgeWorker({ kind: "account-added", accountId: id });
    else
      after(async () => {
        const row = await loadAccount(id);
        if (row) await syncAccount(row).catch((err) => logWarn(`initial sync failed ${id}`, err));
      });
    return back({ connected: id });
  } catch (err) {
    logWarn("microsoft connect failed", err);
    if (err instanceof MicrosoftTokenError && err.needsAdmin) return back({ connect_admin: adminConsentUrl() });
    return back({
      connect_error: err instanceof MailAuthError ? translate(locale, err.text, err.vars) : translate(locale, "Couldn't connect the Microsoft mailbox. Please try again."),
    });
  }
}
