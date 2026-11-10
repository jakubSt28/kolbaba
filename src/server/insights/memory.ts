import { and, eq, inArray, sql } from "drizzle-orm";
import type { InsightCategory } from "@/lib/types";
import { db, schema } from "../db";

/**
 * What smart categories remember about senders, per user, so the same newsletter isn't sorted for the
 * hundredth time. Measured on 6,559 emails of the last 90 days (14 Oct 2026): skipping a sender after
 * three emails in a row that were nothing sorted 45 % fewer emails and lost 1 of 624 cards. Every
 * tenth email of a skipped sender is sorted anyway, in case they start sending something else, and
 * recent mail the rules flag is always sorted.
 *
 * And what the user said: a sender whose cards of a kind they hid more often than kept (at least
 * twice) gets no more cards of that kind. Once isn't enough: a shop's newsletter mistaken for an
 * order mustn't hide the shop's real orders.
 */

export const NOTHING_IN_A_ROW = 3;
export const RECHECK_EVERY = 10;
export const HIDDEN_TO_BLOCK = 2;

export interface Memory {
  nothing: number;
  skipped: number;
}

export const senderOf = (from: { email: string }) => from.email.trim().toLowerCase();

/** Whether this email skips sorting. */
export function skipBySender(m: Memory | undefined, email: { recent: boolean; rule: boolean }) {
  if (!m || m.nothing < NOTHING_IN_A_ROW) return false;
  if (email.recent && email.rule) return false;
  return m.skipped < RECHECK_EVERY - 1;
}

/**
 * How many more of a sender's emails can go to sorting in this step before it's known whether they're
 * worth it: a sender never sorted gets three, one with two nothings in a row gets one. A sender whose
 * last email was something isn't held back (a shop with a hundred orders).
 */
export function sortsBeforeKnown(m: Memory | undefined) {
  if (!m) return NOTHING_IN_A_ROW;
  if (m.nothing === 0 || m.nothing >= NOTHING_IN_A_ROW) return Infinity;
  return NOTHING_IN_A_ROW - m.nothing;
}

export const afterSkip = (m: Memory): Memory => ({ ...m, skipped: m.skipped + 1 });
export const afterSort = (m: Memory | undefined, nothing: boolean): Memory => ({ nothing: nothing ? (m?.nothing ?? 0) + 1 : 0, skipped: 0 });

export async function loadMemory(userId: string, senders: string[]) {
  if (!senders.length) return new Map<string, Memory>();
  const rows = await db()
    .select({ sender: schema.senderMemory.sender, nothing: schema.senderMemory.nothing, skipped: schema.senderMemory.skipped })
    .from(schema.senderMemory)
    .where(and(eq(schema.senderMemory.userId, userId), inArray(schema.senderMemory.sender, senders)));
  return new Map(rows.map((r) => [r.sender, { nothing: r.nothing, skipped: r.skipped }]));
}

export async function saveMemory(userId: string, changed: Map<string, Memory>) {
  if (!changed.size) return;
  await db()
    .insert(schema.senderMemory)
    .values([...changed].map(([sender, m]) => ({ userId, sender, nothing: m.nothing, skipped: m.skipped, updatedAt: new Date() })))
    .onConflictDoUpdate({
      target: [schema.senderMemory.userId, schema.senderMemory.sender],
      set: { nothing: sql`excluded.nothing`, skipped: sql`excluded.skipped`, updatedAt: sql`excluded.updated_at` },
    });
}

/** "sender|category" pairs the user doesn't want cards for. */
export async function hiddenKinds(userId: string): Promise<Set<string>> {
  const rows = await db().execute<{ sender: string; category: InsightCategory }>(sql`
    select lower(m."from"->>'email') as sender, i.category
    from ${schema.insights} i join ${schema.messages} m on m.id = i.message_id
    where i.user_id = ${userId}
    group by 1, 2
    having count(*) filter (where i.dismissed_at is not null) >= ${HIDDEN_TO_BLOCK}
      and count(*) filter (where i.dismissed_at is not null) > count(*) filter (where i.dismissed_at is null)`);
  return new Set(rows.map((r) => `${r.sender}|${r.category}`));
}
