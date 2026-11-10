"use client";

import {
  BedDouble,
  Bus,
  CarFront,
  Check,
  Copy,
  ExternalLink,
  EyeOff,
  MessageSquareReply,
  Package,
  Plane,
  ReceiptText,
  Repeat,
  ShieldCheck,
  Sparkles,
  Ticket,
  TrainFront,
  type LucideIcon,
} from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  cardMoney,
  CATEGORY_VIEWS,
  doneAction,
  dueChip,
  formatDay,
  insightCards,
  invoicePhase,
  isSale,
  markedDone,
  monthlyTotal,
  orderLabel,
  orderPhase,
  orderStep,
  parseLocal,
  replyOpen,
  safeHttpUrl,
  SECURITY_LABELS,
  securityOpen,
  sumByCurrency,
  type CategoryView,
  type InsightCard,
  type Tone,
} from "@/lib/insights";
import { intlLocale, t, tk, tn } from "@/lib/i18n";
import { api, LIVE } from "@/lib/live";
import { TRIAL_DAYS } from "@/lib/plus";
import { inFolder, threadCounterpart, useMail } from "@/lib/store";
import type { Insight } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useNow } from "@/lib/use-now";
import { PlusNotice } from "./plus";
import { Avatar, spring, Tooltip } from "./ui";

const DAY = 86_400_000;

export const CATEGORY_ICONS: Record<CategoryView, LucideIcon> = {
  orders: Package,
  travel: Plane,
  invoices: ReceiptText,
  subscriptions: Repeat,
  security: ShieldCheck,
  replies: MessageSquareReply,
};

const TRAVEL_ICONS: Record<NonNullable<Insight["travel"]>["kind"], LucideIcon> = {
  flight: Plane,
  train: TrainFront,
  bus: Bus,
  hotel: BedDouble,
  rental: CarFront,
  event: Ticket,
  other: Ticket,
};

/** The cards of one category in the current mailbox (scope), newest first. */
export function useCategoryCards(view: CategoryView) {
  const threads = useMail(useShallow((s) => Object.values(s.threads).filter((t) => (s.scope === "all" || t.accountId === s.scope) && inFolder(t, view))));
  return useMemo(() => insightCards(threads, CATEGORY_VIEWS[view]), [threads, view]);
}

/**
 * A smart category as cards instead of conversations: one card per order (trip, invoice, service),
 * however many emails it took. A card opens its latest conversation.
 */
