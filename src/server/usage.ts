import "server-only";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { FEATURES, type Feature } from "@/lib/usage";
import { db, schema } from "./db";

/** One batch from the app: how many times each feature was used since the last one. */
export const UsageBody = z.object({
  counts: z.partialRecord(z.enum(FEATURES as [Feature, ...Feature[]]), z.number().int().min(1).max(1000)),
});

/** Adds a batch to today's counts (UTC days). */
export async function recordUsage(userId: string, counts: Partial<Record<Feature, number>>) {
  const rows = Object.entries(counts).map(([feature, count]) => ({ userId, feature, day: sql`current_date`, count: count as number }));
  if (!rows.length) return;
  const u = schema.featureUsage;
  await db()
    .insert(u)
    // drizzle types `day` as a string; current_date keeps "today" on the database's clock.
    .values(rows as unknown as (typeof u.$inferInsert)[])
    .onConflictDoUpdate({ target: [u.userId, u.feature, u.day], set: { count: sql`${u.count} + excluded.count` } });
}

export interface FeatureStat {
  feature: Feature;
  /** How many people used it in the last 30 days. */
  users: number;
  week: number;
  month: number;
}

export interface UsageOverview {
  stats: FeatureStat[];
  /** Everyone who used anything in the last 30 days: what "users" is out of. */
  activeUsers: number;
}

/** The last 30 days by feature, optionally without some users (the operator's own clicks). */
export async function usageOverview(excludeUserIds: string[] = []): Promise<UsageOverview> {
  const u = schema.featureUsage;
  const others = excludeUserIds.length ? sql`and ${u.userId} not in (${sql.join(excludeUserIds.map((id) => sql`${id}`), sql`, `)})` : sql``;
  const [rows, active] = await Promise.all([
    db().execute<{ feature: string; users: number; week: number; month: number }>(sql`
      select ${u.feature} as feature,
        count(distinct ${u.userId})::int as users,
        coalesce(sum(${u.count}) filter (where ${u.day} > current_date - 7), 0)::int as week,
        sum(${u.count})::int as month
      from ${u}
      where ${u.day} > current_date - 30 ${others}
      group by ${u.feature}`),
    db().execute<{ n: number }>(sql`select count(distinct ${u.userId})::int as n from ${u} where ${u.day} > current_date - 30 ${others}`),
  ]);
  const known = new Set<string>(FEATURES);
  return {
    stats: rows.filter((r) => known.has(r.feature)).map((r) => ({ feature: r.feature as Feature, users: r.users, week: r.week, month: r.month })),
    activeUsers: active[0]?.n ?? 0,
  };
}
