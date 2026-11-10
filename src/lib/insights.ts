import { getLocale, intlLocale, t, tk } from "./i18n";
import type { FolderId, Insight, InsightCategory, OrderStatus, Thread } from "./types";

/** Sidebar views of the smart categories and what each one shows. */
export const CATEGORY_VIEWS = {
  orders: "order",
  travel: "travel",
  invoices: "invoice",
  subscriptions: "subscription",
  security: "security",
  replies: "reply",
} as const satisfies Partial<
  Record<FolderId, InsightCategory>
>;
export type CategoryView = keyof typeof CATEGORY_VIEWS;
export const isCategoryView = (f: FolderId): f is CategoryView => f in CATEGORY_VIEWS;

/**
 * One picture out of several emails about the same thing ("ordered", "shipped", "delivered"): later
 * emails win, but a later email that doesn't say something (the amount) keeps what an earlier one said.
 */
export function mergeInsights(list: Insight[]): Insight | undefined {
  if (!list.length) return undefined;
  const sorted = [...list].sort((a, b) => a.at - b.at);
  const pick = <T,>(get: (i: Insight) => T | null | undefined): T | null => {
    for (let i = sorted.length - 1; i >= 0; i--) {
      const v = get(sorted[i]);
      if (v !== null && v !== undefined && v !== "") return v;
    }
    return null;
  };
  const last = sorted[sorted.length - 1];
  const merged: Insight = {
    category: last.category,
    key: last.key,
    merchant: pick((i) => i.merchant),
    amount: pick((i) => i.amount),
    currency: pick((i) => i.currency),
    at: last.at,
    doneAt: Math.max(0, ...list.map((i) => i.doneAt ?? 0)) || null,
    why: pick((i) => i.why),
  };
  if (last.category === "order") {
    merged.order = {
      number: pick((i) => i.order?.number),
      item: pick((i) => i.order?.item),
      role: pick((i) => i.order?.role),
      status: pick((i) => i.order?.status),
      carrier: pick((i) => i.order?.carrier),
      trackingNumber: pick((i) => i.order?.trackingNumber),
      trackingUrl: pick((i) => i.order?.trackingUrl),
      expectedAt: pick((i) => i.order?.expectedAt),
      pickupBy: pick((i) => i.order?.pickupBy),
      returnBy: pick((i) => i.order?.returnBy),
    };
  } else if (last.category === "travel") {
    merged.travel = {
      kind: pick((i) => i.travel?.kind) ?? "other",
      from: pick((i) => i.travel?.from),
      to: pick((i) => i.travel?.to),
      startsAt: pick((i) => i.travel?.startsAt),
      endsAt: pick((i) => i.travel?.endsAt),
      bookingCode: pick((i) => i.travel?.bookingCode),
    };
  } else if (last.category === "invoice") {
    merged.invoice = {
      number: pick((i) => i.invoice?.number),
      toPay: pick((i) => i.invoice?.toPay),
      dueAt: pick((i) => i.invoice?.dueAt),
      status: pick((i) => i.invoice?.status),
      variableSymbol: pick((i) => i.invoice?.variableSymbol),
    };
  } else if (last.category === "security") {
    merged.security = last.security;
  } else if (last.category === "reply") {
    merged.reply = last.reply;
  } else {
    merged.subscription = {
      period: pick((i) => i.subscription?.period),
      renewsAt: pick((i) => i.subscription?.renewsAt),
      trialEndsAt: pick((i) => i.subscription?.trialEndsAt),
      status: pick((i) => i.subscription?.status),
    };
  }
  return merged;
}

/**
 * "Alza.cz" + "1234567" → "order:alza.cz:1234567". An order without a number groups by what was bought
 * (Vinted sends each update as a new conversation); otherwise the conversation stands alone.
 */
