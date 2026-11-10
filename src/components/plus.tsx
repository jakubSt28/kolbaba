"use client";

import { Gift, LoaderCircle, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { intlLocale, t, tn } from "@/lib/i18n";
import { PLUS_PRICES, TRIAL_DAYS, trialDaysLeft, type PlusInterval, type PlusState } from "@/lib/plus";
import { useMail } from "@/lib/store";
import { useNow } from "@/lib/use-now";
import { cn } from "@/lib/utils";

/**
 * Kolbaba Plus in the app: the panel at the top of Settings → Smart features (what you have, until
 * when, and the way to pay or manage it), and the quiet line on top of a category when the trial is
 * ending or over. Nothing pops up on its own.
 */

const czk = (amount: number) => new Intl.NumberFormat(intlLocale(), { style: "currency", currency: "CZK", maximumFractionDigits: 0 }).format(amount);
const day = (ms: number) => new Intl.DateTimeFormat(intlLocale(), { day: "numeric", month: "numeric", year: "numeric" }).format(ms);

/** Settings → Smart features, first thing. Asks Stripe for the latest when it opens (a cancellation done elsewhere shows). */
export function PlusPanel() {
  const plus = useMail((s) => s.plus);
  const refreshPlus = useMail((s) => s.refreshPlus);
  useEffect(() => {
    void refreshPlus({ stripe: true });
  }, [refreshPlus]);
  if (!plus) return null;
  return (
    <div className="mb-5 overflow-hidden rounded-[14px] bg-solid shadow-[inset_0_0_0_0.5px_var(--line)]">
      <div className="flex items-start gap-3 px-4 pt-3.5 pb-3">
        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent-text">
          {plus.source === "gift" ? <Gift size={16} /> : <Sparkles size={16} />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-semibold">Kolbaba Plus</div>
          <PlusStatus plus={plus} />
        </div>
      </div>
      <PlusActions plus={plus} />
    </div>
  );
}

function PlusStatus({ plus }: { plus: PlusState }) {
  const now = useNow();
  const line = (text: string, tone: "plain" | "warn" = "plain") => (
    <p className={cn("mt-0.5 text-[12.5px] leading-snug", tone === "warn" ? "text-danger" : "text-ink-3")}>{text}</p>
  );
  if (plus.source === "gift") return line(t("A gift from us: every smart feature, free."));
  if (plus.source === "subscription") {
    const price = plus.interval === "year" ? t("{price} a year", { price: czk(PLUS_PRICES.year) }) : t("{price} a month", { price: czk(PLUS_PRICES.month) });
    if (plus.pastDue) return line(t("The last payment didn't go through. Stripe will try again; you can change the card below."), "warn");
    if (plus.cancelsAtEnd && plus.periodEnd) return line(t("Cancelled. Plus stays on until {date}.", { date: day(plus.periodEnd) }));
    return line(plus.periodEnd ? `${price} · ${t("Next payment {date}", { date: day(plus.periodEnd) })}` : price);
  }
  if (plus.level === "trial") {
    const left = trialDaysLeft(plus, now);
    return line(`${tn(left, "Trial: {n} day left", "Trial: {n} days left")} · ${t("until {date}", { date: day(plus.trialEndsAt!) })}`);
  }
  if (plus.trialUsed) return line(t("Your trial has ended. Cards you already have stay; new ones come with Plus."));
  return line(t("Smart categories, Awaiting my reply and summaries. The first {n} days are free, no card needed: they start when you turn one of them on.", { n: TRIAL_DAYS }));
}

function PlusActions({ plus }: { plus: PlusState }) {
  const billing = useMail((s) => s.billing);
  const subscribePlus = useMail((s) => s.subscribePlus);
  const managePlus = useMail((s) => s.managePlus);
  const setSmartCategories = useMail((s) => s.setSmartCategories);
  const smartCategories = useMail((s) => s.smartCategories);
  const [busy, setBusy] = useState<PlusInterval | "manage" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const go = async (what: PlusInterval | "manage") => {
    setBusy(what);
    setError(null);
    const problem = await (what === "manage" ? managePlus() : subscribePlus(what));
    // Still here: Stripe didn't open. Say why right under the button (a toast would hide behind Settings).
    if (problem) {
      setError(problem);
      setBusy(null);
    }
  };
  const errorLine = error && <p className="text-[12px] leading-snug text-danger">{error}</p>;

  if (plus.source === "gift") return null;
  if (plus.source === "subscription")
    return (
      <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-3">
        <ActionButton busy={busy === "manage"} onClick={() => void go("manage")}>
          {t("Manage subscription")}
        </ActionButton>
        <span className="text-[11.5px] text-ink-3">{t("Card, invoices and cancelling, on Stripe")}</span>
        {errorLine}
      </div>
    );

  const trialUnused = plus.level === "none" && !plus.trialUsed;
  return (
    <div className="flex flex-col gap-2 border-t border-line px-4 py-3">
      {trialUnused && !smartCategories && (
        <ActionButton primary onClick={() => setSmartCategories(true)}>
          {t("Try it free for {n} days", { n: TRIAL_DAYS })}
        </ActionButton>
      )}
      {billing ? (
        <>
          <div className="grid grid-cols-2 gap-2">
            <ActionButton primary={!trialUnused || smartCategories} busy={busy === "month"} onClick={() => void go("month")}>
              {t("{price} a month", { price: czk(PLUS_PRICES.month) })}
            </ActionButton>
            <ActionButton primary={!trialUnused || smartCategories} busy={busy === "year"} onClick={() => void go("year")}>
              {t("{price} a year", { price: czk(PLUS_PRICES.year) })}
            </ActionButton>
          </div>
          {errorLine}
          <p className="text-[11.5px] leading-snug text-ink-3">
            {plus.level === "trial"
              ? t("Subscribe now and pay when the trial ends. A year costs as much as ten months. Cancel any time.")
              : t("A year costs as much as ten months. Cancel any time; Plus then lasts until the end of the period you paid for.")}
          </p>
        </>
      ) : (
        <p className="text-[11.5px] leading-snug text-ink-3">
          {t("Paying for Plus opens in a few days: {month} a month or {year} a year.", { month: czk(PLUS_PRICES.month), year: czk(PLUS_PRICES.year) })}
        </p>
      )}
    </div>
  );
}

function ActionButton({ children, onClick, primary = false, busy = false }: { children: React.ReactNode; onClick: () => void; primary?: boolean; busy?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className={cn(
        "flex h-9 items-center justify-center gap-1.5 rounded-full px-4 text-[13px] font-medium press disabled:opacity-70",
        primary ? "bg-accent text-on-accent hover:bg-accent-hover" : "text-ink shadow-[inset_0_0_0_0.5px_var(--line)] hover:bg-hover",
      )}
    >
      {busy && <LoaderCircle size={13} className="animate-spin" />}
      {children}
    </button>
  );
}

/**
 * On top of a category: the trial's last three days, or that it ended (new cards stopped, the ones
 * here stay). One calm line with one button; nothing else changes.
 */
export function PlusNotice() {
  const plus = useMail((s) => s.plus);
  const setSettingsOpen = useMail((s) => s.setSettingsOpen);
  const now = useNow();
  if (!plus) return null;
  const left = trialDaysLeft(plus, now);
  let text: string | null = null;
  if (plus.level === "none" && plus.trialUsed) text = t("Your trial has ended, so no new cards are added. The ones here stay.");
  else if (plus.level === "trial" && left <= 3) text = tn(left, "Your Plus trial ends in {n} day.", "Your Plus trial ends in {n} days.");
  else if (plus.pastDue) text = t("The last payment for Plus didn't go through.");
  if (!text) return null;
  return (
    <div className="mx-0.5 mt-1 flex items-center gap-3 rounded-[12px] bg-hover px-3 py-2 text-[12.5px] text-ink-2">
      <span className="min-w-0 flex-1">{text}</span>
      <button onClick={() => setSettingsOpen(true, "smart")} className="shrink-0 font-medium text-accent-text hover:underline">
        {plus.pastDue ? t("Change card") : t("See Plus")}
      </button>
    </div>
  );
}