export function CategoryList({ view, mobile = false }: { view: CategoryView; mobile?: boolean }) {
  const cards = useCategoryCards(view);
  const enabled = useMail((s) => s.smartCategories);
  const replyReminders = useMail((s) => s.replyReminders);
  const now = useNow();

  if (!enabled) return <TurnOn />;
  if (view === "replies" && !replyReminders) return <TurnOnReplies />;
  if (!cards.length)
    return (
      <div className={cn("flex flex-col gap-1", mobile ? "px-2.5" : "pt-1")}>
        <PlusNotice />
        <Progress />
        <Empty view={view} />
      </div>
    );

  const sections: { label: string; cards: InsightCard[] }[] = [];
  const push = (label: string, card: InsightCard) => {
    const s = sections.find((x) => x.label === label);
    if (s) s.cards.push(card);
    else sections.push({ label, cards: [card] });
  };
  if (view === "orders") {
    // What still needs the user first: parcels on their way to them, things they sold and must send.
    const open = cards.filter((c) => orderPhase(c.insight, now) === "open");
    for (const c of open.filter((c) => !isSale(c.insight))) push(t("On the way"), c);
    for (const c of open.filter((c) => isSale(c.insight))) push(t("To ship"), c);
    for (const c of cards.filter((c) => !open.includes(c) && !isSale(c.insight))) push(t("Done@@orders"), c);
    for (const c of cards.filter((c) => !open.includes(c) && isSale(c.insight))) push(t("Sold"), c);
  } else if (view === "travel") {
    const when = (c: InsightCard) => parseLocal(c.insight.travel?.endsAt ?? c.insight.travel?.startsAt) ?? c.insight.at;
    const upcoming = cards
      .filter((c) => when(c) > now)
      .sort((a, b) => (parseLocal(a.insight.travel?.startsAt) ?? 0) - (parseLocal(b.insight.travel?.startsAt) ?? 0));
    for (const c of upcoming) push(t("Upcoming"), c);
    for (const c of cards.filter((c) => when(c) <= now)) push(t("Past"), c);
  } else if (view === "invoices") {
    const phase = (c: InsightCard) => invoicePhase(c.insight, now);
    for (const c of cards.filter((c) => phase(c) === "due")) push(t("To pay"), c);
    for (const c of cards.filter((c) => phase(c) === "paid")) push(t("Paid & receipts"), c);
    for (const c of cards.filter((c) => phase(c) === "old")) push(t("Earlier"), c);
  } else if (view === "security") {
    for (const c of cards.filter((c) => securityOpen(c.insight, now))) push(t("To check"), c);
    for (const c of cards.filter((c) => !securityOpen(c.insight, now))) push(t("Earlier"), c);
  } else if (view === "replies") {
    for (const c of cards.filter((c) => replyOpen(c.insight, now))) push(t("Waiting for you"), c);
    for (const c of cards.filter((c) => !replyOpen(c.insight, now))) push(t("Answered or handled"), c);
  } else {
    // One card per service is the latest word on it; cancelled ones go last.
    for (const c of cards.filter((c) => c.insight.subscription?.status !== "cancelled")) push(t("Active"), c);
    for (const c of cards.filter((c) => c.insight.subscription?.status === "cancelled")) push(t("Cancelled@@subscriptions"), c);
  }

  return (
    <div className={cn("flex flex-col gap-1", mobile ? "px-2.5" : "pt-1")}>
      <PlusNotice />
      <Progress />
      <Summary view={view} cards={cards} now={now} />
      {sections.map((s) => (
        <section key={s.label}>
          <div className={cn("px-2 pt-3 pb-1.5 text-[11px] font-medium text-ink-3", mobile && "px-3 text-[12.5px] font-semibold")}>{s.label}</div>
          <div className="flex flex-col gap-1.5">
            {s.cards.map((c) => (
              <Card key={c.key} card={c} view={view} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function Summary({ view, cards, now }: { view: CategoryView; cards: InsightCard[]; now: number }) {
  const parts: string[] = [];
  if (view === "subscriptions") {
    const total = monthlyTotal(cards);
    if (total) parts.push(t("About {total} a month", { total }));
  } else if (view === "invoices") {
    // Only bills the user was asked to pay and hasn't marked paid: a total they can trust.
    const due = cards.filter((c) => invoicePhase(c.insight, now) === "due");
    if (due.length) {
      parts.push(tn(due.length, "{n} bill to pay", "{n} bills to pay"));
      const total = sumByCurrency(due.flatMap((c) => (c.insight.amount ? [{ amount: c.insight.amount, currency: c.insight.currency }] : [])));
      if (total) parts.push(total);
    }
  } else if (view === "security") {
    const open = cards.filter((c) => securityOpen(c.insight, now)).length;
    if (open) parts.push(tn(open, "{n} notice to check", "{n} notices to check"));
  } else if (view === "replies") {
    const open = cards.filter((c) => replyOpen(c.insight, now)).length;
    if (open) parts.push(tn(open, "{n} person waiting for your reply", "{n} people waiting for your reply"));
  } else if (view === "orders") {
    const open = cards.filter((c) => orderPhase(c.insight, now) === "open");
    const coming = open.filter((c) => !isSale(c.insight)).length;
    const toShip = open.length - coming;
    if (coming) parts.push(tn(coming, "{n} order on the way", "{n} orders on the way"));
    if (toShip) parts.push(tn(toShip, "{n} sale to ship", "{n} sales to ship"));
  }
  if (!parts.length) return null;
  return <div className="mx-0.5 mt-1 rounded-[12px] bg-accent-soft px-3 py-2 text-[13px] font-medium text-accent-text">{parts.join(" · ")}</div>;
}

type InsightsProgress = { recent: { done: number; total: number }; olderLeft: number };

/** Only worth a line while there's a real backlog, not the few emails of the last minute. */
const BACKLOG = 25;
const running = (p: InsightsProgress) => p.recent.total - p.recent.done > BACKLOG || p.olderLeft > BACKLOG;
/** How often to ask how far it is: the pass takes many minutes, and the bar eases between answers. */
const PROGRESS_EVERY_MS = 30_000;

/**
 * The first pass over a mailbox takes a while: a line with how far it is, newest mail first, and
 * the list refreshing as cards come in. Gone once it's done (and without Plus nothing runs).
 * Only asked while it's on screen; coming back asks at once.
 */
function Progress() {
  const [progress, setProgress] = useState<InsightsProgress | null>(null);
  const plus = useMail((s) => s.plus);
  const refresh = useMail((s) => s.refresh);
  const lastDone = useRef<number | null>(null);
  const active = !!plus && plus.level !== "none";
  useEffect(() => {
    if (!LIVE || !active) return;
    let stopped = false;
    // Done, or no answer: nothing more to ask.
    let over = false;
    let asking = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      timer = undefined;
      // Out of sight it waits for the page to come back (below).
      if (over || asking || document.visibilityState !== "visible") return;
      asking = true;
      const next = await api.get<InsightsProgress>("/api/insights").catch(() => null);
      asking = false;
      if (stopped) return;
      if (!next) {
        over = true;
        return;
      }
      // Emails gone through since last time, or the pass just finished: there may be new cards to show.
      const moved = next.recent.done - next.olderLeft;
      over = !running(next);
      if (lastDone.current !== null && (moved !== lastDone.current || over)) void refresh();
      lastDone.current = moved;
      setProgress(next);
      if (!over) timer = setTimeout(() => void tick(), PROGRESS_EVERY_MS);
    };
    // Its turn came while the page was hidden: ask now that it's back.
    const onVisibility = () => {
      if (!timer) void tick();
    };
    document.addEventListener("visibilitychange", onVisibility);
    void tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [active, refresh]);
  if (!active || !progress || !running(progress)) return null;
  const n = (x: number) => new Intl.NumberFormat(intlLocale()).format(x);
  const { done, total } = progress.recent;
  const recent = total - done > BACKLOG;
  return (
    <div className="mx-0.5 mt-1 rounded-[12px] bg-hover px-3 py-2">
      <div className="flex items-center justify-between gap-3 text-[12.5px] text-ink-2">
        <span>{recent ? t("Going through the last 3 months") : t("Adding older mail")}</span>
        <span className="shrink-0 text-ink-3 tabular-nums">
          {recent ? t("{done} of {total}", { done: n(done), total: n(total) }) : tn(progress.olderLeft, "{n} email to go", "{n} emails to go", { n: n(progress.olderLeft) })}
        </span>
      </div>
      {recent && (
        <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-ink/10">
          <motion.div className="h-full rounded-full bg-accent" initial={false} animate={{ width: `${Math.round((done / Math.max(total, 1)) * 100)}%` }} transition={spring} />
        </div>
      )}
    </div>
  );
}

function Card({ card, view }: { card: InsightCard; view: CategoryView }) {
  const openThread = useMail((s) => s.openThread);
  const thread = useMail((s) => s.threads[card.threadIds[0]]);
  const accounts = useMail((s) => s.accounts);
  const active = useMail((s) => s.tabs.some((tab) => tab.id === s.activeTabId && tab.kind === "thread" && card.threadIds.includes(tab.threadId)));
  const dismissInsight = useMail((s) => s.dismissInsight);
  if (!thread) return null;
  const i = card.insight;
  const sender = threadCounterpart(thread, accounts);
  const money = cardMoney(i);

  return (
    <motion.div
      layout="position"
      transition={spring}
      role="button"
      tabIndex={-1}
      data-thread-id={thread.id}
      onClick={() => openThread(thread.id)}
      className={cn(
        "group relative cursor-default rounded-[14px] p-3 shadow-[inset_0_0_0_0.5px_var(--line)] transition-colors",
        active ? "bg-selected" : "bg-solid/60 hover:bg-hover",
      )}
    >
      <div className="flex items-center gap-3">
        {view === "travel" && i.travel ? (
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent-text">
            {(() => {
              const Icon = TRAVEL_ICONS[i.travel.kind];
              return <Icon size={17} />;
            })()}
          </span>
        ) : (
          <Avatar person={{ name: i.merchant ?? sender.name, email: sender.email }} logo={thread.logo} size={36} />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="min-w-0 flex-1 truncate text-[14px] font-semibold">{title(i, sender.name)}</span>
            {money && <span className="shrink-0 text-[13.5px] font-semibold tabular-nums">{money}</span>}
          </div>
          <div className="truncate text-[12.5px] text-ink-3" title={i.why ? t("Why here: {reason}", { reason: i.why }) : undefined}>
            {subtitle(i, thread.subject)}
          </div>
        </div>
      </div>
      {i.order && <OrderProgress insight={i} />}
      <Details card={card} />
      {/* With a mouse, on hover; on a phone it's in the banner of the open conversation. */}
      <div className="absolute top-[31px] right-2.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 [@media(hover:none)]:hidden">
        <Tooltip label={t("Doesn't belong here")}>
          <button
            onClick={(e) => {
              e.stopPropagation();
              dismissInsight(card.key);
            }}
            aria-label={t("Doesn't belong here")}
            className="flex size-6 items-center justify-center rounded-full bg-solid text-ink-3 shadow-[0_1px_2px_rgb(0_0_0/0.08),0_0_0_0.5px_var(--line)] hover:text-ink"
          >
            <EyeOff size={12} />
          </button>
        </Tooltip>
      </div>
    </motion.div>
  );
}

function title(i: Insight, sender: string) {
  if (i.travel) {
    const tr = i.travel;
    if (tr.kind === "hotel" || tr.kind === "event") return tr.to ?? i.merchant ?? sender;
    return tr.from && tr.to ? `${tr.from} → ${tr.to}` : (tr.to ?? i.merchant ?? sender);
  }
  return i.merchant ?? sender;
}

function subtitle(i: Insight, subject: string) {
  if (i.order) {
    const what = i.order.item ?? (i.order.number ? t("Order {number}", { number: i.order.number }) : subject);
    return isSale(i) ? t("You sold: {item}", { item: i.order.item ?? subject }) : what;
  }
  if (i.travel) {
    const tr = i.travel;
    const range = [
      formatDay(tr.startsAt, true),
      tr.endsAt && tr.kind !== "flight" && tr.kind !== "train" && tr.kind !== "bus" ? formatDay(tr.endsAt) : null,
    ]
      .filter(Boolean)
      .join(" – ");
    return [range, tr.kind !== "hotel" && tr.kind !== "event" ? i.merchant : null].filter(Boolean).join(" · ") || subject;
  }
  if (i.invoice)
    return (
      [
        i.invoice.number ? t("Invoice {number}", { number: i.invoice.number }) : null,
        i.invoice.variableSymbol ? t("VS {symbol}", { symbol: i.invoice.variableSymbol }) : null,
      ]
        .filter(Boolean)
        .join(" · ") || subject
    );
  if (i.subscription) {
    const s = i.subscription;
    return s.period === "yearly" ? t("Yearly") : s.period === "monthly" ? t("Monthly") : s.period === "weekly" ? t("Weekly") : subject;
  }
  if (i.security) return [t(SECURITY_LABELS[i.security.kind]), i.security.device, i.security.location].filter(Boolean).join(" · ");
  if (i.reply) return i.reply.ask || subject;
  return subject;
}

/** Ordered → Shipped → Delivered, as three short bars, and where it is now. */
function OrderProgress({ insight }: { insight: Insight }) {
  const now = useNow();
  const phase = orderPhase(insight, now);
  const step = orderStep(insight, now);
  const ended = step === 0;
  // Delivered (or the user said so) is green; "probably" is grey: it's a guess, not news.
  const tone = phase === "stale" ? "guess" : step === 3 ? "done" : ended ? "ended" : "open";
  return (
    <div className="mt-2.5 flex items-center gap-2.5 pl-12">
      <div className="flex flex-1 gap-1">
        {[1, 2, 3].map((n) => (
          <span
            key={n}
            className={cn(
              "h-1 flex-1 rounded-full",
              n > step || tone === "ended" ? "bg-ink/10" : tone === "done" ? "bg-success" : tone === "guess" ? "bg-ink/25" : "bg-accent",
            )}
          />
        ))}
      </div>
      <span className={cn("shrink-0 text-[12px] font-medium", tone === "done" ? "text-success" : tone === "open" ? "text-ink-2" : "text-ink-3")}>
        {orderLabel(insight, now)}
      </span>
    </div>
  );
}

/**
 * The facts worth a glance (when it arrives, where to track it, by when to pay or pick it up) and
 * the one thing the email can't know: that it's done.
 */
function Details({ card }: { card: InsightCard }) {
  const now = useNow();
  const setInsightDone = useMail((s) => s.setInsightDone);
  const pushToast = useMail((s) => s.pushToast);
  const i = card.insight;
  const chips: React.ReactNode[] = [];
  const chip = (key: string, content: React.ReactNode, tone: Tone = "neutral") =>
    chips.push(
      <span
        key={key}
        className={cn(
          "inline-flex h-6 items-center gap-1 rounded-full px-2 text-[11.5px] font-medium",
          tone === "bad" ? "bg-danger/10 text-danger" : tone === "warn" ? "bg-warning/15 text-ink" : tone === "good" ? "bg-success/12 text-success" : "bg-hover text-ink-2",
        )}
      >
        {content}
      </span>,
    );
  const done = doneAction(i, now);

  if (i.order) {
    const o = i.order;
    const open = orderPhase(i, now) === "open";
    if (open) {
      const pickupBy = parseLocal(o.pickupBy);
      if (o.status === "ready_for_pickup" && pickupBy !== null && !isSale(i))
        chip("pickup", t("Pick up by {date}", { date: formatDay(o.pickupBy)! }), pickupBy - now < 2 * DAY ? "warn" : "neutral");
      else if (o.expectedAt) chip("eta", t("Arrives {date}", { date: formatDay(o.expectedAt)! }));
      if (o.carrier) chip("carrier", o.carrier);
      const trackingUrl = safeHttpUrl(o.trackingUrl);
      if (trackingUrl) {
        chips.push(
          <a
            key="track"
            href={trackingUrl}
            target="_blank"
            rel="noreferrer noopener"
            onClick={(e) => e.stopPropagation()}
            className="inline-flex h-6 items-center gap-1 rounded-full bg-accent px-2.5 text-[11.5px] font-medium text-on-accent hover:bg-accent-hover"
          >
            {t("Track")} <ExternalLink size={11} />
          </a>,
        );
      } else if (o.trackingNumber) chip("tracking", <CopyText value={o.trackingNumber} />);
    }
    const returnBy = parseLocal(o.returnBy);
    if (!open && !isSale(i) && (o.status === "delivered" || markedDone(i)) && returnBy && returnBy > now)
      chip("return", t("Return by {date}", { date: formatDay(o.returnBy)! }), returnBy - now < 3 * DAY ? "warn" : "neutral");
  } else if (i.travel?.bookingCode) {
    chip("code", <CopyText value={i.travel.bookingCode} />);
  } else if (i.invoice) {
    const phase = invoicePhase(i, now);
    if (phase === "due") {
      const due = dueChip(i, now);
      if (due) chip("due", due.text, due.tone);
    } else if (phase === "paid" && (markedDone(i) || i.invoice.status === "paid")) chip("paid", t("Paid"), "good");
    else if (phase === "old") {
      const due = dueChip(i, now);
      if (due) chip("due", due.text);
    }
  } else if (i.security) {
    if (securityOpen(i, now)) {
      // "I don't know about it": the service's own page for that, never a link from a look-alike.
      const url = safeHttpUrl(i.security.actionUrl);
      if (url)
        chips.push(
          <a
            key="secure"
            href={url}
            target="_blank"
            rel="noreferrer noopener"
            onClick={(e) => e.stopPropagation()}
            className="inline-flex h-6 items-center gap-1 rounded-full bg-danger/10 px-2.5 text-[11.5px] font-medium text-danger hover:bg-danger/15"
          >
            {t("I don't know about it")} <ExternalLink size={11} />
          </a>,
        );
      else chip("tip", t("Not you? Change the password at {service}", { service: i.merchant ?? t("that service") }), "warn");
    } else if (markedDone(i)) chip("known", t("Checked"), "good");
  } else if (i.reply) {
    if (replyOpen(i, now) && i.reply.dueAt) chip("due", t("By {date}", { date: formatDay(i.reply.dueAt)! }), (parseLocal(i.reply.dueAt) ?? now) - now < 2 * DAY ? "warn" : "neutral");
    else if (!replyOpen(i, now) && markedDone(i)) chip("answered", t("Answered"), "good");
  } else if (i.subscription) {
    const s = i.subscription;
    if (s.status === "payment_failed") chip("failed", t("Payment failed"), "bad");
    else if (s.status === "trial" && s.trialEndsAt) chip("trial", t("Trial ends {date}", { date: formatDay(s.trialEndsAt)! }), "warn");
    else if (s.status === "cancelled") chip("cancelled", t("Cancelled"));
    else if (s.renewsAt) chip("renews", t("Renews {date}", { date: formatDay(s.renewsAt)! }));
  }
  if (!chips.length && !done) return null;
  const markDone = done;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5 pl-12">
      {chips}
      {markDone && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            setInsightDone(card.key, true);
            pushToast({ message: markDone.toast, undo: () => setInsightDone(card.key, false) });
          }}
          title={markDone.toast}
          className="ml-auto inline-flex h-6 items-center gap-1 rounded-full px-2 text-[11.5px] font-medium text-ink-2 shadow-[inset_0_0_0_0.5px_var(--line)] press hover:bg-selected hover:text-ink"
        >
          <Check size={12} strokeWidth={2.4} />
          {markDone.label}
        </button>
      )}
    </div>
  );
}

function CopyText({ value }: { value: string }) {
  const pushToast = useMail((s) => s.pushToast);
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        void navigator.clipboard
          .writeText(value)
          .then(() =>
            pushToast({
              message: t("Copied {value}", { value }),
              duration: 2000,
            }),
          )
          .catch(() => {});
      }}
      className="inline-flex items-center gap-1 font-mono tracking-[0.02em]"
    >
      {value} <Copy size={11} />
    </button>
  );
}

function TurnOn() {
  const setSmartCategories = useMail((s) => s.setSmartCategories);
  const setSettingsOpen = useMail((s) => s.setSettingsOpen);
  const plus = useMail((s) => s.plus);
  const ended = !!plus && plus.level === "none" && plus.trialUsed;
  const trial = !!plus && plus.level === "none" && !plus.trialUsed;
  return (
    <div className="mx-auto flex max-w-[320px] flex-col items-center gap-3 px-4 pt-16 text-center">
      <span className="flex size-11 items-center justify-center rounded-full bg-accent-soft text-accent-text">
        <Sparkles size={20} />
      </span>
      <div>
        <div className="text-[15px] font-semibold">{t("Orders, trips, invoices, subscriptions and security notices in one place")}</div>
        <p className="mt-1.5 text-[13px] leading-relaxed text-ink-3">
          {t(
            "TypeSafe sorts your incoming mail, and OpenAI reads the emails from the last three months that look like one of these to pull out amounts, dates and delivery status. Neither trains on your mail.",
          )}
        </p>
        {LIVE && plus && plus.level !== "plus" && (
          <p className="mt-1.5 text-[13px] leading-relaxed text-ink-3">
            {ended ? t("Part of Kolbaba Plus. Your trial has ended.") : t("Part of Kolbaba Plus. The first {n} days are free, no card needed.", { n: TRIAL_DAYS })}
          </p>
        )}
      </div>
      <button
        onClick={() => (ended ? setSettingsOpen(true, "smart") : setSmartCategories(true))}
        className="h-9 rounded-full bg-accent px-4 text-[13px] font-medium text-on-accent press hover:bg-accent-hover"
      >
        {ended ? t("See Plus") : trial ? t("Try it free for {n} days", { n: TRIAL_DAYS }) : t("Turn on smart categories")}
      </button>
    </div>
  );
}

function TurnOnReplies() {
  const setReplyReminders = useMail((s) => s.setReplyReminders);
  return (
    <div className="mx-auto flex max-w-[320px] flex-col items-center gap-3 px-4 pt-16 text-center">
      <span className="flex size-11 items-center justify-center rounded-full bg-accent-soft text-accent-text">
        <MessageSquareReply size={20} />
      </span>
      <div>
        <div className="text-[15px] font-semibold">{t("See who's waiting for your answer")}</div>
        <p className="mt-1.5 text-[13px] leading-relaxed text-ink-3">
          {t("Emails from people that seem to ask you something go to OpenAI too, which says what they want. Once you reply, they leave this list.")}
        </p>
      </div>
      <button
        onClick={() => setReplyReminders(true)}
        className="h-9 rounded-full bg-accent px-4 text-[13px] font-medium text-on-accent press hover:bg-accent-hover"
      >
        {t("Turn on")}
      </button>
    </div>
  );
}

const EMPTY: Record<CategoryView, string> = {
  orders: tk("No orders yet"),
  travel: tk("No trips yet"),
  invoices: tk("No invoices yet"),
  subscriptions: tk("No subscriptions yet"),
  security: tk("No security notices"),
  replies: tk("Nobody is waiting for your reply"),
};

function Empty({ view }: { view: CategoryView }) {
  const Icon = CATEGORY_ICONS[view];
  return (
    <div className="flex flex-col items-center gap-2 px-6 pt-20 text-center">
      <Icon size={26} className="text-ink-3" />
      <div className="text-[15px] font-semibold">{t(EMPTY[view])}</div>
      {LIVE && <p className="text-[13px] text-ink-3">{t("Kolbaba goes through your mail in the background. Older mail can take a while.")}</p>}
    </div>
  );
}
