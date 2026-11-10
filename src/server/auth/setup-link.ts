import "server-only";
import { and, eq, gt } from "drizzle-orm";
import { hashToken } from "../crypto";
import { db, schema } from "../db";
import { HttpError } from "../http-error";
import type { SessionUser } from "./session";
import { createUser, findUserByEmail, findUserById, normalizeEmail } from "./users";

/**
 * On a self-hosted copy the way in that doesn't depend on anything else: its owner runs `kolbaba-link` on
 * the server (worker/login-link.ts), and the link it prints either creates an account or signs in the one
 * it was made for. Whoever can run that already holds the server. A link works once and for an hour, and
 * the first account can't be claimed without one, so nobody who just finds the address can take it over.
 */

export type SetupLinkData = { userId?: string };

const NOT_VALID = () => new HttpError(400, "This link has expired or was already used. Make a new one on your server.", "setup_link_invalid");

async function load(token: string) {
  const [row] = await db()
    .select()
    .from(schema.authChallenges)
    .where(and(eq(schema.authChallenges.id, hashToken(token)), eq(schema.authChallenges.kind, "setup-link"), gt(schema.authChallenges.expiresAt, new Date())));
  return row ?? null;
}

/** What the link is for, without using it up: a link preview or a reload must not spend it. */
export async function peekSetupLink(token: string): Promise<{ mode: "new" } | { mode: "sign-in"; email: string }> {
  const row = await load(token);
  if (!row) throw NOT_VALID();
  const { userId } = row.data as SetupLinkData;
  if (!userId) return { mode: "new" };
  const user = await findUserById(userId);
  if (!user) throw NOT_VALID();
  return { mode: "sign-in", email: user.email };
}

/**
 * Uses the link up. Single use: the row goes in the statement that reads it, so of two racing requests
 * only one gets anywhere. A new account takes the name and address the person typed (`details`).
 */
export async function redeemSetupLink(token: string, details?: { email: string; name: string }): Promise<SessionUser> {
  const peeked = await peekSetupLink(token);
  if (peeked.mode === "new") {
    if (!details) throw NOT_VALID();
    const email = normalizeEmail(details.email);
    // Checked before spending the link, so a mistyped address can be corrected and tried again.
    if (await findUserByEmail(email)) throw new HttpError(409, "You already have an account. Sign in instead.", "account_exists");
  }
  const [row] = await db().delete(schema.authChallenges).where(eq(schema.authChallenges.id, hashToken(token))).returning();
  if (!row) throw NOT_VALID();
  const { userId } = row.data as SetupLinkData;
  if (userId) {
    const user = await findUserById(userId);
    if (!user) throw NOT_VALID();
    return user;
  }
  const email = normalizeEmail(details!.email);
  return createUser({ email, name: details!.name }, [email]);
}
