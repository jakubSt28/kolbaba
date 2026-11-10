import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "./db";
import { alertOperator } from "./ops-alert";

/**
 * What the AI features cost: every call to TypeSafe (sorting) and OpenAI (cards, summaries) is counted
 * per user and day in `ai_usage`. The caps below read it, so a deploy or a restart of the worker can't
 * reset them (the old counter lived in memory, and one busy day of deploys let it run away), and /admin
 * shows it. Costs are estimates from list prices; the providers' dashboards have the real bill.
 */

export type AiKind = "triage" | "extract" | "summary";

export interface AiTokens {
  input: number;
  cached: number;
  output: number;
}

/** USD per million tokens (October 2026). Jev bills input only; OpenAI bills cached input at a tenth. */
const PRICES: Record<AiKind, { input: number; cached: number; output: number }> = {
  triage: { input: 0.042, cached: 0.042, output: 0 },
  extract: { input: 0.1, cached: 0.01, output: 0.5 },
  summary: { input: 0.1, cached: 0.01, output: 0.5 },
};

/**
 * Calls per user and day: about $1.50 of sorting and $0.50 of reading at most. A new mailbox's history
 * fills in within a day or two; normal mail (tens a day) never gets near.
 */
const DAILY_CALLS: Record<AiKind, () => number> = {
  triage: () => Number(process.env.JEV_DAILY_LIMIT) || 30_000,
  extract: () => Number(process.env.INSIGHTS_DAILY_LIMIT) || 3_000,
  summary: () => Number(process.env.SUMMARY_DAILY_LIMIT) || 40,
};

/** Everyone together, per day: past it, smart categories wait for tomorrow (summaries still work). */
const dailyBudgetUsd = () => Number(process.env.AI_DAILY_BUDGET_USD) || 10;

export const today = () => new Date().toISOString().slice(0, 10);

/** Millionths of a dollar, so sums stay whole numbers. */
export function costMicros(kind: AiKind, t: AiTokens) {
  const p = PRICES[kind];
  const uncached = Math.max(0, t.input - t.cached);
  return Math.round(uncached * p.input + t.cached * p.cached + t.output * p.output);
}

export async function recordUsage(userId: string, kind: AiKind, calls: number, t: AiTokens) {
  if (!calls) return;
  const cost = costMicros(kind, t);
  await db()
    .insert(schema.aiUsage)
    .values({ userId, day: today(), kind, calls, inputTokens: t.input, cachedTokens: t.cached, outputTokens: t.output, costMicros: cost })
    .onConflictDoUpdate({
      target: [schema.aiUsage.userId, schema.aiUsage.day, schema.aiUsage.kind],
      set: {
        calls: sql`${schema.aiUsage.calls} + ${calls}`,
        inputTokens: sql`${schema.aiUsage.inputTokens} + ${t.input}`,
        cachedTokens: sql`${schema.aiUsage.cachedTokens} + ${t.cached}`,
        outputTokens: sql`${schema.aiUsage.outputTokens} + ${t.output}`,
        costMicros: sql`${schema.aiUsage.costMicros} + ${cost}`,
      },
    });
}

/** How many more calls of each kind this user has today. */
export async function callsLeft(userId: string): Promise<Record<AiKind, number>> {
  const rows = await db()
    .select({ kind: schema.aiUsage.kind, calls: schema.aiUsage.calls })
    .from(schema.aiUsage)
    .where(and(eq(schema.aiUsage.userId, userId), eq(schema.aiUsage.day, today())));
  const used = new Map(rows.map((r) => [r.kind, r.calls]));
  return {
    triage: Math.max(0, DAILY_CALLS.triage() - (used.get("triage") ?? 0)),
    extract: Math.max(0, DAILY_CALLS.extract() - (used.get("extract") ?? 0)),
    summary: Math.max(0, DAILY_CALLS.summary() - (used.get("summary") ?? 0)),
  };
}

let warnedDay = "";

/** Whether today's spend of everyone together is still under the daily budget. The team hears at 80 % and at 100 %. */
export async function withinDailyBudget() {
  const [row] = await db()
    .select({ micros: sql<number>`coalesce(sum(${schema.aiUsage.costMicros}), 0)::bigint` })
    .from(schema.aiUsage)
    .where(eq(schema.aiUsage.day, today()));
  const spent = Number(row?.micros ?? 0) / 1e6;
  const budget = dailyBudgetUsd();
  const ok = spent < budget;
  if (!ok && warnedDay !== today()) {
    warnedDay = today();
    console.warn(`[ai] daily budget of $${budget} reached ($${spent.toFixed(2)}): smart categories wait for tomorrow`);
  }
  if (spent >= budget * 0.8) {
    const reached = !ok;
    void alertOperator(`budget-${reached ? 100 : 80}-${today()}`, reached ? "Denní rozpočet na AI je vyčerpaný" : "Denní rozpočet na AI je z 80 % pryč", [
      `Dnes zatím ${spent.toFixed(2)} $ z ${budget} $ (AI_DAILY_BUDGET_USD).`,
      reached ? "Chytré kategorie do zítřka nic nepošlou, shrnutí fungují dál." : "Po vyčerpání chytré kategorie do zítřka počkají.",
      "Kdo kolik spotřeboval, ukazuje /admin.",
    ]);
  }
  return ok;
}
