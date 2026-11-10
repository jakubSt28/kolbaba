import { sql } from "drizzle-orm";
import { db, schema } from "../db";
import { getPlus } from "../plus";
import { RECENT_DAYS } from "./plan";

export interface InsightsProgress {
  /** The last RECENT_DAYS: how many emails smart categories went through, of how many. */
  recent: { done: number; total: number };
  /** Older emails still to go through (Plus only; the trial doesn't read them). */
  olderLeft: number;
}

/** For the line at the top of a category while the first pass runs ("Going through the last 3 months · 1,240 of 6,559"). */
export async function insightsProgress(userId: string): Promise<InsightsProgress> {
  const m = schema.messages;
  const since = new Date(Date.now() - RECENT_DAYS * 86_400_000);
  // Three counts, each answered from an index alone (messages_user_date_idx, messages_insight_todo_idx):
  // the category view asks while the first pass runs, and reading the user's mail for it every time adds up.
  const cut = sql`${since.toISOString()}::timestamptz`;
  const [plus, [row]] = await Promise.all([
    getPlus(userId),
    db().execute<{ total: number; todo: number; older_left: number }>(sql`
      select
        (select count(*) from ${m} where ${m.userId} = ${userId} and ${m.date} > ${cut})::int as total,
        (select count(*) from ${m} where ${m.userId} = ${userId} and ${m.insightCheckedAt} is null and ${m.date} > ${cut})::int as todo,
        (select count(*) from ${m} where ${m.userId} = ${userId} and ${m.insightCheckedAt} is null and ${m.date} <= ${cut})::int as older_left`),
  ]);
  return {
    recent: { done: (row?.total ?? 0) - (row?.todo ?? 0), total: row?.total ?? 0 },
    olderLeft: plus.level === "plus" ? (row?.older_left ?? 0) : 0,
  };
}
