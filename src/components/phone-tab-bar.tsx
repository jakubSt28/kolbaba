"use client";

import { motion } from "motion/react";
import { useEffect, useState, type ReactNode } from "react";
import { useCalendar, type AppMode } from "@/lib/calendar/store";
import { t, tn } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { MODES, useModeCounts } from "./calendar/calendar-sidebar";

/** The round button beside the tabs: what's new in the open app (a message, an event, a task). */
export type TabBarAction = { label: string; icon: ReactNode; run: () => void };

/**
 * Where the lens sat before the last switch. Each app has its own bar (the mail's stays mounted under the
 * others), so the lens of the bar that comes up starts from there and slides across, as if it were one bar.
 */
let lensFrom = 0;

/**
 * The phone's tab bar: Mail, Calendar and Tasks in one glass capsule at the bottom, and the open app's
 * "new" as a separate round button beside it. Hidden while something else holds the bottom (a selection's
 * actions) and while the keyboard is up.
 */
export function PhoneTabBar({ action, hidden, onReselect }: { action?: TabBarAction | null; hidden?: boolean; onReselect?: () => void }) {
  const mode = useCalendar((s) => s.mode);
  const setMode = useCalendar((s) => s.setMode);
  const counts = useModeCounts();
  const at = MODES.findIndex((m) => m.id === mode);

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 keyboard:invisible">
      {/* The scroll edge: what scrolls under the bar fades, so the bar reads over a busy list. */}
      <div aria-hidden className={cn("absolute inset-x-0 bottom-0 h-[calc(var(--tab-bar-space)+28px)] bg-linear-to-t from-canvas/85 to-canvas/0 transition-opacity duration-200", hidden && "opacity-0")} />
      <motion.div
        className="relative flex items-center gap-3 px-4 pb-[var(--tab-bar-bottom)]"
        initial={false}
        animate={hidden ? { y: 110, opacity: 0 } : { y: 0, opacity: 1 }}
        transition={{ type: "spring", stiffness: 420, damping: 38 }}
      >
        <div role="tablist" aria-label={t("Mail, calendar or tasks")} className={cn("liquid-glass flex h-[62px] min-w-0 flex-1 rounded-full p-1", !hidden && "pointer-events-auto")}>
          {MODES.map((m, i) => (
            <Tab
              key={m.id}
              mode={m.id}
              icon={m.icon}
              active={i === at}
              count={counts[m.id]}
              onPick={() => {
                if (i === at) return onReselect?.();
                lensFrom = at;
                setMode(m.id);
              }}
              lens={i === at ? <Lens key={mode} index={i} /> : null}
            />
          ))}
        </div>
        {action && (
          <button
            aria-label={action.label}
            onClick={action.run}
            className={cn(
              "liquid-glass-tint press flex size-[62px] shrink-0 items-center justify-center rounded-full text-on-accent [--press-scale:0.9]",
              !hidden && "pointer-events-auto",
            )}
          >
            {action.icon}
          </button>
        )}
      </motion.div>
    </div>
  );
}

function Tab({ mode, icon: Icon, active, count, onPick, lens }: { mode: AppMode; icon: (typeof MODES)[number]["icon"]; active: boolean; count: number; onPick: () => void; lens: ReactNode }) {
  const name = mode === "mail" ? t("Mail@@mode") : mode === "calendar" ? t("Calendar") : t("Tasks");
  const label = !count
    ? name
    : mode === "mail"
      ? tn(count, "Mail: {n} unread", "Mail: {n} unread")
      : mode === "calendar"
        ? tn(count, "Calendar: {n} event left today", "Calendar: {n} events left today")
        : tn(count, "Tasks: {n} for today", "Tasks: {n} for today");
  return (
    <button
      role="tab"
      aria-selected={active}
      aria-label={label}
      onClick={onPick}
      className={cn("press relative flex min-w-0 flex-1 flex-col items-center justify-center gap-[3px] rounded-full [--press-scale:0.92]", active ? "text-accent-text" : "text-ink")}
    >
      {lens}
      <span className="relative">
        <Icon size={22} strokeWidth={active ? 2.2 : 1.8} />
        {count > 0 && (
          <span
            aria-hidden
            className="absolute -top-1.5 left-[calc(100%-7px)] h-[17px] min-w-[17px] rounded-full bg-accent px-[5px] text-center text-[10.5px] leading-[17px] font-semibold text-on-accent tabular-nums shadow-[0_1px_2px_rgb(0_0_0/0.15)]"
          >
            {count > 99 ? "99+" : count}
          </span>
        )}
      </span>
      <span className="relative max-w-full truncate px-1 text-[10.5px] leading-none font-semibold tracking-[0.005em]">{name}</span>
    </button>
  );
}

/** The bright pill under the open tab. It slides over from the tab that was open before. */
function Lens({ index }: { index: number }) {
  const [from] = useState(() => lensFrom);
  useEffect(() => {
    lensFrom = index;
  }, [index]);
  return (
    <motion.span
      aria-hidden
      className="liquid-lens absolute inset-0 rounded-full"
      initial={from === index ? false : { x: `${(from - index) * 100}%`, scale: 1.12 }}
      animate={{ x: "0%", scale: 1 }}
      transition={{ type: "spring", stiffness: 380, damping: 32, mass: 0.8 }}
    />
  );
}
