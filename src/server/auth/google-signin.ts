import "server-only";
import { decodeIdToken, generateCodeVerifier, generateState, Google } from "arctic";
import { safeEqual } from "../crypto";
import { env } from "../env";
import { consumeChallenge, createChallenge } from "./challenges";
import { safeNext } from "./safe-next";
import { HttpError, type SessionUser } from "./session";
import { findUserById, linkIdentity, resolveIdentityUser, type ExternalIdentity, type IdentityOutcome } from "./users";

/**
 * "Continue with Google" for signing in to the app itself. Deliberately only `openid email profile`:
 * mailbox access (Gmail scopes) is a separate, explicit flow when adding an account.
 */
const SCOPES = ["openid", "email", "profile"];
const ISSUERS = new Set(["https://accounts.google.com", "accounts.google.com"]);

export const GOOGLE_CALLBACK_PATH = "/api/auth/google/callback";

function client() {
  return new Google(env.googleClientId, env.googleClientSecret, `${env.appUrl}${GOOGLE_CALLBACK_PATH}`);
}

type GoogleChallengeData = { codeVerifier: string; next: string };

export async function startGoogleSignIn(input: { next?: string | null; linkUserId?: string | null }) {
  const state = generateState();
  const codeVerifier = generateCodeVerifier();
  const url = client().createAuthorizationURL(state, codeVerifier, SCOPES);
  url.searchParams.set("prompt", "select_account");
  const data: GoogleChallengeData = { codeVerifier, next: safeNext(input.next) };
  const token = await createChallenge({ kind: "google-signin", challenge: state, userId: input.linkUserId ?? null, data });
  return { url, token };
}

export interface GoogleClaims {
  sub: string;
  email: string;
  emailVerified: boolean;
  name?: string;
  picture?: string;
}

/**
 * The ID token comes straight from Google's token endpoint over TLS, so per OIDC Core §3.1.3.7 its
 * signature doesn't need checking; issuer, audience and expiry still do.
 */
export function parseGoogleIdToken(idToken: string, clientId: string, now = Date.now()): GoogleClaims {
  let claims: Record<string, unknown>;
  try {
    claims = decodeIdToken(idToken) as Record<string, unknown>;
  } catch {
    throw new HttpError(400, "Google sent back something we couldn't read.", "google_failed");
  }
  const aud = claims.aud;
  const audOk = aud === clientId || (Array.isArray(aud) && aud.includes(clientId));
  const exp = typeof claims.exp === "number" ? claims.exp * 1000 : 0;
  if (!ISSUERS.has(String(claims.iss)) || !audOk || exp <= now) {
    throw new HttpError(400, "Google sign-in couldn't be verified.", "google_failed");
  }
  if (typeof claims.sub !== "string" || !claims.sub || typeof claims.email !== "string" || !claims.email) {
    throw new HttpError(400, "Google didn't share an email address.", "google_failed");
  }
  return {
    sub: claims.sub,
    email: claims.email,
    emailVerified: claims.email_verified === true || claims.email_verified === "true",
    name: typeof claims.name === "string" ? claims.name : undefined,
    picture: typeof claims.picture === "string" ? claims.picture : undefined,
  };
}

export async function finishGoogleSignIn(input: {
  token: string | undefined;
  state: string | null;
  code: string | null;
}): Promise<{ user: SessionUser; outcome: IdentityOutcome; next: string }> {
  const c = await consumeChallenge<GoogleChallengeData>(input.token, "google-signin");
  if (!c || !input.state || !input.code || !safeEqual(input.state, c.challenge)) {
    throw new HttpError(400, "That sign-in link expired. Please try again.", "challenge_expired");
  }

  let idToken: string;
  try {
    const tokens = await client().validateAuthorizationCode(input.code, c.data.codeVerifier);
    idToken = tokens.idToken();
  } catch {
    throw new HttpError(400, "Google sign-in didn't go through. Please try again.", "google_failed");
  }
  const claims = parseGoogleIdToken(idToken, env.googleClientId);
  const identity: ExternalIdentity = {
    provider: "google",
    subject: claims.sub,
    email: claims.email,
    emailVerified: claims.emailVerified,
    name: claims.name,
    avatarUrl: claims.picture ?? null,
  };

  // "Connect Google" from inside the app: the challenge carries the signed-in user.
  if (c.userId) {
    await linkIdentity(c.userId, identity);
    const user = await findUserById(c.userId);
    if (!user) throw new HttpError(401, "Sign in to continue", "unauthenticated");
    return { user, outcome: "linked", next: c.data.next };
  }

  const { user, outcome } = await resolveIdentityUser(identity);
  return { user, outcome, next: c.data.next };
}
