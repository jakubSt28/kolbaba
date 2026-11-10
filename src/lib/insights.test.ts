import { describe, expect, it } from "vitest";
import { insightCards, insightChip, insightKey, invoicePhase, mergeInsights, monthlyTotal, orderLabel, orderPhase } from "./insights";
import type { Insight, Thread } from "./types";

const order = (at: number, patch: Partial<NonNullable<Insight["order"]>>, amount: number | null = null): Insight => ({
  category: "order",
  key: "order:alza.cz:1",
  merchant: "Alza.cz",
  amount,
  currency: amount === null ? null : "CZK",
  at,
  order: { number: "1", status: null, carrier: null, trackingNumber: null, trackingUrl: null, expectedAt: null, returnBy: null, ...patch },
});

describe("mergeInsights", () => {
  it("lets the latest email speak, but keeps what only an earlier one said", () => {
    const merged = mergeInsights([order(3, { status: "delivered" }), order(1, { status: "placed" }, 8990), order(2, { status: "shipped", carrier: "PPL" })]);
    expect(merged).toMatchObject({ amount: 8990, currency: "CZK", at: 3, order: { status: "delivered", carrier: "PPL" } });
  });
});

describe("insightKey", () => {
  it("groups by merchant and reference, or keeps a conversation on its own", () => {
    expect(insightKey("order", "Alza.cz", "412 889-301", "t1")).toBe("order:alza.cz:412889301");
    expect(insightKey("order", "Alza.cz", null, "t1")).toBe("order:t1");
    expect(insightKey("subscription", "Netflix", null, "t1")).toBe("subscription:netflix");
  });

  it("groups an order without a number by what was bought", () => {
    expect(insightKey("order", "Vinted", null, "t1", "House funnel-neck mikina")).toBe(insightKey("order", "Vinted", null, "t2", "House Funnel-Neck mikina"));
    expect(insightKey("order", "Vinted", null, "t1", "abc")).toBe("order:t1");
  });
});

describe("orderPhase", () => {
  const now = new Date(2026, 9, 10, 12).getTime();
  const daysAgo = (d: number) => now - d * 86_400_000;

  it("keeps an order open while news is fresh, and calls it over when it went quiet", () => {
    expect(orderPhase(order(daysAgo(2), { status: "ready_for_pickup" }), now)).toBe("open");
    expect(orderPhase(order(daysAgo(10), { status: "ready_for_pickup" }), now)).toBe("stale");
    expect(orderLabel(order(daysAgo(10), { status: "ready_for_pickup" }), now)).toBe("Probably picked up");
    expect(orderPhase(order(daysAgo(20), { status: "shipped" }), now)).toBe("stale");
    expect(orderPhase(order(daysAgo(20), { status: "placed" }), now)).toBe("open");
  });

  it("follows the pickup deadline when the email gave one", () => {
    expect(orderPhase(order(daysAgo(3), { status: "ready_for_pickup", pickupBy: "2026-10-08" }), now)).toBe("stale");
    expect(orderPhase(order(daysAgo(12), { status: "ready_for_pickup", pickupBy: "2026-10-12" }), now)).toBe("open");
  });

  it("is done once the user says so, until a newer email comes", () => {
    const picked = { ...order(daysAgo(1), { status: "ready_for_pickup" }), doneAt: daysAgo(0) };
    expect(orderPhase(picked, now)).toBe("done");
    expect(orderLabel(picked, now)).toBe("Picked up");
    expect(orderPhase({ ...picked, doneAt: daysAgo(2) }, now)).toBe("open");
  });

  it("only keeps a sale open until it's shipped", () => {
    expect(orderPhase(order(daysAgo(1), { role: "seller", status: "placed" }), now)).toBe("open");
    expect(orderPhase(order(daysAgo(1), { role: "seller", status: "ready_for_pickup" }), now)).toBe("done");
    expect(orderLabel(order(daysAgo(1), { role: "seller", status: "ready_for_pickup" }), now)).toBe("Waiting for the buyer");
  });
});