export function insightKey(category: InsightCategory, merchant: string | null, ref: string | null, fallback: string, item?: string | null) {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  const compact = (s: string) => norm(s).replace(/[^\p{L}\p{N}]/gu, "");
  if (category === "subscription" && merchant) return `subscription:${norm(merchant)}`;
  if (ref && merchant) return `${category}:${norm(merchant)}:${compact(ref)}`;
  if (category === "order" && item && merchant && compact(item).length >= 4) return `order:${norm(merchant)}:item:${compact(item).slice(0, 32)}`;
  return `${category}:${fallback}`;
}

/** A link from mail (tracking pages) only if it's a plain web address: no app schemes, no javascript:, no data:. */
export function safeHttpUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

/* --------------------------------- Display -------------------------------- */

export function formatMoney(amount: number | null, currency: string | null) {
  if (amount === null) return null;
  const locale = getLocale() === "cs" || currency === "CZK" ? "cs-CZ" : "en-GB";
  if (!currency) return amount.toLocaleString(locale);
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      maximumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    }).format(amount);
  } catch {
    return `${amount} ${currency}`;
  }
}

/** The amount worth showing on a card: nothing for a zero ("usage this month: 0 Kč"). */
export const cardMoney = (i: Insight) => (i.amount ? formatMoney(i.amount, i.currency) : null);

/** "2026-10-24" or "2026-10-24T07:05" as local time (ms). */
export function parseLocal(value: string | null | undefined) {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(value);
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3], m[4] ? +m[4] : 0, m[5] ? +m[5] : 0).getTime();
}

const dayFormats = new Map<string, Intl.DateTimeFormat>();
function dayFormat(withTime: boolean) {
  const locale = intlLocale();
  const key = `${locale}:${withTime}`;
  let f = dayFormats.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(
      locale,
      withTime ? { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" } : { day: "numeric", month: "short" },
    );
    dayFormats.set(key, f);
  }
  return f;
}

export function formatDay(value: string | null | undefined, withTime = false) {
  const ts = parseLocal(value);
  if (ts === null) return null;
  return dayFormat(withTime && value!.length > 10).format(ts);
}

const DAY = 86_400_000;

export const ORDER_LABELS: Record<OrderStatus, string> = {
  placed: tk("Ordered"),
  paid: tk("Paid"),
  shipped: tk("Shipped"),
  out_for_delivery: tk("Out for delivery"),
  ready_for_pickup: tk("Ready for pickup"),
  delivered: tk("Delivered"),
  cancelled: tk("Cancelled"),
  returned: tk("Returned"),
  refunded: tk("Refunded"),
};

/** What a seller sees: the same parcel, from the other side. */
const SALE_LABELS: Record<OrderStatus, string> = {
  placed: tk("Sold · ship it"),
  paid: tk("Sold · ship it"),
  shipped: tk("Sent to the buyer"),
  out_for_delivery: tk("Sent to the buyer"),
  ready_for_pickup: tk("Waiting for the buyer"),
  delivered: tk("Delivered to the buyer"),
  cancelled: tk("Cancelled"),
  returned: tk("Returned"),
  refunded: tk("Refunded"),
};

/**
 * An email can't say that a parcel was picked up or that it arrived (and many shops never write
 * again), so a status that sat unchanged this long is probably over.
 */
const STALE_AFTER: Record<OrderStatus, number> = {
  placed: 30 * DAY,
  paid: 30 * DAY,
  shipped: 14 * DAY,
  out_for_delivery: 4 * DAY,
  ready_for_pickup: 8 * DAY,
  delivered: Infinity,
  cancelled: Infinity,
  returned: Infinity,
  refunded: Infinity,
};

const ENDED: OrderStatus[] = ["delivered", "cancelled", "returned", "refunded"];

/** The user marked it done and no email came after that. */
export const markedDone = (i: Insight) => !!i.doneAt && i.doneAt >= i.at;

