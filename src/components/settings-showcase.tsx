"use client";

import { ChevronRight, Gift, Lightbulb, ShieldCheck, Star } from "lucide-react";
import { useEffect } from "react";
import { BRAND } from "@/lib/brand";
import { intlLocale, t, tn } from "@/lib/i18n";
import { POSTCARD_TOTAL } from "@/lib/postcard";
import { STAMPS } from "@/lib/stamps";
import { useMail } from "@/lib/store";
import { cn } from "@/lib/utils";
import { LATEST_NOTE, RELEASE_NOTES } from "@/lib/whats-new";
import { StampArt } from "./stamp-art";

/**
 * Settings → Account: what Kolbaba has for you, as cards worth opening rather than rows with an
 * Open button: what's new, the collection, the tracking he held back, and feedback.
 */

const card = "rounded-[16px] bg-solid shadow-[inset_0_0_0_0.5px_var(--line)]";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-5 last:mb-0">
      <div className="px-1 pb-1.5 text-[12px] font-medium text-ink-3">{title}</div>
      <div className="flex flex-col gap-2.5">{children}</div>
    </div>
  );
}

const leave = (then: () => void) => {
  useMail.getState().setSettingsOpen(false);
  setTimeout(then, 120);
};

export function KolbabaShowcase() {
  return (
    <Section title={BRAND.name}>
      <WhatsNewCard />
      <CollectionCard />
      <TrackingCard />
    </Section>
  );
}

function WhatsNewCard() {
  const latest = RELEASE_NOTES[0];
  const unseen = useMail((s) => s.newsSeen !== null && s.newsSeen !== LATEST_NOTE);
  const date = new Intl.DateTimeFormat(intlLocale(), { day: "numeric", month: "long" }).format(new Date(latest.date));
  return (
    <button onClick={() => leave(() => useMail.getState().setNewsOpen("news"))} className={cn(card, "press flex w-full items-start gap-3.5 p-4 text-left [--press-scale:0.985]")}>
      <span className="flex size-11 shrink-0 items-center justify-center rounded-[13px] bg-linear-to-br from-[oklch(0.78_0.14_55)] to-[oklch(0.63_0.2_15)] text-white shadow-[0_4px_12px_-4px_oklch(0.63_0.2_15/0.6)]">
        <Gift size={20} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-[11.5px] font-medium text-ink-3">
          {t("What's new")} · {date}
          {unseen && <span className="rounded-full bg-accent px-1.5 py-px text-[10px] font-semibold text-on-accent">{t("New@@news")}</span>}
        </span>
        <span className="mt-0.5 block text-[14.5px] font-semibold">{t(latest.title)}</span>
        <span className="mt-0.5 line-clamp-2 block text-[12.5px] leading-snug text-ink-2">{t(latest.body)}</span>
      </span>
      <ChevronRight size={16} className="mt-3.5 shrink-0 text-ink-3" />
    </button>
  );
}

function CollectionCard() {
  const stamps = useMail((s) => s.stamps);
  const postcards = useMail((s) => Object.keys(s.postcards).length);
  const on = useMail((s) => s.stampsOn);
  const setOn = useMail((s) => s.setStampsOn);
  // The last three that came, newest on top; outlines while there are fewer.
  const recent = STAMPS.filter((d) => stamps[d.id])
    .sort((a, b) => stamps[a.id] - stamps[b.id])
    .slice(-3);
  const got = Object.keys(stamps).length;
  const share = (got + postcards) / (STAMPS.length + POSTCARD_TOTAL);
  return (
    <div className={cn(card, "overflow-hidden")}>
      <button onClick={() => on && leave(() => useMail.getState().setCollectionOpen("stamps"))} disabled={!on} className="press flex w-full items-center gap-4 p-4 text-left [--press-scale:0.985] disabled:opacity-60">
        <span className="relative h-[66px] w-[92px] shrink-0">
          {[0, 1, 2].map((i) => {
            const def = recent[i];
            return (
              <span
                key={i}
                className="absolute top-1 text-ink-3"
                style={{ left: i * 22, rotate: `${(i - 1) * 9}deg`, zIndex: i }}
              >
                {def ? <StampArt id={def.id} width={44} /> : <StampArt id={STAMPS[i].id} width={44} muted />}
              </span>
            );
          })}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[14.5px] font-semibold">{t("Collection")}</span>
          <span className="mt-0.5 block text-[12.5px] text-ink-2">
            {t("{n} of {total} stamps", { n: got, total: STAMPS.length })} · {t("{n} of {total} postcards", { n: postcards, total: POSTCARD_TOTAL })}
          </span>
          <span className="mt-2 block h-1.5 overflow-hidden rounded-full bg-hover">
            <span className="block h-full rounded-full bg-accent transition-[width] duration-700" style={{ width: `${Math.max(3, share * 100)}%` }} />
          </span>
        </span>
        <ChevronRight size={16} className="shrink-0 text-ink-3" />
      </button>
      <div className="flex items-center justify-between gap-4 border-t border-line px-4 py-3">
        <span className="min-w-0">
          <span className="block text-[13.5px]">{t("Collect stamps and postcards")}</span>
          <span className="mt-0.5 block text-[12px] text-ink-3">{t("Small milestones as postage stamps, and a postcard for an empty Inbox")}</span>
        </span>
        <SwitchLike on={on} label={t("Collect stamps and postcards")} onChange={setOn} />
      </div>
    </div>
  );
}