describe("invoicePhase", () => {
  const now = new Date(2026, 9, 10, 12).getTime();
  const bill = (patch: Partial<NonNullable<Insight["invoice"]>>, at = now): Insight => ({
    category: "invoice",
    key: "invoice:pre",
    merchant: "PRE",
    amount: 1250.5,
    currency: "CZK",
    at,
    invoice: { number: null, toPay: true, dueAt: "2026-10-23", status: "due", variableSymbol: null, ...patch },
  });

  it("only asks to pay what the email asked the user to pay", () => {
    expect(invoicePhase(bill({}), now)).toBe("due");
    expect(invoicePhase(bill({ toPay: false }), now)).toBe("paid");
    expect(invoicePhase(bill({ status: "paid" }), now)).toBe("paid");
    expect(invoicePhase({ ...bill({}), doneAt: now }, now)).toBe("paid");
  });

  it("lets a long-past bill go quiet instead of calling it overdue forever", () => {
    expect(invoicePhase(bill({ dueAt: "2026-10-01" }), now)).toBe("due");
    expect(invoicePhase(bill({ dueAt: "2026-08-01" }), now)).toBe("old");
  });
});

describe("insightChip", () => {
  const now = new Date(2026, 9, 10, 12).getTime();

  it("says where an order is", () => {
    expect(insightChip(order(now, { status: "shipped", carrier: "PPL", expectedAt: "2026-10-11" }, 8990), now)).toEqual({
      text: "Shipped · arrives 11 Oct · 8 990 Kč · PPL",
      tone: "neutral",
    });
    expect(insightChip(order(now, { status: "delivered", returnBy: "2026-10-20" }), now)).toMatchObject({ text: "Delivered · return by 20 Oct", tone: "good" });
  });

  it("warns about invoices due soon and overdue", () => {
    const invoice = (dueAt: string): Insight => ({
      category: "invoice",
      key: "invoice:x",
      merchant: "ČEZ",
      amount: 1380,
      currency: "CZK",
      at: now,
      invoice: { number: null, dueAt, status: "due", variableSymbol: null },
    });
    expect(insightChip(invoice("2026-10-11"), now).tone).toBe("warn");
    expect(insightChip(invoice("2026-10-01"), now)).toMatchObject({ tone: "bad" });
    expect(insightChip(invoice("2026-10-30"), now).tone).toBe("neutral");
  });
});

describe("insightCards and monthlyTotal", () => {
  const thread = (id: string, insight: Insight): Thread => ({ id, accountId: "a", subject: "", messages: [], unread: false, pinned: false, folder: "inbox", insight });
  const sub = (key: string, amount: number, currency: string, period: "monthly" | "yearly"): Insight => ({
    category: "subscription",
    key,
    merchant: key,
    amount,
    currency,
    at: 1,
    subscription: { period, renewsAt: null, trialEndsAt: null, status: "active" },
  });

  it("makes one card per order from several conversations", () => {
    const cards = insightCards([thread("t1", order(1, { status: "placed" }, 100)), thread("t2", order(2, { status: "shipped" }))], "order");
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ threadIds: ["t2", "t1"], insight: { amount: 100, order: { status: "shipped" } } });
  });

  it("adds up subscriptions per month and currency", () => {
    const cards = insightCards([thread("n", sub("netflix", 299, "CZK", "monthly")), thread("f", sub("figma", 192, "USD", "yearly"))], "subscription");
    expect(monthlyTotal(cards)).toBe("299 Kč + US$16");
  });
});

describe("cards without details (older mail Jev sorted)", () => {
  const DAY = 86_400_000;
  const now = Date.parse("2026-10-13T12:00:00Z");
  const sorted = (category: Insight["category"]): Insight => ({ category, key: `${category}:t1`, merchant: "Alza.cz", amount: null, currency: null, at: now - 200 * DAY });

  it("never read as open, due or worth a chip", () => {
    for (const category of ["order", "travel", "invoice", "subscription"] as const) {
      const card = insightCards([{ id: "t1", insight: sorted(category) } as unknown as Thread], category)[0];
      expect(insightChip(sorted(category), now).text).toBe("");
      expect(card.insight.merchant).toBe("Alza.cz");
      if (category === "order") {
        expect(orderPhase(card.insight, now)).not.toBe("open");
        expect(orderLabel(card.insight, now)).toBe("Probably delivered");
      }
      if (category === "invoice") expect(invoicePhase(card.insight, now)).toBe("paid");
    }
  });
});
