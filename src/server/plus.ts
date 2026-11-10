import { and, eq, isNull } from "drizzle-orm";
import { plusState, type PlusState } from "@/lib/plus";
import { db, schema } from "./db";
import { env } from "./env";
import { HttpError } from "./http-error";

/** The columns plusState() reads, for selects. */
export const PLUS_COLUMNS = {
  trialStartedAt: schema.users.trialStartedAt,
  plusGiftedAt: schema.users.plusGiftedAt,
  subscriptionStatus: schema.users.subscriptionStatus,
  subscriptionInterval: schema.users.subscriptionInterval,
  subscriptionPeriodEnd: schema.users.subscriptionPeriodEnd,
  subscriptionCancelsAtEnd: schema.users.subscriptionCancelsAtEnd,
};

export async function getPlus(userId: string): Promise<PlusState> {
  const [row] = await db().select(PLUS_COLUMNS).from(schema.users).where(eq(schema.users.id, userId));
  if (!row) throw new HttpError(404, "Not found", "not_found");
  const state = plusState(row);
  return env.selfHosted ? { ...state, level: "plus", source: "self" } : state;
}

/** The 14 days start the first time a Plus feature is used. Never twice, and not for someone who already has Plus. */
export async function startTrial(userId: string): Promise<PlusState> {
  const state = await getPlus(userId);
  if (state.trialUsed || state.level === "plus") return state;
  await db()
    .update(schema.users)
    .set({ trialStartedAt: new Date() })
    .where(and(eq(schema.users.id, userId), isNull(schema.users.trialStartedAt)));
  return getPlus(userId);
}

/** For a Plus feature: starts the trial if it's unused, otherwise asks for Plus. */
export async function requirePlus(userId: string): Promise<PlusState> {
  const state = await startTrial(userId);
  if (state.level === "none") throw new HttpError(402, "This is part of Kolbaba Plus.", "plus");
  return state;
}
