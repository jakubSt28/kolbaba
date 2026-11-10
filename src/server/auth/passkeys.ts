import "server-only";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransport,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
  type VerifiedRegistrationResponse,
} from "@simplewebauthn/server";
import { eq } from "drizzle-orm";
import { BRAND } from "@/lib/brand";
import { db, schema } from "../db";
import { env } from "../env";
import { consumeChallenge, createChallenge } from "./challenges";
import { HttpError, type SessionUser } from "./session";

/* ------------------------------ Relying party ------------------------------ */

export interface RelyingParty {
  /** Registrable domain the passkeys are bound to (no scheme, no port). */
  id: string;
  name: string;
  /** Exact origin the browser reports in clientDataJSON. */
  origin: string;
}

/**
 * Derived from APP_URL. In development any `localhost` origin is accepted as-is, so a dev server on
 * another port (3105, 3210…) works without changing APP_URL. Passkeys never work on bare IPs.
 */
export function relyingParty(requestOrigin?: string | null, appUrl: string = env.appUrl, dev = process.env.NODE_ENV !== "production"): RelyingParty {
  if (dev && requestOrigin) {
    try {
      const o = new URL(requestOrigin);
      if (o.hostname === "localhost" || o.hostname.endsWith(".localhost")) {
        return { id: o.hostname, name: BRAND.name, origin: o.origin };
      }
    } catch {
      // fall through to APP_URL
    }
  }
  const app = new URL(appUrl);
  return { id: app.hostname, name: BRAND.name, origin: app.origin };
}

/* --------------------------------- Labels ---------------------------------- */

/** A friendly name for the device a passkey was created on, shown in settings. */
export function passkeyLabel(userAgent: string | null | undefined): string {
  const ua = userAgent ?? "";
  if (/iPhone/i.test(ua)) return "iPhone";
  if (/iPad/i.test(ua)) return "iPad";
  if (/Android/i.test(ua)) return /Mobile/i.test(ua) ? "Android phone" : "Android tablet";
  if (/CrOS/.test(ua)) return "Chromebook";
  // iPadOS Safari pretends to be a Mac; there's no reliable way to tell them apart server-side.
  if (/Macintosh|Mac OS X/i.test(ua)) return "Mac";
  if (/Windows/i.test(ua)) return "Windows PC";
  if (/Linux|X11/i.test(ua)) return "Linux PC";
  return "Passkey";
}

/* --------------------------------- Helpers --------------------------------- */

/**
 * Passkeys are an optional, faster way in, added from inside the app (Settings, or the offer after
 * signing in with a code). Accounts are created with Google or a code by email, which prove the
 * address; a passkey is never the only way in.
 */
type RegisterData = { mode: "add" };

const EXPIRED = () => new HttpError(400, "That took a little too long. Please try again.", "challenge_expired");
const INVALID = () => new HttpError(400, "We couldn't verify that passkey. Please try again.", "passkey_invalid");

const toBytes = (s: string) => new TextEncoder().encode(s);
const b64url = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");
const fromB64url = (s: string) => new Uint8Array(Buffer.from(s, "base64url"));

async function registrationOptions(rp: RelyingParty, user: { id: string; email: string; name: string }, exclude: { id: string; transports: string[] }[] = []) {
  return generateRegistrationOptions({
    rpName: rp.name,
    rpID: rp.id,
    userName: user.email,
    userID: toBytes(user.id),
    userDisplayName: user.name || user.email,
    attestationType: "none",
    excludeCredentials: exclude,
    authenticatorSelection: { residentKey: "required", userVerification: "required" },
  });
}

async function verifyRegistration(response: RegistrationResponseJSON, challenge: string, rp: RelyingParty) {
  let result: VerifiedRegistrationResponse;
  try {
    result = await verifyRegistrationResponse({
      response,
      expectedChallenge: challenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.id,
      // Face ID, Touch ID or a PIN every time: a security key without a PIN isn't enough on its own.
      requireUserVerification: true,
    });
  } catch {
    throw INVALID();
  }
  if (!result.verified) throw INVALID();
  return result.registrationInfo;
}

async function savePasskey(
  userId: string,
  info: NonNullable<VerifiedRegistrationResponse["registrationInfo"]>,
  response: RegistrationResponseJSON,
  userAgent: string | null | undefined,
) {
  const [row] = await db()
    .insert(schema.passkeys)
    .values({
      id: info.credential.id,
      userId,
      publicKey: b64url(info.credential.publicKey),
      counter: info.credential.counter,
      transports: response.response.transports ?? info.credential.transports ?? [],
      deviceType: info.credentialDeviceType,
      backedUp: info.credentialBackedUp,
      label: passkeyLabel(userAgent),
    })
    .onConflictDoNothing()
    .returning({ id: schema.passkeys.id, label: schema.passkeys.label, createdAt: schema.passkeys.createdAt });
  if (!row) throw new HttpError(409, "This passkey is already registered.", "passkey_exists");
  return row;
}

/* --------------------------------- Sign in --------------------------------- */