/**
 * Where an order stands for the user:
 * - "open": on its way to them (or, for something they sold, waiting for them to ship it)
 * - "done": arrived, ended, or the user marked it
 * - "stale": no news for a long time, so probably done
 */
export function orderPhase(i: Insight, now = Date.now()): "open" | "done" | "stale" {
  const o = i.order;
  if (!o) return "done";
  if (markedDone(i)) return "done";
  const status = o.status ?? "placed";
  if (o.role === "seller" && status !== "placed" && status !== "paid") return "done";
  if (ENDED.includes(status)) return "done";
  // A parcel at a pickup point goes back after the date the email gave.
  const pickupBy = status === "ready_for_pickup" ? parseLocal(o.pickupBy) : null;
  if (pickupBy !== null) return now > pickupBy + DAY ? "stale" : "open";
  return now - i.at > STALE_AFTER[status] ? "stale" : "open";
}

export const isOpenOrder = (i: Insight, now = Date.now()) => i.category === "order" && orderPhase(i, now) === "open";
export const isSale = (i: Insight) => i.order?.role === "seller";

/** The status line of an order card, e.g. "Ready for pickup", "Picked up", "Probably delivered". */
export function orderLabel(i: Insight, now = Date.now()): string {
  const status = i.order?.status ?? "placed";
  const sale = isSale(i);
  if (markedDone(i)) return sale ? t("Shipped") : status === "ready_for_pickup" ? t("Picked up") : t("Received");
  if (orderPhase(i, now) === "stale") return sale ? t("Sold") : status === "ready_for_pickup" ? t("Probably picked up") : t("Probably delivered");
  return t((sale ? SALE_LABELS : ORDER_LABELS)[status]);
}

/**
 * The one-tap answer to what an email can't know: the parcel was picked up or arrived, the sale was
 * shipped, the bill is paid. Null when there's nothing to answer.
 */
export function doneAction(i: Insight, now = Date.now()): { label: string; toast: string } | null {
  if (i.order && orderPhase(i, now) === "open") {
    if (isSale(i)) return { label: t("Shipped"), toast: t("Marked as shipped") };
    return i.order.status === "ready_for_pickup"
      ? { label: t("Picked up"), toast: t("Marked as picked up") }
      : { label: t("Received"), toast: t("Marked as received") };
  }
  if (i.invoice && invoicePhase(i, now) === "due") return { label: t("Paid"), toast: t("Marked as paid") };
  if (i.security && securityOpen(i, now)) return { label: t("I know about it"), toast: t("Marked as known") };
  if (i.reply && replyOpen(i, now)) return { label: t("Handled"), toast: t("Marked as handled") };
  return null;
}

/** Progress for the order card: Ordered → Shipped → Delivered (or an end that isn't delivery). */
export function orderStep(i: Insight, now = Date.now()): 0 | 1 | 2 | 3 {
  if (orderPhase(i, now) !== "open" && !["cancelled", "returned", "refunded"].includes(i.order?.status ?? "")) return 3;
  switch (i.order?.status ?? null) {
    case "shipped":
    case "out_for_delivery":
    case "ready_for_pickup":
      return 2;
    case "delivered":
      return 3;
    case "placed":
    case "paid":
    case null:
      return 1;
    default:
      return 0;
  }
}

/**
 * Where an invoice stands: "due" only when the email asked the user to pay it themselves and it's
 * not long past; "paid" when it says so, the user marked it, or it's paid by card, direct debit or
 * SIPO; "old" for a bill nobody can tell about anymore (a reminder would bring it back).
 */
export function invoicePhase(i: Insight, now = Date.now()): "due" | "paid" | "old" {
  const inv = i.invoice;
  if (!inv) return "paid";
  if (markedDone(i) || inv.status === "paid" || inv.toPay === false) return "paid";
  // Readings from before `toPay` existed: only an explicit due or overdue counts.
  if (inv.toPay == null && inv.status !== "due" && inv.status !== "overdue") return "paid";
  const due = parseLocal(inv.dueAt);
  if (due !== null ? due + 30 * DAY < now : now - i.at > 45 * DAY) return "old";
  return "due";
}

