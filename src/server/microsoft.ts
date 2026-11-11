import { createHash } from "node:crypto";
import { tk } from "@/lib/i18n";
import { env } from "./env";
import { MailAuthError } from "./mail/types";

/**
 * Microsoft sign-in for connecting an Outlook.com / Hotmail or Microsoft 365 *mailbox*. Microsoft no
 * longer lets mail apps in with a password, so it's OAuth (the "common" authority takes personal and
 * work accounts alike), then mail goes over the normal IMAP and SMTP with that token (XOAUTH2). Some
 * Microsoft 365 organisations turn SMTP off; then sending goes through Microsoft Graph instead.
 *
 * Free, no audit (unlike Gmail's), but: the app shows as "unverified" until Kolbaba is a verified
 * publisher, work accounts may need their IT admin to approve it once, and Outlook.com users may have
 * to turn IMAP on in Outlook's settings first. The app registration is described in CONTRIBUTING.md.
 */

const AUTHORITY = "https://login.microsoftonline.com/common/oauth2/v2.0";
/** Personal Microsoft accounts (Outlook.com, Hotmail) all live in this one tenant. */
export const PERSONAL_TENANT = "9188040d-6c67-4c5b-b112-36a304b66dad";

export const IMAP_SCOPE = "https://outlook.office.com/IMAP.AccessAsUser.All";
export const SMTP_SCOPE = "https://outlook.office.com/SMTP.Send";
/** Sending through Graph, for organisations that turned SMTP off. A token is for one resource, so it's asked for separately. */
export const GRAPH_SEND_SCOPE = "https://graph.microsoft.com/Mail.Send";
const BASE = ["openid", "email", "profile", "offline_access"];
/** The token the mailbox lives on: IMAP and SMTP at outlook.office.com. */
export const OUTLOOK_SCOPES = [IMAP_SCOPE, SMTP_SCOPE, "offline_access"];

export const IMAP_HOST = { host: "outlook.office365.com", port: 993, secure: true };
/** Work and school mailboxes send through Office 365's SMTP, personal ones (Outlook.com, Hotmail) through Outlook.com's. */
export const smtpHost = (personal: boolean) => ({ host: personal ? "smtp-mail.outlook.com" : "smtp.office365.com", port: 587, secure: false });

/** Connecting Outlook works once the app registration's id and secret are set. */
export const microsoftEnabled = () => !!process.env.MICROSOFT_CLIENT_ID && !!process.env.MICROSOFT_CLIENT_SECRET;

export const microsoftRedirectUri = () => `${env.appUrl}/api/accounts/microsoft/callback`;

const challenge = (verifier: string) => createHash("sha256").update(verifier).digest("base64url");

export function microsoftAuthUrl({ state, codeVerifier, loginHint }: { state: string; codeVerifier: string; loginHint?: string }): URL {
  const url = new URL(`${AUTHORITY}/authorize`);
  url.searchParams.set("client_id", env.microsoftClientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("response_mode", "query");
  url.searchParams.set("redirect_uri", microsoftRedirectUri());
  // Consent for both resources up front: the mailbox (IMAP, SMTP) and Graph's Mail.Send.
  url.searchParams.set("scope", [...BASE, IMAP_SCOPE, SMTP_SCOPE, GRAPH_SEND_SCOPE].join(" "));
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge(codeVerifier));
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("prompt", "select_account");
  if (loginHint) url.searchParams.set("login_hint", loginHint);
  return url;
}

/** The link an organisation's IT admin opens to approve Kolbaba for everyone there, once. */
export function adminConsentUrl() {
  const url = new URL("https://login.microsoftonline.com/organizations/v2.0/adminconsent");
  url.searchParams.set("client_id", env.microsoftClientId);
  url.searchParams.set("scope", [IMAP_SCOPE, SMTP_SCOPE, GRAPH_SEND_SCOPE].join(" "));
  url.searchParams.set("redirect_uri", microsoftRedirectUri());
  return url.toString();
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
  id_token?: string;
  error?: string;
  error_description?: string;
  error_codes?: number[];
}

