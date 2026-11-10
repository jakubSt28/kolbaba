"use client";

import { Archive, BellOff, Check, Eye, ImageOff, Newspaper, Inbox, MessageSquareReply, Package, Plane, ReceiptText, Repeat, ShieldCheck, Sparkles, X, type LucideIcon } from "lucide-react";
import { AnimatePresence, motion, MotionConfig, useReducedMotion } from "motion/react";
import { useEffect, useId, useRef, useState, type Ref } from "react";
import { getLocale, t, tn } from "@/lib/i18n";
import { ORDER_LABELS, formatDay } from "@/lib/insights";
import { folderLabel } from "@/lib/store";
import type { Density } from "@/lib/types";
import { cn } from "@/lib/utils";
import { BrandMark } from "./brand-mark";
import { Avatar, hueStyle, softSpring, spring } from "./ui";

/*
 * Settings show what a choice does: small pictures of the list and of each feature, drawn with the
 * same parts as the real thing. The feature pictures play a short loop while they're on screen (and
 * hold still with reduced motion). They're pictures, so they can't be clicked and screen readers skip them.
 */

const DAY = 86_400_000;
const isoDay = (offset: number) => new Date(Date.now() + offset * DAY).toISOString().slice(0, 10);
const day = (offset: number) => formatDay(isoDay(offset)) ?? "";
/** Sample prices in the reader's currency. */
const money = (cs: string, en: string) => (getLocale() === "cs" ? cs : en);

/* --------------------------------- Density -------------------------------- */

/** Rows of a list sketched as bars: a picture of how much fits, not of any particular mail. */
const SKETCH = [
  { hue: 25, name: 46, subject: 72, unread: true },
  { hue: 205, name: 36, subject: 58 },
  { hue: 150, name: 54, subject: 66, unread: true },
  { hue: 285, name: 40, subject: 50 },
  { hue: 75, name: 48, subject: 70 },
  { hue: 330, name: 34, subject: 60 },
  { hue: 180, name: 44, subject: 54 },
];

