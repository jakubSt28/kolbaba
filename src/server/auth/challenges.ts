import "server-only";
import { and, eq, lt } from "drizzle-orm";
import { hashToken, randomToken } from "../crypto";
import { db, schema } from "../db";

export type ChallengeKind = (typeof schema.authChallenges.$inferSelect)["kind"];

/** WebAuthn ceremonies and the Google round trip must finish within this window. */
export const CHALLENGE_TTL_MS = 5 * 60 * 1000;

export interface StoredChallenge<D extends Record<string, unknown> = Record<string, unknown>> {
  kind: ChallengeKind;
  challenge: string;
  userId: string | null;
  data: D;
}

/**
 * Persist a short-lived challenge and return the opaque token that goes into an httpOnly cookie.
 * Only the token's hash is stored, so a leaked table can't be used to finish someone's ceremony.
 */
export async function createChallenge(input: {
  kind: ChallengeKind;
  challenge: string;
  userId?: string | null;
  data?: Record<string, unknown>;
  ttlMs?: number;
  now?: Date;
}): Promise<string> {
  const now = input.now ?? new Date();
  const token = randomToken();
  // Opportunistic cleanup keeps the table tiny without a cron job.
  await db().delete(schema.authChallenges).where(lt(schema.authChallenges.expiresAt, now));
  await db()
    .insert(schema.authChallenges)
    .values({
      id: hashToken(token),
      kind: input.kind,
      challenge: input.challenge,
      userId: input.userId ?? null,
      data: input.data ?? {},
      expiresAt: new Date(now.getTime() + (input.ttlMs ?? CHALLENGE_TTL_MS)),
    });
  return token;
}

/**
 * Single use: the row is deleted in the same statement that reads it, so a replayed or raced
 * request finds nothing. Expired or wrong-kind challenges resolve to null.
 */
export async function consumeChallenge<D extends Record<string, unknown> = Record<string, unknown>>(
  token: string | undefined | null,
  kind: ChallengeKind,
  now: Date = new Date(),
): Promise<StoredChallenge<D> | null> {
  if (!token) return null;
  const [row] = await db()
    .delete(schema.authChallenges)
    .where(and(eq(schema.authChallenges.id, hashToken(token)), eq(schema.authChallenges.kind, kind)))
    .returning();
  if (!row || row.expiresAt.getTime() <= now.getTime()) return null;
  return { kind: row.kind, challenge: row.challenge, userId: row.userId, data: row.data as D };
}
