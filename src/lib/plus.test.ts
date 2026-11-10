import { describe, expect, it } from "vitest";
import { plusState, TRIAL_DAYS, trialDaysLeft, type PlusFields } from "./plus";

const DAY = 86_400_000;
const now = Date.parse("2026-10-14T12:00:00Z");
const free: PlusFields = {
  trialStartedAt: null,
  plusGiftedAt: null,
  subscriptionStatus: null,
  subscriptionInterval: null,
  subscriptionPeriodEnd: null,
  subscriptionCancelsAtEnd: false,
};

describe("plusState", () => {
  it("is the free app until a Plus feature is first used", () => {
    expect(plusState(free, now)).toMatchObject({ level: "none", trialUsed: false, source: null });
  });

  it("gives 14 days from the first use, then ends", () => {
    const started = { ...free, trialStartedAt: new Date(now - 3 * DAY) };
    const s = plusState(started, now);
    expect(s).toMatchObject({ level: "trial", source: "trial", trialUsed: true });
    expect(trialDaysLeft(s, now)).toBe(TRIAL_DAYS - 3);
    expect(plusState(started, now + (TRIAL_DAYS - 3) * DAY + 1)).toMatchObject({ level: "none", trialUsed: true });
  });

  it("counts the last day of the trial as one", () => {
    const s = plusState({ ...free, trialStartedAt: new Date(now - (TRIAL_DAYS - 0.5) * DAY) }, now);
    expect(trialDaysLeft(s, now)).toBe(1);
  });

  it("keeps Plus while Stripe retries a failed payment, and until the end when cancelled", () => {
    const paid = { ...free, subscriptionStatus: "active", subscriptionInterval: "year", subscriptionPeriodEnd: new Date(now + 30 * DAY) };
    expect(plusState(paid, now)).toMatchObject({ level: "plus", source: "subscription", interval: "year", cancelsAtEnd: false });
    expect(plusState({ ...paid, subscriptionStatus: "past_due" }, now)).toMatchObject({ level: "plus", pastDue: true });
    expect(plusState({ ...paid, subscriptionCancelsAtEnd: true }, now)).toMatchObject({ level: "plus", cancelsAtEnd: true });
    expect(plusState({ ...paid, subscriptionStatus: "canceled" }, now)).toMatchObject({ level: "none" });
    expect(plusState({ ...paid, subscriptionStatus: "incomplete" }, now)).toMatchObject({ level: "none" });
  });

  it("gives Plus as a gift, whatever the trial did", () => {
    const gift = { ...free, plusGiftedAt: new Date(now - DAY), trialStartedAt: new Date(now - 60 * DAY) };
    expect(plusState(gift, now)).toMatchObject({ level: "plus", source: "gift" });
  });

  it("prefers the subscription to a gift (that's what can be managed)", () => {
    expect(plusState({ ...free, plusGiftedAt: new Date(), subscriptionStatus: "active" }, now)).toMatchObject({ source: "subscription" });
  });
});