function Sketch({ compact }: { compact: boolean }) {
  return (
    <div className={cn("flex flex-col", compact ? "gap-[5px] px-2 pt-2" : "gap-2 px-2 pt-2")}>
      {SKETCH.map((r, i) => (
        <div key={i} className={cn("flex gap-1.5", compact ? "items-center" : "items-start")}>
          <span className={cn("hue-tint shrink-0 rounded-full", compact ? "size-[9px]" : "mt-px size-[15px]")} style={hueStyle(r.hue)} />
          {compact ? (
            <>
              <span className={cn("h-[4px] shrink-0 rounded-full", r.unread ? "bg-ink/70" : "bg-ink/40")} style={{ width: `${r.name * 0.55}%` }} />
              <span className="h-[3.5px] min-w-0 flex-1 rounded-full bg-ink/18" />
              <span className="h-[3px] w-[9%] shrink-0 rounded-full bg-ink/18" />
            </>
          ) : (
            <span className="flex min-w-0 flex-1 flex-col gap-[3px] pt-px">
              <span className="flex items-center gap-1.5">
                <span className={cn("h-[4px] rounded-full", r.unread ? "bg-ink/70" : "bg-ink/40")} style={{ width: `${r.name}%` }} />
                <span className="ml-auto h-[3px] w-[13%] rounded-full bg-ink/18" />
              </span>
              <span className="h-[3.5px] rounded-full bg-ink/30" style={{ width: `${r.subject}%` }} />
              <span className="h-[3px] w-[94%] rounded-full bg-ink/12" />
              <span className="h-[3px] w-[68%] rounded-full bg-ink/12" />
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

/** List density as two pictures to pick from: the same list, comfortable and compact. */
export function DensityPicker({ value, onChange }: { value: Density; onChange: (d: Density) => void }) {
  const options: { value: Density; label: string; hint: string }[] = [
    { value: "comfortable", label: t("Comfortable"), hint: t("Sender, subject and two lines of the email") },
    { value: "compact", label: t("Compact"), hint: t("One line per email, twice as many on screen") },
  ];
  return (
    <div role="radiogroup" aria-label={t("List density")} className="grid grid-cols-2 gap-3">
      {options.map((o) => {
        const on = value === o.value;
        return (
          <button key={o.value} role="radio" aria-checked={on} onClick={() => onChange(o.value)} className="group/density min-w-0 text-left">
            <span
              className={cn(
                "relative block h-[96px] overflow-hidden rounded-[12px] bg-canvas p-1.5 pb-0 transition-shadow duration-150",
                on ? "shadow-[0_0_0_2px_var(--accent)]" : "shadow-[inset_0_0_0_1px_var(--line)] group-hover/density:shadow-[inset_0_0_0_1px_var(--ink-3)]",
              )}
              aria-hidden
            >
              <span className="block h-full overflow-hidden rounded-t-[8px] bg-solid shadow-[0_0_0_0.5px_var(--line)]">
                <Sketch compact={o.value === "compact"} />
              </span>
              {/* The list goes on below the picture. */}
              <span className="absolute inset-x-1.5 bottom-0 h-6 bg-linear-to-t from-solid to-transparent" />
            </span>
            <span className="mt-2 flex items-center gap-2 px-0.5">
              <span
                className={cn(
                  "flex size-4 shrink-0 items-center justify-center rounded-full transition-colors",
                  on ? "bg-accent text-on-accent" : "shadow-[inset_0_0_0_1.5px_var(--ink-3)]",
                )}
              >
                {on && <Check size={10} strokeWidth={3.2} />}
              </span>
              <span className={cn("text-[13px]", on ? "font-medium text-ink" : "text-ink-2")}>{o.label}</span>
            </span>
            <span className="mt-0.5 block pl-[26px] text-[11.5px] leading-snug text-ink-3">{o.hint}</span>
          </button>
        );
      })}
    </div>
  );
}

/* ----------------------------- Smart features ----------------------------- */

/**
 * A loop of steps, each shown for its time in ms. It runs only while the picture is on screen; with
 * reduced motion it stays on `still`, the step that explains the feature best.
 */
function useFilm(durations: readonly number[], still: number) {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const [step, setStep] = useState(0);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setInView(e.isIntersecting), { threshold: 0.3 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const ms = durations[step];
  const n = durations.length;
  useEffect(() => {
    if (reduce || !inView) return;
    const id = setTimeout(() => setStep((s) => (s + 1) % n), ms);
    return () => clearTimeout(id);
  }, [reduce, inView, ms, n, step]);
  return { ref, step: reduce ? still : step };
}

/** The frame every feature picture sits in: a bit of canvas with the app's own card on it. */
function Frame({ children, className, ref }: { children: React.ReactNode; className?: string; ref?: Ref<HTMLDivElement> }) {
  return (
    <div ref={ref} aria-hidden className={cn("pointer-events-none overflow-hidden rounded-[12px] bg-canvas p-2 select-none", className)}>
      <MotionConfig reducedMotion="user">{children}</MotionConfig>
    </div>
  );
}

/** One row of the list, as it looks in the app, with whatever the feature adds under the subject. */
function SampleRow({ name, email, time, subject, children }: { name: string; email: string; time: string; subject: string; children?: React.ReactNode }) {
  return (
    <div className="flex gap-2.5 rounded-[10px] bg-solid px-2.5 py-2 shadow-[0_0_0_0.5px_var(--line)]">
      <Avatar person={{ name, email }} size={30} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-ink">{name}</span>
          <span className="shrink-0 text-[11px] text-ink-3 tabular-nums">{time}</span>
        </div>
        <div className="truncate text-[12px] text-ink">{subject}</div>
        {children}
      </div>
    </div>
  );
}

type Tone = "good" | "warn" | "neutral";

/** What the feature adds to a row. It arrives a moment after the row, with a glint: the app noticed. */
function Chip({ icon: Icon, tone, children, delay = 0.45 }: { icon: LucideIcon; tone: Tone; children: React.ReactNode; delay?: number }) {
  return (
    <motion.span
      initial={{ opacity: 0, scale: 0.85 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ ...spring, delay }}
      className={cn(
        "relative mt-1 inline-flex max-w-full origin-left items-center gap-1 overflow-hidden rounded-full px-2 py-0.5 text-[11px] font-medium",
        tone === "good" ? "bg-success/12 text-success" : tone === "warn" ? "bg-warning/15 text-ink" : "bg-hover text-ink-2",
      )}
    >
      <Icon size={10.5} className="shrink-0" />
      <span className="truncate">{children}</span>
      <motion.span
        className="absolute inset-y-0 w-1/2 bg-linear-to-r from-transparent via-white/60 to-transparent dark:via-white/20"
        initial={{ left: "-60%" }}
        animate={{ left: "120%" }}
        transition={{ duration: 0.8, delay: delay + 0.15, ease: "easeOut" }}
      />
    </motion.span>
  );
}

const CATEGORY_PILLS = [
  { id: "orders", icon: Package },
  { id: "travel", icon: Plane },
  { id: "invoices", icon: ReceiptText },
  { id: "subscriptions", icon: Repeat },
  { id: "security", icon: ShieldCheck },
] as const;

type CategoryId = (typeof CATEGORY_PILLS)[number]["id"];

/** One sample email per category, with the line the app pulls out of it. */
function categoryScenes(): { id: CategoryId; icon: LucideIcon; name: string; email: string; time: string; subject: string; tone: Tone; chip: string }[] {
  return [
    {
      id: "orders",
      icon: Package,
      name: "Alza.cz",
      email: "objednavky@alza.cz",
      time: "10:24",
      subject: t("Your order has been delivered"),
      tone: "good",
      chip: [t(ORDER_LABELS.delivered), t("return by {date}", { date: day(14) }), money("1 290 Kč", "€49")].join(" · "),
    },
    {
      id: "travel",
      icon: Plane,
      name: "Smartwings",
      email: "booking@smartwings.com",
      time: "9:02",
      subject: t("Your flight to Barcelona"),
      tone: "neutral",
      chip: `PRG → BCN · ${formatDay(`${isoDay(9)}T10:35`, true)}`,
    },
    {
      id: "invoices",
      icon: ReceiptText,
      name: "Vodafone",
      email: "faktury@vodafone.cz",
      time: "8:15",
      subject: t("Your invoice is ready"),
      tone: "warn",
      chip: [money("649 Kč", "€24"), t("Due {date}", { date: day(2) })].join(" · "),
    },
    {
      id: "subscriptions",
      icon: Repeat,
      name: "Spotify",
      email: "no-reply@spotify.com",
      time: t("Yesterday"),
      subject: t("Your free trial ends soon"),
      tone: "warn",
      chip: [t("{price} / month", { price: money("169 Kč", "€10.99") }), t("trial ends {date}", { date: day(3) })].join(" · "),
    },
    {
      id: "security",
      icon: ShieldCheck,
      name: "Google",
      email: "no-reply@accounts.google.com",
      time: "7:48",
      subject: t("New sign-in on Mac"),
      tone: "warn",
      chip: [t("New sign-in"), "Mac", t("Prague")].join(" · "),
    },
  ];
}

/** Smart categories: their own pages in the sidebar, and what's going on right in the row, one category after another. */
export function CategoriesPreview() {
  const scenes = categoryScenes();
  const { ref, step } = useFilm([2800, 2800, 2800, 2800, 2800], 0);
  const scene = scenes[step];
  const pill = useId();
  return (
    <Frame ref={ref}>
      <div className="mb-2 flex flex-wrap gap-1">
        {CATEGORY_PILLS.map(({ id, icon: Icon }) => {
          const on = id === scene.id;
          return (
            <span
              key={id}
              className={cn(
                "relative inline-flex items-center gap-1 rounded-full bg-solid px-2 py-0.5 text-[11px] font-medium shadow-[0_0_0_0.5px_var(--line)] transition-colors duration-300",
                on ? "text-accent-text" : "text-ink-2",
              )}
            >
              {on && <motion.span layoutId={pill} transition={spring} className="absolute inset-0 rounded-full bg-accent-soft" />}
              <Icon size={11} className={cn("relative transition-colors duration-300", on ? "text-accent-text" : "text-ink-3")} />
              <span className="relative">{folderLabel(id)}</span>
            </span>
          );
        })}
      </div>
      <div className="relative">
        <AnimatePresence initial={false} mode="popLayout">
          <motion.div key={scene.id} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -14 }} transition={softSpring}>
            <SampleRow name={scene.name} email={scene.email} time={scene.time} subject={scene.subject}>
              <Chip icon={scene.icon} tone={scene.tone}>
                {scene.chip}
              </Chip>
            </SampleRow>
          </motion.div>
        </AnimatePresence>
      </div>
    </Frame>
  );
}

/** Awaiting my reply: an email from a person comes in, then the app marks that they're waiting for an answer. */
export function RepliesPreview() {
  const { ref, step } = useFilm([1000, 2800, 1000, 2800], 1);
  const scenes = [
    { name: "Petra Nováková", email: "petra.novakova@example.cz", time: t("Yesterday"), subject: t("Are you coming on Saturday?"), by: day(2) },
    { name: "Tomáš Dvořák", email: "tomas@dvorak-studio.example", time: "11:20", subject: t("Could you send me the signed contract?"), by: day(1) },
  ];
  const scene = scenes[Math.floor(step / 2)];
  return (
    <Frame ref={ref}>
      <div className="relative">
        <AnimatePresence initial={false} mode="popLayout">
          <motion.div key={scene.name} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -14 }} transition={softSpring}>
            <SampleRow name={scene.name} email={scene.email} time={scene.time} subject={scene.subject}>
              {/* Room for the chip from the start, so nothing below moves when it arrives. */}
              <div className="h-[22px]">
                {step % 2 === 1 && (
                  <Chip icon={MessageSquareReply} tone="warn" delay={0}>
                    {t("Waiting for your reply")} · {t("by {date}", { date: scene.by })}
                  </Chip>
                )}
              </div>
            </SampleRow>
          </motion.div>
        </AnimatePresence>
      </div>
    </Frame>
  );
}

/** A conversation sketched as bars, under the summary. */
function ConversationSketch() {
  return (
    <div className="flex flex-col gap-2 px-1 pt-1">
      {[
        { hue: 205, w: [34, 92, 70] },
        { hue: 25, w: [28, 84, 56] },
        { hue: 205, w: [34, 76, 88] },
      ].map((m, i) => (
        <div key={i} className="flex items-start gap-1.5">
          <span className="hue-tint mt-px size-[14px] shrink-0 rounded-full" style={hueStyle(m.hue)} />
          <span className="flex min-w-0 flex-1 flex-col gap-[3px] pt-0.5">
            <span className="h-[4px] rounded-full bg-ink/40" style={{ width: `${m.w[0]}%` }} />
            <span className="h-[3px] rounded-full bg-ink/14" style={{ width: `${m.w[1]}%` }} />
            <span className="h-[3px] rounded-full bg-ink/14" style={{ width: `${m.w[2]}%` }} />
          </span>
        </div>
      ))}
    </div>
  );
}

/** Summaries: Summarize in a long conversation, a moment of work, and where things stand in a few lines. */
export function SummaryPreview() {
  const { ref, step } = useFilm([1500, 1100, 4400], 2);
  const loading = step === 1;
  const done = step === 2;
  // Both layers share one grid cell, so the picture is as tall as the taller one and never jumps.
  return (
    <Frame ref={ref}>
      <div className="rounded-[10px] bg-solid p-1.5 shadow-[0_0_0_0.5px_var(--line)]">
        <div className="flex items-center gap-2 px-1 pb-2">
          <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-ink">{t("New website")}</span>
          <span className="shrink-0 text-[11px] text-ink-3">{tn(4, "{n} message", "{n} messages")}</span>
        </div>
        <div className="grid">
          <div className="[grid-area:1/1]">
            <motion.span
              animate={{ scale: loading ? 0.94 : 1 }}
              transition={spring}
              className={cn(
                "ml-1 inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[11.5px] font-medium text-accent-text shadow-[inset_0_0_0_0.5px_var(--line)] transition-colors",
                loading && "bg-accent-soft",
              )}
            >
              <motion.span animate={loading ? { rotate: 360 } : { rotate: 0 }} transition={loading ? { duration: 1, ease: "linear", repeat: Infinity } : { duration: 0 }} className="flex">
                <Sparkles size={12} />
              </motion.span>
              {loading ? t("Summarizing…") : t("Summarize")}
            </motion.span>
            <div className="mt-2">
              <ConversationSketch />
            </div>
          </div>
          <motion.div
            initial={false}
            animate={done ? { opacity: 1, y: 0, scale: 1 } : { opacity: 0, y: -8, scale: 0.98 }}
            transition={done ? softSpring : { duration: 0.2 }}
            className="z-10 origin-top self-start rounded-lg bg-accent-soft px-3 py-2.5 text-[12px] leading-relaxed text-ink shadow-[0_0_0_0.5px_var(--line)] backdrop-blur-md [grid-area:1/1]"
          >
            <div className="mb-1 flex items-center gap-1.5 text-[11px] font-medium text-accent-text">
              <Sparkles size={11} /> {t("Summary")}
            </div>
            <motion.p animate={{ opacity: done ? 1 : 0 }} transition={{ delay: done ? 0.25 : 0, duration: 0.4 }}>
              {t("Tomáš likes the new design and asks for one change on the home page.")}
            </motion.p>
            <motion.div animate={{ opacity: done ? 1 : 0 }} transition={{ delay: done ? 0.75 : 0, duration: 0.4 }}>
              <div className="mt-1.5 text-[11px] font-medium text-ink-2">{t("Waiting for you")}</div>
              <ul className="list-disc pl-4 marker:text-accent-text">
                <li>{t("Send the updated home page by Friday")}</li>
              </ul>
            </motion.div>
          </motion.div>
        </div>
      </div>
    </Frame>
  );
}

/** Screener: the first email from someone new waits for a yes or no; No sends it to Archive, Yes lets them into Inbox. */
export function ScreenerPreview() {
  const { ref, step } = useFilm([1700, 650, 1700, 1700, 650, 1700], 0);
  const scenes = [
    { name: "Travel Deals", email: "news@traveldeals.example", subject: t("Last-minute trips for this weekend"), yes: false },
    { name: "Jana Malá", email: "jana.mala@example.cz", subject: t("Hi, Petra gave me your address"), yes: true },
  ];
  const scene = scenes[Math.floor(step / 3)];
  const phase = step % 3;
  const pressed = (yes: boolean) => phase === 1 && scene.yes === yes;
  return (
    <Frame ref={ref}>
      <div className="relative h-[78px]">
        <AnimatePresence initial={false} mode="popLayout">
          {phase < 2 ? (
            <motion.div
              key={scene.name}
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0, x: 0 }}
              exit={{ opacity: 0, x: scene.yes ? 40 : -40 }}
              transition={softSpring}
              className="rounded-[10px] bg-solid px-2.5 py-2 shadow-[0_0_0_0.5px_var(--line)]"
            >
              <div className="flex items-center gap-2.5">
                <Avatar person={{ name: scene.name, email: scene.email }} size={30} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12.5px] font-semibold text-ink">{scene.name}</div>
                  <div className="truncate text-[11.5px] text-ink-2">{scene.subject}</div>
                </div>
              </div>
              <div className="mt-2 flex gap-1.5 pl-[40px]">
                <motion.span
                  animate={{ scale: pressed(true) ? 0.92 : 1 }}
                  transition={spring}
                  className={cn("flex h-7 items-center gap-1 rounded-full bg-accent px-3 text-[11.5px] font-medium text-on-accent transition-[filter]", pressed(true) && "brightness-90")}
                >
                  <Check size={12} strokeWidth={2.4} /> {t("Yes")}
                </motion.span>
                <motion.span
                  animate={{ scale: pressed(false) ? 0.92 : 1 }}
                  transition={spring}
                  className={cn(
                    "flex h-7 items-center gap-1 rounded-full px-3 text-[11.5px] font-medium text-ink shadow-[inset_0_0_0_0.5px_var(--line)] transition-colors",
                    pressed(false) && "bg-selected",
                  )}
                >
                  <X size={12} strokeWidth={2.4} /> {t("No")}
                </motion.span>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key={`${scene.name}-done`}
              initial={{ opacity: 0, scale: 0.94 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              transition={softSpring}
              className="flex h-full items-center justify-center"
            >
              <span
                className={cn(
                  "inline-flex h-8 items-center gap-1.5 rounded-full px-3.5 text-[12px] font-medium",
                  scene.yes ? "bg-accent-soft text-accent-text" : "bg-hover text-ink-2",
                )}
              >
                {scene.yes ? <Inbox size={13} /> : <Archive size={13} />}
                {scene.name} → {scene.yes ? t("Inbox") : t("Archive@@folder")}
              </span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </Frame>
  );
}

/** Notifications: the lock screen of a phone, with new mail, a sign-in code and an open coming in. */
export function NotificationsPreview() {
  const { ref, step } = useFilm([700, 1800, 1800, 3400], 3);
  const all = [
    { id: "mail", title: "Petra Nováková", body: t("Are you coming on Saturday?") },
    { id: "code", title: "482 913 · Revolut", body: t("Verification code") },
    { id: "open", title: t("{name} opened “{subject}”", { name: "Tomáš", subject: t("New website") }), body: "iPhone · Gmail" },
  ];
  // Newest on top; older ones stack behind it, like on iPhone.
  const shown = all.slice(0, step).reverse();
  return (
    <Frame ref={ref} className="p-0">
      <div className="relative h-[150px] bg-[linear-gradient(160deg,#6f7fa3_0%,#3d4766_55%,#262b3d_100%)]">
        <div className="pt-2.5 text-center text-[11px] font-medium text-white/75">{formatDay(isoDay(0)) ?? ""}</div>
        <div className="text-center text-[30px] leading-none font-semibold tracking-[-0.02em] text-white/90 tabular-nums">9:41</div>
        <div className="absolute inset-x-3 top-[64px]">
          <AnimatePresence initial={false}>
            {shown.map((n, i) => (
              <motion.div
                key={n.id}
                initial={{ opacity: 0, y: -24, scale: 0.96 }}
                animate={{ opacity: i > 1 ? 0 : 1 - i * 0.3, y: i * 10, scale: 1 - i * 0.06 }}
                exit={{ opacity: 0 }}
                transition={softSpring}
                style={{ zIndex: 3 - i }}
                className="absolute inset-x-0 top-0 flex origin-bottom items-center gap-2 rounded-[14px] bg-white/80 px-2.5 py-2 shadow-[0_4px_14px_rgb(0_0_0/0.18)] backdrop-blur-md dark:bg-[#2c2c30]/85"
              >
                <BrandMark size={26} className="shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-black dark:text-white">{n.title}</span>
                    <span className="shrink-0 text-[10.5px] text-black/45 dark:text-white/50">{t("now")}</span>
                  </div>
                  <div className="truncate text-[11.5px] text-black/70 dark:text-white/70">{n.body}</div>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </div>
    </Frame>
  );
}

/**
 * Only people: on the lock screen a newsletter tries to come in and is let pass quietly (it's in
 * Inbox, it just doesn't buzz), then a message from a person arrives the usual way.
 */
export function PeopleOnlyPreview() {
  const { ref, step } = useFilm([700, 1900, 2600, 3200], 3);
  const banner = "absolute inset-x-0 top-0 flex items-center gap-2 rounded-[14px] px-2.5 py-2 shadow-[0_4px_14px_rgb(0_0_0/0.18)] backdrop-blur-md";
  return (
    <Frame ref={ref} className="p-0">
      <div className="relative h-[132px] bg-[linear-gradient(160deg,#6f7fa3_0%,#3d4766_55%,#262b3d_100%)]">
        <div className="pt-2.5 text-center text-[30px] leading-none font-semibold tracking-[-0.02em] text-white/90 tabular-nums">9:41</div>
        <div className="absolute inset-x-3 top-[52px]">
          <AnimatePresence initial={false}>
            {step === 1 && (
              <motion.div
                key="newsletter"
                initial={{ opacity: 0, y: -18, scale: 0.96 }}
                animate={{ opacity: 0.55, y: 0, scale: 0.97 }}
                exit={{ opacity: 0, x: 60, transition: { duration: 0.35 } }}
                transition={softSpring}
                className={cn(banner, "bg-white/45 dark:bg-[#2c2c30]/55")}
              >
                <span className="flex size-[26px] shrink-0 items-center justify-center rounded-[7px] bg-white/60 text-black/45 dark:bg-white/10 dark:text-white/45">
                  <BellOff size={14} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12px] font-semibold text-black/60 dark:text-white/60">{t("Weekend deals")}</div>
                  <div className="truncate text-[11.5px] text-black/45 dark:text-white/45">{t("Newsletter · waits in Inbox, no buzz")}</div>
                </div>
              </motion.div>
            )}
            {step >= 2 && (
              <motion.div
                key="person"
                initial={{ opacity: 0, y: -24, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0 }}
                transition={softSpring}
                className={cn(banner, "bg-white/80 dark:bg-[#2c2c30]/85")}
              >
                <BrandMark size={26} className="shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-black dark:text-white">Petra Nováková</span>
                    <span className="shrink-0 text-[10.5px] text-black/45 dark:text-white/50">{t("now")}</span>
                  </div>
                  <div className="truncate text-[11.5px] text-black/70 dark:text-white/70">{t("Are you coming on Saturday?")}</div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </Frame>
  );
}

/** Bundles: three newsletters under a message from a person fold into one "Newsletters" row, and the person is what's left in sight. */
export function BundlesPreview() {
  const { ref, step } = useFilm([1600, 2400, 3000], 2);
  const folded = step >= 1;
  const letters = [
    { name: "Rohlík.cz", hue: 28, subject: t("Weekend deals") },
    { name: "Alza", hue: 150, subject: t("New in tech this week") },
    { name: "Seznam Zprávy", hue: 0, subject: t("Morning briefing") },
  ];
  const row = "flex items-center gap-2 rounded-[10px] bg-solid px-2.5 py-1.5 shadow-[0_0_0_0.5px_var(--line)]";
  return (
    <Frame ref={ref} className="flex flex-col gap-1.5">
      <div className={row}>
        <Avatar person={{ name: "Petra Nováková", email: "petra@example.com" }} size={22} />
        <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-ink">Petra Nováková</span>
        <span className="truncate text-[11.5px] text-ink-3">{t("Are you coming on Saturday?")}</span>
      </div>
      <motion.div layout transition={softSpring} className="flex flex-col gap-1.5">
        <AnimatePresence initial={false} mode="popLayout">
          {folded ? (
            <motion.div key="bundle" initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} transition={softSpring} className={row}>
              <span className="hue-tint flex size-[22px] shrink-0 items-center justify-center rounded-full" style={hueStyle(28)}>
                <Newspaper size={12} />
              </span>
              <span className="text-[12px] font-semibold text-ink">{t("Newsletters")}</span>
              <span className="rounded-full bg-hover px-1.5 text-[10.5px] font-medium text-ink-3">3</span>
              <span className="min-w-0 flex-1 truncate text-[11.5px] text-ink-3">Rohlík.cz, Alza, Seznam Zprávy</span>
            </motion.div>
          ) : (
            letters.map((l, i) => (
              <motion.div key={l.name} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, y: -10 * (i + 1), scale: 0.96, transition: { duration: 0.3 } }} className={row}>
                <span className="hue-tint size-[22px] shrink-0 rounded-full" style={hueStyle(l.hue)} />
                <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-ink">{l.name}</span>
                <span className="truncate text-[11.5px] text-ink-3">{l.subject}</span>
              </motion.div>
            ))
          )}
        </AnimatePresence>
      </motion.div>
    </Frame>
  );
}

/** Read tracking: an email you sent (as Sent lists it), and the receipt under it going from "not opened yet" to opened, twice. */
export function ReadTrackingPreview() {
  const { ref, step } = useFilm([1800, 2600, 2800], 2);
  const opened = step > 0;
  const label = step === 0 ? t("Not opened yet") : step === 1 ? t("Opened") : tn(2, "Opened {n}×", "Opened {n}×");
  const detail = step === 0 ? null : t("last {time} · {client}", step === 1 ? { time: "9:30", client: "iPhone · Gmail" } : { time: "10:05", client: "Mac · Outlook" });
  return (
    <Frame ref={ref}>
      <div className="rounded-[10px] bg-solid px-2.5 py-2 shadow-[0_0_0_0.5px_var(--line)]">
        <div className="flex items-center gap-2.5">
          <Avatar person={{ name: "Tomáš Dvořák", email: "tomas@dvorak-studio.example" }} size={30} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-ink">{t("To {name}", { name: "Tomáš Dvořák" })}</span>
              <span className="shrink-0 text-[11px] text-ink-3 tabular-nums">9:12</span>
            </div>
            <div className="truncate text-[12px] text-ink">{t("New website")}</div>
          </div>
        </div>
        <div className="mt-2 flex flex-col gap-[3px] pl-[40px]">
          <span className="h-[3px] w-[92%] rounded-full bg-ink/14" />
          <span className="h-[3px] w-[64%] rounded-full bg-ink/14" />
        </div>
        <div className="mt-2.5 pl-[40px]">
          <motion.span
            layout
            transition={spring}
            className={cn(
              "inline-flex h-6 max-w-full items-center gap-1.5 rounded-full px-2.5 text-[11px] transition-colors duration-300",
              opened ? "bg-accent-soft text-accent-text" : "bg-hover text-ink-3",
            )}
          >
            <span className="relative flex">
              <Eye size={12} className="shrink-0" />
              {opened && (
                <motion.span
                  key={step}
                  className="absolute -inset-1 rounded-full border border-current"
                  initial={{ opacity: 0.7, scale: 0.6 }}
                  animate={{ opacity: 0, scale: 1.8 }}
                  transition={{ duration: 0.9, ease: "easeOut" }}
                />
              )}
            </span>
            <motion.span layout="position" className="font-medium whitespace-nowrap">
              {label}
            </motion.span>
            {detail && (
              <motion.span key={detail} initial={{ opacity: 0 }} animate={{ opacity: 0.75 }} className="truncate">
                · {detail}
              </motion.span>
            )}
          </motion.span>
        </div>
      </div>
    </Frame>
  );
}

/**
 * Images in incoming mail: a newsletter with an invisible 1×1 picture in it, and what that picture
 * reports back when it loads. Hidden images (`load` off) end with the report stopped; loaded ones
 * with the sender knowing.
 */
export function ImagesPreview({ load = false }: { load?: boolean }) {
  const { ref, step } = useFilm(load ? [1500, 2800] : [1500, 2400, 2800], load ? 1 : 2);
  const sender = "Travel Deals";
  const report = { sender, time: "9:41", place: getLocale() === "cs" ? "Praha" : "Prague" };
  const stopped = !load && step === 2;
  const chip =
    step === 0
      ? { icon: Eye, tone: "neutral" as const, text: t("Invisible tracking image") }
      : stopped
        ? { icon: ShieldCheck, tone: "good" as const, text: t("Blocked. {sender} learns nothing", { sender }) }
        : { icon: Eye, tone: "warn" as const, text: t("Report to {sender}: opened {time}, {place}", report) };
  return (
    <Frame ref={ref}>
      <div className="rounded-[10px] bg-solid px-2.5 py-2 shadow-[0_0_0_0.5px_var(--line)]">
        <div className="flex items-center gap-2.5">
          <Avatar person={{ name: sender, email: "news@traveldeals.example" }} size={30} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-ink">{sender}</span>
              <span className="shrink-0 text-[11px] text-ink-3 tabular-nums">9:41</span>
            </div>
            <div className="truncate text-[12px] text-ink">{t("Last-minute trips for this weekend")}</div>
          </div>
        </div>
        <div className="mt-2 flex items-end gap-1.5">
          {[0, 1].map((i) =>
            load ? (
              <span
                key={i}
                className="h-[38px] flex-1 rounded-[6px]"
                style={{ background: i ? "linear-gradient(135deg,#f6c27a,#e9765b)" : "linear-gradient(135deg,#7cc4e8,#4d7fd6)" }}
              />
            ) : (
              <span key={i} className="flex h-[38px] flex-1 items-center justify-center rounded-[6px] bg-hover text-ink-3">
                <ImageOff size={13} />
              </span>
            ),
          )}
          {/* The picture nobody sees: one pixel, here a dot you can. */}
          <span className="relative mb-0.5 flex size-[7px] shrink-0">
            <span className={cn("size-full rounded-[1.5px] transition-colors duration-300", stopped ? "bg-success" : step === 0 ? "bg-ink-3" : "bg-warning")} />
            {!stopped && (
              <motion.span
                key={step}
                className={cn("absolute -inset-1.5 rounded-full border", step === 0 ? "border-ink-3" : "border-warning")}
                initial={{ opacity: 0.8, scale: 0.4 }}
                animate={{ opacity: 0, scale: 1.6 }}
                transition={{ duration: 1, ease: "easeOut", repeat: Infinity, repeatDelay: 0.2 }}
              />
            )}
          </span>
        </div>
      </div>
      <div className="mt-2 flex h-6 items-center">
        <AnimatePresence initial={false} mode="popLayout">
          <motion.span
            key={chip.text}
            initial={{ opacity: 0, y: -6, scale: 0.92 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={spring}
            className={cn(
              "inline-flex h-6 max-w-full origin-left items-center gap-1.5 rounded-full px-2.5 text-[11px] font-medium",
              chip.tone === "good" ? "bg-success/12 text-success" : chip.tone === "warn" ? "bg-warning/15 text-ink" : "bg-solid text-ink-2 shadow-[0_0_0_0.5px_var(--line)]",
            )}
          >
            <chip.icon size={11.5} className="shrink-0" />
            <span className="truncate">{chip.text}</span>
          </motion.span>
        </AnimatePresence>
      </div>
    </Frame>
  );
}