/** A security notice needs a look until the user says they know about it, and only for a couple of weeks. */
export function securityOpen(i: Insight, now = Date.now()) {
  return i.category === "security" && !markedDone(i) && now - i.at < 14 * DAY;
}

/**
 * Someone waits for the user's answer until the user replies in the conversation (the sync marks it
 * done then) or marks it handled. After a month it's not "waiting" anymore.
 */
export function replyOpen(i: Insight, now = Date.now()) {
  return i.category === "reply" && !markedDone(i) && now - i.at < 30 * DAY;
}

export const SECURITY_LABELS: Record<NonNullable<Insight["security"]>["kind"], string> = {
  sign_in: tk("New sign-in"),
  password: tk("Password changed"),
  two_factor: tk("2-step verification changed"),
  device: tk("New device"),
  suspicious: tk("Suspicious activity"),
  other: tk("Security notice"),
};

export type Tone = "neutral" | "good" | "warn" | "bad";

/** The due date of a bill to pay, as a chip: "Due 23 Oct", "Overdue since 6 Oct". */
export function dueChip(i: Insight, now = Date.now()): { text: string; tone: Tone } | null {
  const due = parseLocal(i.invoice?.dueAt);
  if (due === null) return null;
  const date = formatDay(i.invoice!.dueAt)!;
  if (invoicePhase(i, now) !== "due") return { text: t("Due {date}", { date }), tone: "neutral" };
  const overdue = due + DAY < now;
  return {
    text: overdue ? t("Overdue since {date}", { date }) : t("Due {date}", { date }),
    tone: overdue ? "bad" : due - now < 3 * DAY ? "warn" : "neutral",
  };
}

/** The short line a list row shows under the subject, e.g. "Shipped · 1 290 Kč · PPL". */
export function insightChip(i: Insight, now = Date.now()): { text: string; tone: Tone } {
  const money = cardMoney(i);
  const parts: (string | null)[] = [];
  let tone: Tone = "neutral";
  if (i.order) {
    const o = i.order;
    const phase = orderPhase(i, now);
    parts.push(orderLabel(i, now));
    if (phase === "open" && o.expectedAt) parts.push(t("arrives {date}", { date: formatDay(o.expectedAt)! }));
    if (o.status === "delivered" || markedDone(i)) {
      if (!isSale(i)) tone = "good";
      const until = parseLocal(o.returnBy);
      if (until && until > now && !isSale(i)) parts.push(t("return by {date}", { date: formatDay(o.returnBy)! }));
    }
    parts.push(money, phase === "open" ? o.carrier : null);
  } else if (i.travel) {
    const tr = i.travel;
    parts.push(tr.from && tr.to ? `${tr.from} → ${tr.to}` : (tr.to ?? tr.from ?? i.merchant), formatDay(tr.startsAt, true));
  } else if (i.invoice) {
    parts.push(money);
    const phase = invoicePhase(i, now);
    if (phase === "due") {
      const due = dueChip(i, now);
      parts.push(due?.text ?? t("to pay"));
      tone = due?.tone ?? "neutral";
    } else if (phase === "paid" && (markedDone(i) || i.invoice.status === "paid")) {
      parts.push(t("paid"));
      tone = "good";
    }
  } else if (i.security) {
    const sec = i.security;
    parts.push(t(SECURITY_LABELS[sec.kind]), sec.device, sec.location);
    if (securityOpen(i, now)) tone = sec.kind === "suspicious" ? "bad" : "warn";
    else if (markedDone(i)) parts.push(t("checked"));
  } else if (i.reply) {
    const open = replyOpen(i, now);
    parts.push(open ? t("Waiting for your reply") : markedDone(i) ? t("answered") : null, i.reply.ask);
    const due = parseLocal(i.reply.dueAt);
    if (open && due !== null) {
      parts.push(t("by {date}", { date: formatDay(i.reply.dueAt)! }));
      tone = due + DAY < now ? "bad" : due - now < 2 * DAY ? "warn" : "neutral";
    } else if (open) tone = "warn";
  } else if (i.subscription) {
    const s = i.subscription;
    if (money)
      parts.push(
        s.period === "yearly"
          ? t("{price} / year", { price: money })
          : s.period === "monthly"
            ? t("{price} / month", { price: money })
            : s.period === "weekly"
              ? t("{price} / week", { price: money })
              : money,
      );
    if (s.status === "payment_failed") {
      parts.push(t("payment failed"));
      tone = "bad";
    } else if (s.status === "trial" && s.trialEndsAt) {
      parts.push(t("trial ends {date}", { date: formatDay(s.trialEndsAt)! }));
      tone = "warn";
    } else if (s.status === "cancelled") parts.push(t("cancelled"));
  }
  return { text: parts.filter(Boolean).join(" · "), tone };
}