export async function startPasskeyLogin(rp: RelyingParty): Promise<{ options: PublicKeyCredentialRequestOptionsJSON; token: string }> {
  // No allowCredentials: discoverable credentials, so the user doesn't type anything.
  const options = await generateAuthenticationOptions({ rpID: rp.id, userVerification: "required" });
  const token = await createChallenge({ kind: "passkey-login", challenge: options.challenge });
  return { options, token };
}

export async function finishPasskeyLogin(input: {
  token: string | undefined;
  response: AuthenticationResponseJSON;
  rp: RelyingParty;
}): Promise<SessionUser> {
  const c = await consumeChallenge(input.token, "passkey-login");
  if (!c) throw EXPIRED();
  return verifyAssertion(c.challenge, input.response, input.rp);
}

/** Checks a passkey assertion against a challenge, bumps the counter, returns whose passkey it was. */
async function verifyAssertion(challenge: string, response: AuthenticationResponseJSON, rp: RelyingParty): Promise<SessionUser> {
  const input = { response, rp };
  const [row] = await db()
    .select({
      passkey: schema.passkeys,
      user: { id: schema.users.id, email: schema.users.email, name: schema.users.name, avatarUrl: schema.users.avatarUrl },
    })
    .from(schema.passkeys)
    .innerJoin(schema.users, eq(schema.users.id, schema.passkeys.userId))
    .where(eq(schema.passkeys.id, input.response.id))
    .limit(1);
  if (!row) {
    throw new HttpError(404, "This passkey isn't registered with {app} anymore.", "unknown_credential", { app: BRAND.name });
  }

  // Discoverable credentials return the user handle we minted at registration (our user id).
  const handle = input.response.response.userHandle;
  if (handle && Buffer.from(handle, "base64url").toString("utf8") !== row.user.id) throw INVALID();

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response: input.response,
      expectedChallenge: challenge,
      expectedOrigin: input.rp.origin,
      expectedRPID: input.rp.id,
      credential: {
        id: row.passkey.id,
        publicKey: fromB64url(row.passkey.publicKey),
        counter: row.passkey.counter,
        transports: row.passkey.transports,
      },
      requireUserVerification: true,
    });
  } catch {
    throw INVALID();
  }
  if (!verification.verified) throw INVALID();

  const info = verification.authenticationInfo;
  await db()
    .update(schema.passkeys)
    .set({
      counter: info.newCounter,
      lastUsedAt: new Date(),
      backedUp: info.credentialBackedUp,
      deviceType: info.credentialDeviceType,
    })
    .where(eq(schema.passkeys.id, row.passkey.id));
  return row.user;
}

/* ------------------------- Confirm it's you (signed in) ------------------------- */

/** Before something irreversible (deleting the account): one of this user's own passkeys, right now. */
export async function startReauth(user: SessionUser, rp: RelyingParty) {
  const own = await db()
    .select({ id: schema.passkeys.id, transports: schema.passkeys.transports })
    .from(schema.passkeys)
    .where(eq(schema.passkeys.userId, user.id));
  if (!own.length) throw new HttpError(400, "There's no passkey on this account.", "no_passkey");
  const options = await generateAuthenticationOptions({
    rpID: rp.id,
    userVerification: "required",
    allowCredentials: own.map((p) => ({ id: p.id, transports: p.transports as AuthenticatorTransport[] })),
  });
  const token = await createChallenge({ kind: "reauth", challenge: options.challenge, userId: user.id });
  return { options, token };
}

export async function finishReauth(input: { user: SessionUser; token: string | undefined; response: AuthenticationResponseJSON; rp: RelyingParty }) {
  const c = await consumeChallenge(input.token, "reauth");
  if (!c || c.userId !== input.user.id) throw EXPIRED();
  const who = await verifyAssertion(c.challenge, input.response, input.rp);
  if (who.id !== input.user.id) throw INVALID();
}

/* ------------------------ Add a passkey (signed in) ------------------------ */

export async function startAddPasskey(user: SessionUser, rp: RelyingParty) {
  const existing = await db()
    .select({ id: schema.passkeys.id, transports: schema.passkeys.transports })
    .from(schema.passkeys)
    .where(eq(schema.passkeys.userId, user.id));
  const options = await registrationOptions(rp, user, existing);
  const data: RegisterData = { mode: "add" };
  const token = await createChallenge({ kind: "passkey-register", challenge: options.challenge, userId: user.id, data });
  return { options, token };
}

export async function finishAddPasskey(input: {
  user: SessionUser;
  token: string | undefined;
  response: RegistrationResponseJSON;
  rp: RelyingParty;
  userAgent?: string | null;
}) {
  const c = await consumeChallenge<RegisterData>(input.token, "passkey-register");
  if (!c || c.data.mode !== "add" || c.userId !== input.user.id) throw EXPIRED();
  const info = await verifyRegistration(input.response, c.challenge, input.rp);
  return savePasskey(input.user.id, info, input.response, input.userAgent);
}
