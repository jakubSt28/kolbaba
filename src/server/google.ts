import { decodeIdToken, Google, OAuth2RequestError, type OAuth2Tokens } from "arctic";
import { tk } from "@/lib/i18n";
import { env } from "./env";
import { MailAuthError } from "./mail/types";

/**
 * Google OAuth for connecting a Gmail *mailbox* (not for signing in to the app).
 *
 * The OAuth app must be switched to the "In production" publishing status: in "Testing" Google expires
 * refresh tokens after 7 days, which would silently disconnect every mailbox once a week. Gmail scopes
 * are "restricted", so production use beyond 100 users needs Google verification.
 */

export const GMAIL_MODIFY_SCOPE = "https://www.googleapis.com/auth/gmail.modify";

/**
 * `gmail.modify` alone covers reading, label changes, drafts and sending (everything except permanent
 * deletion, which we never do), so asking for `gmail.send` on top would only lengthen the consent screen.
 */
export const GMAIL_SCOPES = ["openid", "email", "profile", GMAIL_MODIFY_SCOPE];

/** The OAuth client with the one redirect address registered at Google; connecting a calendar goes through it too. */
export function googleClient() {
  return new Google(env.googleClientId, env.googleClientSecret, `${env.appUrl}/api/accounts/google/callback`);
}

export function gmailAuthUrl({
  state,
  codeVerifier,
  loginHint,
}: {
  state: string;
  codeVerifier: string;
  loginHint?: string;
}): URL {
  const url = googleClient().createAuthorizationURL(state, codeVerifier, GMAIL_SCOPES);
  // offline + consent: Google only returns a refresh token on the first consent unless we force it again.
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "true");
  if (loginHint) url.searchParams.set("login_hint", loginHint);
  return url;
}

export interface GmailGrant {
  refreshToken: string;
  accessToken: string;
  expiresAt: number;
  scope: string;
  email: string;
  name: string;
  picture: string | null;
}

export async function exchangeGmailCode(code: string, codeVerifier: string): Promise<GmailGrant> {
  const tokens = await googleClient().validateAuthorizationCode(code, codeVerifier);
  if (!tokens.hasRefreshToken()) throw new Error("Google returned no refresh token (prompt=consent missing?)");
  const scope = tokens.hasScopes() ? tokens.scopes().join(" ") : "";
  // Granular consent lets the user untick the Gmail checkbox; without it the mailbox is useless.
  if (!scope.split(" ").includes(GMAIL_MODIFY_SCOPE)) {
    throw new MailAuthError(tk("Gmail access wasn’t allowed. Try again and keep the Gmail checkbox ticked."), "scope_denied");
  }
  // The id_token comes straight from Google's token endpoint over TLS, so its signature needn't be checked.
  const claims = decodeIdToken(tokens.idToken()) as { email?: string; name?: string; picture?: string };
  if (!claims.email) throw new Error("Google id_token has no email (missing `email` scope?)");
  return {
    refreshToken: tokens.refreshToken(),
    accessToken: tokens.accessToken(),
    expiresAt: tokens.accessTokenExpiresAt().getTime(),
    scope,
    email: claims.email.toLowerCase(),
    name: claims.name ?? "",
    picture: claims.picture ?? null,
  };
}

export interface RefreshedToken {
  accessToken: string;
  expiresAt: number;
  scope?: string;
  /** Google normally keeps the refresh token; set only if it issued a new one. */
  refreshToken?: string;
}

export async function refreshAccessToken(refreshToken: string): Promise<RefreshedToken> {
  let tokens: OAuth2Tokens;
  try {
    tokens = await googleClient().refreshAccessToken(refreshToken);
  } catch (error) {
    // invalid_grant = revoked by the user, password change, or a "Testing" app's 7-day expiry.
    if (error instanceof OAuth2RequestError && error.code === "invalid_grant") {
      throw new MailAuthError(tk("Google access was revoked; reconnect the account"), "oauth_revoked");
    }
    throw error;
  }
  return {
    accessToken: tokens.accessToken(),
    expiresAt: tokens.accessTokenExpiresAt().getTime(),
    scope: tokens.hasScopes() ? tokens.scopes().join(" ") : undefined,
    refreshToken: tokens.hasRefreshToken() ? tokens.refreshToken() : undefined,
  };
}

/**
 * Drop Kolbaba's access at Google (a disconnected mailbox or a deleted account). Revoking the refresh
 * token ends the whole grant, so connecting again asks for consent again. Best effort: the token may
 * already be revoked (Google answers 400), and Google being slow mustn't block the disconnect.
 */
export async function revokeGoogleToken(token: string) {
  try {
    const res = await fetch("https://oauth2.googleapis.com/revoke", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok && res.status !== 400) console.warn(`Google revoke failed: HTTP ${res.status}`);
  } catch (err) {
    console.warn("Google revoke failed", (err as Error).message);
  }
}
