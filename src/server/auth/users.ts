import "server-only";
import { and, eq } from "drizzle-orm";
import { BRAND } from "@/lib/brand";
import { tk } from "@/lib/i18n";
import { db, schema } from "../db";
import { env } from "../env";
import { revokeProviderAccess } from "../mail/accounts";
import { HttpError, type SessionUser } from "./session";

/** `{app}` is the brand name. */
export const INVITE_ONLY_MESSAGE = tk("{app} is invite-only for now");

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

/**
 * Empty allowlist = open sign-up, except on a self-hosted copy: its server is private, so new accounts
 * come from a setup link (setup-link.ts) unless the owner lists who else may sign up. Entries are full
 * addresses (`daniel@example.com`) or whole domains written as `@example.com`.
 */
export function isSignupAllowed(email: string, allowlist: readonly string[] = env.signupAllowlist) {
  if (allowlist.length === 0) return !env.selfHosted;
  const normalized = normalizeEmail(email);
  const domain = normalized.slice(normalized.lastIndexOf("@"));
  return allowlist.some((entry) => {
    const e = normalizeEmail(entry);
    return e.startsWith("@") ? e === domain : e === normalized;
  });
}

export function assertSignupAllowed(email: string, allowlist?: readonly string[]) {
  if (!isSignupAllowed(email, allowlist)) throw new HttpError(403, INVITE_ONLY_MESSAGE, "invite_only", { app: BRAND.name });
}

const userColumns = {
  id: schema.users.id,
  email: schema.users.email,
  name: schema.users.name,
  avatarUrl: schema.users.avatarUrl,
};

/** Same shape as the schema's default id, so ids minted ahead of insert (WebAuthn user handles) look alike. */
export function newUserId() {
  return `usr_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

export async function findUserByEmail(email: string): Promise<SessionUser | null> {
  const [row] = await db().select(userColumns).from(schema.users).where(eq(schema.users.email, normalizeEmail(email))).limit(1);
  return row ?? null;
}

export async function findUserById(id: string): Promise<SessionUser | null> {
  const [row] = await db().select(userColumns).from(schema.users).where(eq(schema.users.id, id)).limit(1);
  return row ?? null;
}

export interface NewUser {
  id?: string;
  email: string;
  name?: string;
  avatarUrl?: string | null;
}

/** Creates a user, enforcing the sign-up allowlist. Fails with 409 if the email is taken. */
export async function createUser(input: NewUser, allowlist?: readonly string[]): Promise<SessionUser> {
  const email = normalizeEmail(input.email);
  assertSignupAllowed(email, allowlist);
  const [row] = await db()
    .insert(schema.users)
    .values({ id: input.id ?? newUserId(), email, name: input.name?.trim() ?? "", avatarUrl: input.avatarUrl ?? null })
    .onConflictDoNothing({ target: schema.users.email })
    .returning(userColumns);
  if (!row) throw new HttpError(409, "You already have an account. Sign in instead.", "account_exists");
  return row;
}

/** The user with this email, or a new one (subject to the allowlist). */
export async function findOrCreateUser(
  input: NewUser,
  allowlist?: readonly string[],
): Promise<{ user: SessionUser; created: boolean }> {
  const existing = await findUserByEmail(input.email);
  if (existing) return { user: existing, created: false };
  try {
    return { user: await createUser(input, allowlist), created: true };
  } catch (err) {
    // Lost a race with a parallel sign-up for the same address.
    if (err instanceof HttpError && err.code === "account_exists") {
      const user = await findUserByEmail(input.email);
      if (user) return { user, created: false };
    }
    throw err;
  }
}

export interface ExternalIdentity {
  provider: "google";
  /** Stable subject id from the provider (OIDC `sub`). */
  subject: string;
  email: string;
  emailVerified: boolean;
  name?: string;
  avatarUrl?: string | null;
}

export type IdentityOutcome = "signed-in" | "linked" | "created";

/**
 * Google sign-in: known identity → that user; otherwise link to the user with the same verified
 * email; otherwise create a new user (allowlist permitting).
 */
export async function resolveIdentityUser(
  identity: ExternalIdentity,
  allowlist?: readonly string[],
): Promise<{ user: SessionUser; outcome: IdentityOutcome }> {
  const email = normalizeEmail(identity.email);
  const [known] = await db()
    .select(userColumns)
    .from(schema.identities)
    .innerJoin(schema.users, eq(schema.users.id, schema.identities.userId))
    .where(and(eq(schema.identities.provider, identity.provider), eq(schema.identities.subject, identity.subject)))
    .limit(1);
  if (known) {
    await db()
      .update(schema.identities)
      .set({ email })
      .where(and(eq(schema.identities.provider, identity.provider), eq(schema.identities.subject, identity.subject)));
    return { user: known, outcome: "signed-in" };
  }

  if (!identity.emailVerified) {
    throw new HttpError(403, "Your Google account's email address isn't verified yet.", "email_unverified");
  }

  // Every account proved its address when it was made (Google, or a code by email), so the same
  // verified address at Google is the same person.
  const existing = await findUserByEmail(email);
  if (existing) {
    await linkIdentity(existing.id, identity);
    return { user: existing, outcome: "linked" };
  }

  const { user, created } = await findOrCreateUser(
    { email, name: identity.name, avatarUrl: identity.avatarUrl ?? null },
    allowlist,
  );
  await linkIdentity(user.id, identity);
  return { user, outcome: created ? "created" : "linked" };
}

/** Attach an external identity to a user (also used by "Connect Google" from inside the app). */
export async function linkIdentity(userId: string, identity: ExternalIdentity) {
  const [row] = await db()
    .insert(schema.identities)
    .values({ provider: identity.provider, subject: identity.subject, userId, email: normalizeEmail(identity.email) })
    .onConflictDoNothing()
    .returning({ userId: schema.identities.userId });
  if (row) return;
  const [current] = await db()
    .select({ userId: schema.identities.userId })
    .from(schema.identities)
    .where(and(eq(schema.identities.provider, identity.provider), eq(schema.identities.subject, identity.subject)))
    .limit(1);
  if (current && current.userId !== userId) {
    throw new HttpError(409, "This Google account is already connected to another {app} account.", "identity_taken", { app: BRAND.name });
  }
}

/**
 * Delete an account and everything in it (every table cascades from users), then drop Gmail access
 * at Google. Mail at the providers is never touched. Returns the removed mailbox ids for the worker.
 */
export async function deleteUser(userId: string): Promise<string[]> {
  const mailboxes = await db()
    .select({ id: schema.accounts.id, provider: schema.accounts.provider, email: schema.accounts.email, credentials: schema.accounts.credentials })
    .from(schema.accounts)
    .where(eq(schema.accounts.userId, userId));
  await db().delete(schema.users).where(eq(schema.users.id, userId));
  for (const row of mailboxes) await revokeProviderAccess(row);
  return mailboxes.map((m) => m.id);
}
