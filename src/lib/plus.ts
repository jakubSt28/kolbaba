/**
 * Kolbaba Plus: the features that cost us an AI call per email (smart categories, Awaiting my reply,
 * summaries). The mail client itself is free. Pure, so the server (what runs) and the app (what it
 * shows) decide the same way.
 *
 * - Trial: 14 days from the first time a Plus feature is used, not from sign-up.
 * - Gift: the operator gives Plus for free in /admin.
 * - Subscription: Stripe; "past_due" keeps Plus while Stripe retries the card.
 */

export const TRIAL_DAYS = 14;
const DAY = 86_400_000;

/** Prices in CZK, as Stripe charges them (src/server/billing.ts). */
export const PLUS_PRICES = { month: 99, year: 990 } as const;
export type PlusInterval = keyof typeof PLUS_PRICES;

export interface PlusState {
  /** "plus": paid or a gift. "trial": the 14 days. "none": the free app (cards already found stay). */
  level: "plus" | "trial" | "none";
  /** "self": a copy on the person's own server, where they bring their own AI key (src/server/plus.ts). */
  source: "gift" | "subscription" | "trial" | "self" | null;
  /** The trial has been used (or is running). */
  trialUsed: boolean;
  trialEndsAt: number | null;
  /** Subscription: the next charge, or the last day when it's cancelled. */
  periodEnd: number | null;
  cancelsAtEnd: boolean;
  interval: PlusInterval | null;
  /** Stripe couldn't charge the card and is trying again. */
  pastDue: boolean;
}

export interface PlusFields {
  trialStartedAt: Date | null;
  plusGiftedAt: Date | null;
  subscriptionStatus: string | null;
  subscriptionInterval: string | null;
  subscriptionPeriodEnd: Date | null;
  subscriptionCancelsAtEnd: boolean;
}

const PAID = new Set(["active", "trialing", "past_due"]);

export function plusState(u: PlusFields, now = Date.now()): PlusState {
  const trialEndsAt = u.trialStartedAt ? u.trialStartedAt.getTime() + TRIAL_DAYS * DAY : null;
  const paid = !!u.subscriptionStatus && PAID.has(u.subscriptionStatus);
  const base: Omit<PlusState, "level" | "source"> = {
    trialUsed: !!u.trialStartedAt,
    trialEndsAt,
    periodEnd: u.subscriptionPeriodEnd?.getTime() ?? null,
    cancelsAtEnd: paid && u.subscriptionCancelsAtEnd,
    interval: u.subscriptionInterval === "month" || u.subscriptionInterval === "year" ? u.subscriptionInterval : null,
    pastDue: u.subscriptionStatus === "past_due",
  };
  if (paid) return { ...base, level: "plus", source: "subscription" };
  if (u.plusGiftedAt) return { ...base, level: "plus", source: "gift" };
  if (trialEndsAt !== null && trialEndsAt > now) return { ...base, level: "trial", source: "trial" };
  return { ...base, level: "none", source: null };
}

export const hasPlus = (s: Pick<PlusState, "level">) => s.level !== "none";

/** Whole days left of the trial, rounded up (the last day says 1). */
export const trialDaysLeft = (s: Pick<PlusState, "trialEndsAt">, now = Date.now()) =>
  s.trialEndsAt === null ? 0 : Math.max(0, Math.ceil((s.trialEndsAt - now) / DAY));
