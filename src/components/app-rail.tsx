"use client";

import { Settings2 } from "lucide-react";
import { motion } from "motion/react";
import { useState } from "react";
import { useCalendar } from "@/lib/calendar/store";
import { t, tn } from "@/lib/i18n";
import { useMail } from "@/lib/store";
import { cn } from "@/lib/utils";
import { LATEST_NOTE } from "@/lib/whats-new";
import { BrandMark } from "./brand-mark";
import { MODES, useModeCounts } from "./calendar/calendar-sidebar";
import { NavIcon, PlayContext } from "./nav-icon";
import { spring, Tooltip } from "./ui";

/**
 * The computer's column of apps, left of the sidebar: Kolbaba's mark (What's new and tips), then the mail,
 * the calendar and the tasks as apps side by side, each with what waits in it, and Settings at the bottom.
 * On the phone they're the tab bar at the bottom instead (src/components/phone-tab-bar.tsx), and Settings
 * stays in the drawer's foot.
 */
export function AppRail() {
  const mode = useCalendar((s) => s.mode);
  const setMode = useCalendar((s) => s.setMode);
  const counts = useModeCounts();
  const unseenNews = useMail((s) => s.newsSeen !== null && s.newsSeen !== LATEST_NOTE);

  return (
    <nav className="flex h-full flex-col items-center px-1.5 pt-3 pb-2.5 select-none">
      <Tooltip label={t("What's new and tips")} side="right">
        <button
          onClick={() => useMail.getState().setNewsOpen(unseenNews ? "news" : "tips")}
          aria-label={t("What's new and tips")}
          className="press relative mb-4 flex size-10 items-center justify-center rounded-[12px] transition-colors hover:bg-hover"
        >
          <BrandMark size={24} />
          {unseenNews && <span className="absolute top-1 right-1 size-2 rounded-full bg-accent ring-2 ring-[var(--glass-strong)]" aria-label={t("New@@news")} />}
        </button>
      </Tooltip>
      <div role="tablist" aria-orientation="vertical" aria-label={t("Mail, calendar or tasks")} className="flex flex-col gap-4">
        {MODES.map((m) => {
          const active = mode === m.id;
          const name = m.id === "mail" ? t("Mail@@mode") : m.id === "calendar" ? t("Calendar") : t("Tasks");
          const n = counts[m.id];
          const label = !n
            ? name
            : m.id === "mail"
              ? tn(n, "Mail: {n} unread", "Mail: {n} unread")
              : m.id === "calendar"
                ? tn(n, "Calendar: {n} event left today", "Calendar: {n} events left today")
                : tn(n, "Tasks: {n} for today", "Tasks: {n} for today");
          const tab = (
            <button
              role="tab"
              aria-selected={active}
              aria-label={label}
              onClick={() => setMode(m.id)}
              className="press group flex w-[58px] flex-col items-center gap-1 [--press-scale:0.94]"
            >
              <span className={cn("relative flex h-9 w-12 items-center justify-center rounded-[12px] transition-colors", !active && "group-hover:bg-hover")}>
                {active && (
                  <motion.span
                    layoutId="app-rail"
                    transition={spring}
                    className="absolute inset-0 rounded-[12px] bg-solid shadow-[0_1px_3px_rgb(0_0_0/0.1),0_0_0_0.5px_var(--line)]"
                  />
                )}
                <m.icon size={20} strokeWidth={active ? 2.1 : 1.8} className={cn("relative transition-colors", active ? "text-accent-text" : "text-ink-2 group-hover:text-ink")} />
                {n > 0 && (
                  <span
                    aria-hidden
                    className="absolute -top-1.5 -right-1.5 z-10 h-[16px] min-w-[16px] rounded-full bg-accent px-[4px] text-center text-[10px] leading-[16px] font-semibold text-on-accent tabular-nums ring-2 ring-[var(--glass-strong)]"
                  >
                    {n > 99 ? "99+" : n}
                  </span>
                )}
              </span>
              <span className={cn("max-w-full truncate text-[11px] leading-none font-semibold transition-colors", active ? "text-ink" : "text-ink-3 group-hover:text-ink-2")}>{name}</span>
            </button>
          );
          // The name is written under the icon: a tooltip only for the number.
          return n ? (
            <Tooltip key={m.id} label={label} side="right">
              {tab}
            </Tooltip>
          ) : (
            <span key={m.id} className="contents">
              {tab}
            </span>
          );
        })}
      </div>
      <RailSettings />
    </nav>
  );
}

/** Settings at the foot of the rail, drawn like the apps above it so the column reads as one. */
function RailSettings() {
  const open = useMail((s) => s.settingsOpen);
  const [play, setPlay] = useState(0);
  return (
    <Tooltip label={t("Settings")} shortcut="⌘," side="right">
      <button
        onClick={() => {
          setPlay((p) => p + 1);
          useMail.getState().setSettingsOpen(true);
        }}
        aria-label={t("Settings")}
        className="press group mt-auto flex w-[58px] flex-col items-center gap-1 [--press-scale:0.94]"
      >
        <span className={cn("flex h-9 w-12 items-center justify-center rounded-[12px] transition-colors", open ? "bg-hover" : "group-hover:bg-hover")}>
          <PlayContext.Provider value={play}>
            <NavIcon icon={Settings2} gesture="tune" size={20} className={cn("transition-colors", open ? "text-ink" : "text-ink-2 group-hover:text-ink")} />
          </PlayContext.Provider>
        </span>
        <span className={cn("max-w-full truncate text-[11px] leading-none font-semibold transition-colors", open ? "text-ink" : "text-ink-3 group-hover:text-ink-2")}>{t("Settings")}</span>
      </button>
    </Tooltip>
  );
}