/** The same switch as Settings' Toggle, kept here so this file doesn't import settings.tsx back. */
function SwitchLike({ on, label, onChange }: { on: boolean; label: string; onChange: (on: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={cn("relative h-[24px] w-[42px] shrink-0 rounded-full transition-colors", on ? "bg-accent" : "bg-selected")}
    >
      <span className={cn("absolute top-[2px] size-[20px] rounded-full bg-white shadow-[0_1px_3px_rgb(0_0_0/0.2)] transition-[left] duration-200", on ? "left-[20px]" : "left-[2px]")} />
    </button>
  );
}

function TrackingCard() {
  const stats = useMail((s) => s.stats);
  const loadStats = useMail((s) => s.loadStats);
  useEffect(() => void loadStats(), [loadStats]);
  const week = stats?.trackersWeek ?? 0;
  return (
    <div className={cn(card, "flex items-start gap-3.5 p-4")}>
      <span className="flex size-11 shrink-0 items-center justify-center rounded-[13px] bg-success/14 text-success">
        <ShieldCheck size={20} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[11.5px] font-medium text-ink-3">{t("Tracking held back")}</span>
        <span className="mt-0.5 block text-[14.5px] font-semibold">{tn(week, "{n} email this week", "{n} emails this week")}</span>
        <span className="mt-0.5 block text-[12.5px] leading-snug text-ink-2">
          {t("Emails that wanted to see when you open them, and didn't get to. {n} since counting began.", { n: stats?.trackersTotal ?? 0 })}
        </span>
      </span>
    </div>
  );
}

/** Feedback as two cards side by side: an idea, and the 0–10 question. */
export function FeedbackCards({ mobile }: { mobile: boolean }) {
  return (
    <Section title={t("Feedback")}>
      <div className={cn("grid gap-2.5", mobile ? "grid-cols-1" : "grid-cols-2")}>
        <button
          onClick={() => useMail.getState().setFeedback("idea")}
          className={cn(card, "press flex flex-col items-start p-4 text-left [--press-scale:0.98]")}
        >
          <span className="flex size-10 items-center justify-center rounded-[12px] bg-[oklch(0.85_0.13_85/0.35)] text-[oklch(0.62_0.14_75)] dark:text-[oklch(0.82_0.14_85)]">
            <Lightbulb size={19} />
          </span>
          <span className="mt-3 text-[14px] font-semibold">{t("Suggest an improvement")}</span>
          <span className="mt-0.5 text-[12.5px] leading-snug text-ink-2">{t("What's missing or in the way? A sentence is plenty.")}</span>
        </button>
        <button
          onClick={() => leave(() => useMail.getState().setFeedback("nps"))}
          className={cn(card, "press flex flex-col items-start p-4 text-left [--press-scale:0.98]")}
        >
          <span className="flex size-10 items-center justify-center rounded-[12px] bg-accent-soft text-accent-text">
            <Star size={19} />
          </span>
          <span className="mt-3 text-[14px] font-semibold">{t("Rate {app}", { app: BRAND.name })}</span>
          <span className="mt-0.5 text-[12.5px] leading-snug text-ink-2">{t("Would you recommend it to a friend?")}</span>
          <span className="mt-2.5 flex w-full gap-[3px]" aria-hidden>
            {Array.from({ length: 11 }, (_, i) => (
              <span key={i} className="h-1.5 flex-1 rounded-full" style={{ background: `oklch(0.7 0.15 ${25 + i * 12} / ${0.35 + i * 0.05})` }} />
            ))}
          </span>
        </button>
      </div>
    </Section>
  );
}