/** A card in a category view: everything about one order (trip, invoice, service), from all its conversations. */
export interface InsightCard {
  key: string;
  insight: Insight;
  /** Newest conversation first; the card opens the first one. */
  threadIds: string[];
}

export function insightCards(threads: Thread[], category: InsightCategory): InsightCard[] {
  const groups = new Map<string, Thread[]>();
  for (const th of threads) {
    if (th.insight?.category !== category) continue;
    groups.set(th.insight.key, [...(groups.get(th.insight.key) ?? []), th]);
  }
  const cards: InsightCard[] = [];
  for (const [key, list] of groups) {
    const insight = mergeInsights(list.map((th) => th.insight!))!;
    cards.push({
      key,
      insight,
      threadIds: list.sort((a, b) => b.insight!.at - a.insight!.at).map((th) => th.id),
    });
  }
  return cards.sort((a, b) => b.insight.at - a.insight.at);
}

/** What the sidebar counts: orders on their way, sales to ship, trips ahead, bills to pay, trials ending. */
export function needsAttention(card: InsightCard, now = Date.now()) {
  const i = card.insight;
  switch (i.category) {
    case "order":
      return orderPhase(i, now) === "open";
    case "travel":
      return (parseLocal(i.travel?.endsAt ?? i.travel?.startsAt) ?? 0) > now;
    case "invoice":
      return invoicePhase(i, now) === "due";
    case "subscription":
      return i.subscription?.status === "trial" || i.subscription?.status === "payment_failed";
    case "security":
      return securityOpen(i, now);
    case "reply":
      return replyOpen(i, now);
  }
}

/** Totals per currency ("1 240 Kč + €9.99"); `whole` rounds them to whole units. */
export function sumByCurrency(items: { amount: number; currency: string | null }[], whole = false) {
  const sums = new Map<string, number>();
  for (const { amount, currency } of items) sums.set(currency ?? "", (sums.get(currency ?? "") ?? 0) + amount);
  return [...sums].map(([currency, sum]) => formatMoney(whole ? Math.round(sum) : Math.round(sum * 100) / 100, currency || null)).join(" + ");
}

/** Monthly cost of the subscriptions, per currency ("1 240 Kč + €9.99"). Yearly ones count as a twelfth. */
export function monthlyTotal(cards: InsightCard[]) {
  const items: { amount: number; currency: string }[] = [];
  for (const { insight: i } of cards) {
    if (!i.subscription || i.amount === null || !i.currency || i.subscription.status === "cancelled") continue;
    const factor = i.subscription.period === "yearly" ? 1 / 12 : i.subscription.period === "weekly" ? 52 / 12 : 1;
    items.push({ amount: i.amount * factor, currency: i.currency });
  }
  return sumByCurrency(items, true);
}
