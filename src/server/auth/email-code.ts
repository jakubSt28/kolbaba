import "server-only";
import { randomInt } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import { BRAND } from "@/lib/brand";
import { translate, type Locale } from "@/lib/i18n";
import { hashToken, hmac, safeEqual } from "../crypto";
import { db, schema } from "../db";
import { HttpError } from "../http-error";
import { limit, LIMITS } from "../rate-limit";
import { sendSystemEmail, simpleEmailHtml } from "../system-mail";
import { createChallenge, type ChallengeKind } from "./challenges";
import type { SessionUser } from "./session";
import { assertSignupAllowed, findOrCreateUser, findUserByEmail, normalizeEmail } from "./users";

/**
 * A 6-digit code by email: the way in for everyone who doesn't use Google or a passkey, the way back
 * for anyone who lost their passkey, and the "confirm it's you" before deleting the account. The
 * browser keeps an opaque token in an httpOnly cookie; only the code's hash is stored, wrong guesses
 * are limited per address, and a code works once.
 *
 * Signing in and signing up are the same steps: typed back, a code signs in the account with that
 * address, or (for a new address) lets this browser create one. Whether an address has an account
 * is only told to someone who proved they own it.
 */

export const EMAIL_CODE_TTL_MS = 15 * 60_000;

type CodeData = { email: string; verified?: boolean };

/** Keyed with our secret: a million possible codes would be quick to try against a plain hash. */
const codeHash = (email: string, code: string) => hmac(`${email}:${code}`);
const EXPIRED = () => new HttpError(400, "That code expired. Ask for a new one.", "code_expired");
const WRONG = () => new HttpError(400, "That code isn't right. Check the email and try again.", "wrong_code");

async function mailCode(input: { to: string; code: string; locale: Locale; purpose: "sign-in" | "sign-up" | "confirm" }) {
  const shown = `${input.code.slice(0, 3)} ${input.code.slice(3)}`;
  const l = input.locale;
  const app = { app: BRAND.name };
  const intro =
    input.purpose === "sign-in"
      ? translate(l, "Your code for signing in to {app}:", app)
      : input.purpose === "sign-up"
        ? translate(l, "Your code for creating a {app} account:", app)
        : translate(l, "Your code for deleting your {app} account:", app);
  const heading =
    input.purpose === "sign-in" ? translate(l, "Sign in to {app}", app) : input.purpose === "sign-up" ? translate(l, "Confirm your email") : translate(l, "Confirm it's you");
  const footer = translate(l, "It works for 15 minutes. If you didn't ask for it, ignore this email.");
  await sendSystemEmail({
    to: input.to,
    subject: translate(l, "{code} is your {app} code", { code: shown, ...app }),
    text: [intro, "", shown, "", footer].join("\n"),
    html: simpleEmailHtml({ heading, lines: [intro], code: shown, footer }),
  });
}

const newCode = () => String(randomInt(0, 1_000_000)).padStart(6, "0");

/** Sign in or sign up: a code to the address. The answer is the same whether it has an account or not. */
export async function sendEmailCode(input: { email: string; ip: string; locale: Locale }): Promise<string> {
  const email = normalizeEmail(input.email);
  await limit(LIMITS.emailCodes(input.ip), LIMITS.emailCodesTo(email));
  const existing = await findUserByEmail(email);
  if (!existing) assertSignupAllowed(email);
  const code = newCode();
  const token = await createChallenge({ kind: "email-verify", challenge: codeHash(email, code), data: { email } satisfies CodeData, ttlMs: EMAIL_CODE_TTL_MS });
  await mailCode({ to: email, code, locale: input.locale, purpose: existing ? "sign-in" : "sign-up" });
  return token;
}

async function load(token: string | undefined, kind: ChallengeKind) {
  if (!token) return null;
  const [row] = await db()
    .select()
    .from(schema.authChallenges)
    .where(and(eq(schema.authChallenges.id, hashToken(token)), eq(schema.authChallenges.kind, kind), gt(schema.authChallenges.expiresAt, new Date())));
  return row ?? null;
}

const forget = (id: string) => db().delete(schema.authChallenges).where(eq(schema.authChallenges.id, id));

/**
 * Checks a typed code. The address's account, if it has one (the code is used up: sign them in);
 * otherwise `null`, and this browser may now create the account (createAccountWithCode).
 */
export async function verifyEmailCode(token: string | undefined, code: string): Promise<{ email: string; user: SessionUser | null }> {
  const row = await load(token, "email-verify");
  if (!row) throw EXPIRED();
  const data = row.data as CodeData;
  await limit(LIMITS.codeAttempts(data.email));
  if (!safeEqual(row.challenge, codeHash(data.email, code.replace(/\D/g, "")))) throw WRONG();
  const user = await findUserByEmail(data.email);
  if (user) {
    await forget(row.id);
    return { email: data.email, user };
  }
  await db()
    .update(schema.authChallenges)
    .set({ data: { ...data, verified: true } })
    .where(eq(schema.authChallenges.id, row.id));
  return { email: data.email, user: null };
}

/** After a code for a new address: the account (or the one that appeared meanwhile, e.g. through Google with that address). */
export async function createAccountWithCode(token: string | undefined, name: string): Promise<SessionUser> {
  const row = await load(token, "email-verify");
  const data = row?.data as CodeData | undefined;
  if (!row || !data?.verified) throw new HttpError(400, "Confirm your email address first.", "email_unconfirmed");
  const { user } = await findOrCreateUser({ email: data.email, name });
  await forget(row.id);
  return user;
}

/* ------------------------- Confirm it's you (signed in) ------------------------- */

/** Before deleting the account, without a passkey: a code to the account's own address. */
export async function sendConfirmCode(user: SessionUser, locale: Locale): Promise<string> {
  await limit(LIMITS.emailCodesTo(user.email));
  const code = newCode();
  const token = await createChallenge({ kind: "reauth", challenge: codeHash(user.email, code), userId: user.id, data: { email: user.email } satisfies CodeData, ttlMs: EMAIL_CODE_TTL_MS });
  await mailCode({ to: user.email, code, locale, purpose: "confirm" });
  return token;
}

export async function verifyConfirmCode(user: SessionUser, token: string | undefined, code: string) {
  const row = await load(token, "reauth");
  if (!row || row.userId !== user.id) throw EXPIRED();
  await limit(LIMITS.codeAttempts(user.email));
  if (!safeEqual(row.challenge, codeHash(user.email, code.replace(/\D/g, "")))) throw WRONG();
  await forget(row.id);
}