/** One call to Microsoft's token endpoint (a code or a refresh token traded for tokens); calendars use it too. */
export async function microsoftToken(params: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(`${AUTHORITY}/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: env.microsoftClientId, client_secret: env.microsoftClientSecret, ...params }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await res.json().catch(() => ({}))) as TokenResponse;
  if (!res.ok || body.error) throw new MicrosoftTokenError(body.error ?? `http_${res.status}`, body.error_description ?? "", body.error_codes ?? []);
  return body;
}

export class MicrosoftTokenError extends Error {
  constructor(
    readonly code: string,
    readonly description: string,
    readonly codes: number[],
  ) {
    super(`${code}: ${description.split("\n")[0]}`);
  }
  /** The organisation hasn't approved the app (AADSTS65001 consent missing, AADSTS90094 admin approval needed). */
  get needsAdmin() {
    return this.codes.includes(90094) || this.codes.includes(65001) || /AADSTS(90094|65001|900941)/.test(this.description);
  }
}

export interface MicrosoftGrant {
  refreshToken: string;
  accessToken: string;
  expiresAt: number;
  scope: string;
  email: string;
  name: string;
  /** A personal account (Outlook.com, Hotmail), not a work or school one. */
  personal: boolean;
}

/** What the id_token says about the account. It comes straight from Microsoft's token endpoint over TLS. */
export function microsoftClaims(idToken: string | undefined): { email?: string; preferred_username?: string; name?: string; tid?: string } {
  if (!idToken) return {};
  try {
    return JSON.parse(Buffer.from(idToken.split(".")[1], "base64url").toString("utf8"));
  } catch {
    return {};
  }
}

export async function exchangeMicrosoftCode(code: string, codeVerifier: string): Promise<MicrosoftGrant> {
  const res = await microsoftToken({
    grant_type: "authorization_code",
    code,
    redirect_uri: microsoftRedirectUri(),
    code_verifier: codeVerifier,
    scope: [...BASE, IMAP_SCOPE, SMTP_SCOPE].join(" "),
  });
  if (!res.refresh_token) throw new Error("Microsoft returned no refresh token (offline_access missing?)");
  const scope = res.scope ?? "";
  if (!scope.split(" ").some((s) => s.endsWith("IMAP.AccessAsUser.All"))) {
    throw new MailAuthError(tk("Mail access wasn't allowed. Try again and allow everything Kolbaba asks for."), "scope_denied");
  }
  const c = microsoftClaims(res.id_token);
  const email = (c.email ?? c.preferred_username ?? "").toLowerCase();
  if (!email.includes("@")) throw new Error("Microsoft id_token has no email address");
  return {
    refreshToken: res.refresh_token,
    accessToken: res.access_token,
    expiresAt: Date.now() + res.expires_in * 1000,
    scope,
    email,
    name: c.name ?? "",
    personal: c.tid === PERSONAL_TENANT,
  };
}

export interface MicrosoftToken {
  accessToken: string;
  expiresAt: number;
  /** Microsoft rotates refresh tokens: store the new one. */
  refreshToken?: string;
}

/** A fresh access token for `scopes` (the mailbox by default, or Graph for sending). */
export async function refreshMicrosoftToken(refreshToken: string, scopes: string[] = OUTLOOK_SCOPES): Promise<MicrosoftToken> {
  try {
    const res = await microsoftToken({ grant_type: "refresh_token", refresh_token: refreshToken, scope: scopes.join(" ") });
    return { accessToken: res.access_token, expiresAt: Date.now() + res.expires_in * 1000, refreshToken: res.refresh_token };
  } catch (err) {
    // invalid_grant: revoked, the password changed, or months unused. interaction_required: new consent or MFA.
    if (err instanceof MicrosoftTokenError && (err.code === "invalid_grant" || err.code === "interaction_required")) {
      throw new MailAuthError(tk("Microsoft access was revoked; reconnect the account"), "oauth_revoked");
    }
    throw err;
  }
}
