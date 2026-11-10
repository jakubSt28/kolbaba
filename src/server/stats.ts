import { count, eq, sql } from "drizzle-orm";
import { db, schema } from "./db";

const WEEK = 7 * 24 * 3600_000;

/** Emails opened here whose tracking pixels we held back; each counts once, however often it's opened. */
export async function recordTrackerBlocks(userId: string, messageIds: string[]) {
  if (!messageIds.length) return;
  await db()
    .insert(schema.trackerBlocks)
    .values(messageIds.map((messageId) => ({ userId, messageId })))
    .onConflictDoNothing();
}

export interface Stats {
  /** Emails that wanted to know when they were opened, and didn't get to, in the last 7 days. */
  trackersWeek: number;
  trackersTotal: number;
}

/** What Kolbaba did for the user lately: the counter on his postcard and the desktop's empty reader. */
export async function userStats(userId: string, now = Date.now()): Promise<Stats> {
  const t = schema.trackerBlocks;
  const since = new Date(now - WEEK).toISOString();
  const [row] = await db()
    .select({ total: count(), week: sql<number>`count(*) filter (where ${t.at} > ${since}::timestamptz)`.mapWith(Number) })
    .from(t)
    .where(eq(t.userId, userId));
  return { trackersWeek: row?.week ?? 0, trackersTotal: row?.total ?? 0 };
}
