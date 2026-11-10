import { after } from "next/server";
import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { pathCookie, SECURE_COOKIES } from "@/server/auth/cookie-name";
import { translate } from "@/lib/i18n";
import { consumeChallenge } from "@/server/auth/challenges";
import { getUser } from "@/server/auth/session";
import { db, schema } from "@/server/db";
import { exchangeGmailCode } from "@/server/google";
import { requestLocale } from "@/server/i18n";
import { upsertAccount } from "@/server/mail/accounts";
import { MailAuthError } from "@/server/mail/types";
import { loadAccount, syncAccount } from "@/server/sync/engine";
import { hasWorker, nudgeWorker } from "@/server/worker-client";
import { logWarn } from "@/server/log";

export const maxDuration = 300;

const COOKIE = pathCookie("kolbaba_mailbox_oauth");

/** Back from Google: store the refresh token (sealed), start the first sync, return to the app. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const locale = requestLocale(req);
  const back = (params: Record<string, string>) => Response.redirect(new URL(`/?${new URLSearchParams(params)}`, req.url), 303);

  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  jar.set(COOKIE, "", { path: "/api/accounts/google", maxAge: 0, secure: SECURE_COOKIES });

  const user = await getUser();
  if (!user) return Response.redirect(new URL("/login", req.url), 303);
  if (url.searchParams.get("error")) return back({ connect_error: translate(locale, "Google sign-in was cancelled") });

  const challenge = await consumeChallenge<{ codeVerifier: string }>(token, "mailbox-oauth");
  const code = url.searchParams.get("code");
  if (!challenge || challenge.userId !== user.id || challenge.challenge !== url.searchParams.get("state") || !code) {
    return back({ connect_error: translate(locale, "That took too long. Please try again.") });
  }

  try {
    const tokens = await exchangeGmailCode(code, challenge.data.codeVerifier);
    const [me] = await db().select({ name: schema.users.name }).from(schema.users).where(eq(schema.users.id, user.id));
    const isWorkspace = !/@(gmail|googlemail)\.com$/i.test(tokens.email);
    const { id } = await upsertAccount({
      userId: user.id,
      provider: "gmail",
      providerLabel: isWorkspace ? "Google Workspace" : "Gmail",
      email: tokens.email,
      fromName: tokens.name || me?.name || "",
      credentials: {
        kind: "oauth",
        refreshToken: tokens.refreshToken,
        accessToken: tokens.accessToken,
        expiresAt: tokens.expiresAt,
        scope: tokens.scope,
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
    logWarn("gmail connect failed", err);
    return back({
      connect_error: err instanceof MailAuthError ? translate(locale, err.text, err.vars) : translate(locale, "Couldn't connect Gmail. Please try again."),
    });
  }
}
