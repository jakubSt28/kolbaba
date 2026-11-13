"use client";

import { CalendarDays, ChevronLeft, ChevronRight, Menu, Plus, RefreshCw, Search } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import { addDays, formatTitle, sameDay, visibleDays } from "@/lib/calendar/dates";
import { useCalendar, visibleEvents } from "@/lib/calendar/store";
import type { CalendarView } from "@/lib/calendar/types";
import { t } from "@/lib/i18n";
import { LIVE } from "@/lib/live";
import { useMail } from "@/lib/store";
import { cn, isTypingTarget } from "@/lib/utils";
import { Drawer } from "../mobile-shell";
import { ModeSwitch } from "./calendar-sidebar";
import { Segmented, Tooltip } from "../ui";
import { AddCalendarHost, MailboxCalendars, OtherWays } from "./add-calendar";
import { CalendarSearch } from "./calendar-search";
import { EventDetailsHost } from "./event-details";
import { EventEditorHost } from "./event-editor";
import { MonthView } from "./month-view";
import { TimeGrid } from "./time-grid";

/** The days and events on screen, kept loaded and fresh. `columns` is how many days "week" shows (7, or 3 on a phone). */
function useCalendarView(columns: number) {
  const view = useCalendar((s) => s.view);
  const anchor = useCalendar((s) => s.anchor);
  const ready = useCalendar((s) => s.ready);
  const events = useCalendar((s) => s.events);
  const calendars = useCalendar((s) => s.calendars);
  const mode = useCalendar((s) => s.mode);
  const days = useMemo(() => visibleDays(view, new Date(anchor), columns), [view, anchor, columns]);
  const shown = useMemo(() => visibleEvents(events, calendars), [events, calendars]);
  const count = calendars.length;

  useEffect(() => {
    if (mode !== "calendar" || !ready) return;
    void useCalendar.getState().ensure(days[0], addDays(days[days.length - 1], 1));
  }, [mode, ready, days, count]);

  // Fresh on coming back to the window, and every minute while it's looked at.
  useEffect(() => {
    if (mode !== "calendar" || !LIVE) return;
    const again = () => document.visibilityState === "visible" && void useCalendar.getState().refresh();
    const timer = setInterval(again, 60_000);
    window.addEventListener("focus", again);
    document.addEventListener("visibilitychange", again);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", again);
      document.removeEventListener("visibilitychange", again);
    };
  }, [mode]);

  return { view, anchor, days, events: shown, calendars, ready };
}

/** Single keys, as in the mail: T today, J/K or the arrows to move, D/W/M for the view, C for a new event, / to search. */
function useCalendarShortcuts(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      const mail = useMail.getState();
      const s = useCalendar.getState();
      // A question or one of the calendar's windows is open: it has the keys.
      if (document.querySelector("[role=alertdialog]") || s.editor || s.adding || s.renaming || mail.newsOpen || mail.collectionOpen || mail.feedback) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        return mail.setPaletteOpen(!mail.paletteOpen);
      }
      if (mod && e.key === ",") {
        e.preventDefault();
        return mail.setSettingsOpen(true);
      }
      if (mod || e.altKey || mail.paletteOpen || mail.settingsOpen || mail.shortcutsOpen || isTypingTarget(e.target)) return;
      // Search is in place of the days: the keys that move through them wait.
      if (s.search) return e.key === "Escape" ? s.closeSearch() : undefined;
      const views: Record<string, CalendarView> = { d: "day", w: "week", m: "month" };
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (key === "Escape") s.closeEvent();
      else if (key === "t") s.goToday();
      else if (key === "j" || key === "ArrowRight") s.step(1);
      else if (key === "k" || key === "ArrowLeft") s.step(-1);
      else if (views[key]) s.setView(views[key]);
      else if (key === "c" || key === "n") s.newEvent();
      else if (key === "r") void s.refresh(true);
      else if (key === "/") s.openSearch();
      else if (key === "?") mail.setShortcutsOpen(true);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled]);
}

/* ---------------------------------- Computer --------------------------------- */

/** The calendar in the big pane (the sidebar holds the small month and the list of calendars). */
export function CalendarMain() {
  const { view, anchor, days, events, calendars, ready } = useCalendarView(7);
  const syncing = useCalendar((s) => s.syncing);
  const { step, goToday, setView, refresh, openSearch } = useCalendar.getState();
  const mode = useCalendar((s) => s.mode);
  useCalendarShortcuts(mode === "calendar");
  const searching = useCalendar((s) => !!s.search);
  const today = days.some((d) => sameDay(d, new Date()));

  if (ready && !calendars.length) return <FirstRun />;
  if (searching) return <CalendarSearch />;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-14 shrink-0 items-center gap-2 pr-3 pl-5">
        <h1 className="min-w-0 truncate text-[19px] font-semibold tracking-[-0.02em] first-letter:uppercase">{formatTitle(view, days, new Date(anchor))}</h1>
        <div className="ml-2 flex shrink-0 items-center">
          <Tooltip label={view === "month" ? t("Previous month") : view === "week" ? t("Previous week") : t("Previous day")} shortcut="K" side="bottom">
            <button onClick={() => step(-1)} aria-label={t("Previous")} className="flex size-8 items-center justify-center rounded-[9px] text-ink-2 transition-colors hover:bg-hover hover:text-ink">
              <ChevronLeft size={17} />
            </button>
          </Tooltip>
          <Tooltip label={view === "month" ? t("Next month") : view === "week" ? t("Next week") : t("Next day")} shortcut="J" side="bottom">
            <button onClick={() => step(1)} aria-label={t("Next")} className="flex size-8 items-center justify-center rounded-[9px] text-ink-2 transition-colors hover:bg-hover hover:text-ink">
              <ChevronRight size={17} />
            </button>
          </Tooltip>
        </div>
        <Tooltip label={t("Go to today")} shortcut="T" side="bottom">
          <button
            onClick={goToday}
            disabled={today}
            className="press h-8 shrink-0 rounded-[10px] px-3 text-[13px] font-medium text-ink-2 shadow-[inset_0_0_0_0.5px_var(--line)] [--press-scale:0.96] hover:bg-hover hover:text-ink disabled:text-ink-3 disabled:hover:bg-transparent"
          >
            {t("Today")}
          </button>
        </Tooltip>
        <span className="flex-1" />
        <Tooltip label={t("Search events")} shortcut="/" side="bottom">
          <button onClick={openSearch} aria-label={t("Search events")} className="flex size-8 shrink-0 items-center justify-center rounded-[9px] text-ink-3 transition-colors hover:bg-hover hover:text-ink">
            <Search size={15} />
          </button>
        </Tooltip>
        {LIVE && (
          <Tooltip label={syncing ? t("Checking your calendars…") : t("Refresh")} shortcut="R" side="bottom">
            <button onClick={() => void refresh(true)} aria-label={t("Refresh")} className="flex size-8 shrink-0 items-center justify-center rounded-[9px] text-ink-3 transition-colors hover:bg-hover hover:text-ink">
              <RefreshCw size={14} className={cn(syncing && "animate-spin")} />
            </button>
          </Tooltip>
        )}
        <Segmented
          id="calendar-view"
          value={view}
          onChange={setView}
          options={[
            { value: "day", label: t("Day") },
            { value: "week", label: t("Week") },
            { value: "month", label: t("Month") },
          ]}
        />
      </header>
      <div className="min-h-0 flex-1 border-t border-line">
        {view === "month" ? (
          <MonthView days={days} month={new Date(anchor).getMonth()} events={events} calendars={calendars} />
        ) : (
          <TimeGrid key={view} days={days} events={events} calendars={calendars} />
        )}
      </div>
    </div>
  );
}

/** Nothing here yet: the mailboxes' own calendars are one click away, with every other way in below. */
function FirstRun({ mobile }: { mobile?: boolean }) {
  const some = useCalendar((s) => s.suggestions.length > 0);
  const { setAdding, createLocal } = useCalendar.getState();
  return (
    <div className="flex h-full items-start justify-center overflow-y-auto px-5 py-10">
      <div className={cn("w-full max-w-[440px] text-center", !mobile && "my-auto")}>
        <span className="mx-auto mb-4 flex size-14 items-center justify-center rounded-[18px] bg-accent-soft text-accent-text">
          <CalendarDays size={26} strokeWidth={1.8} />
        </span>
        <h1 className="text-[22px] font-bold tracking-[-0.02em]">{some ? t("Add the calendars of your mailboxes") : t("Add your first calendar")}</h1>
        <p className="mx-auto mt-2 max-w-[380px] text-[14px] leading-relaxed text-ink-2">
          {t("Kolbaba shows all your calendars in one place. Events you make or change here are saved to the calendar they belong to.")}
        </p>
        <MailboxCalendars className="mt-6" />
        <div className={cn("text-left", some ? "mt-6" : "mt-5")}>
          {some && <div className="mb-1 px-2 text-[12px] font-medium text-ink-3">{t("Other calendars")}</div>}
          <OtherWays go={(page) => (page === "local" ? void createLocal(t("My calendar")) : setAdding(page))} />
        </div>
      </div>
    </div>
  );
}

/* ----------------------------------- Phone ---------------------------------- */

/** The calendar on a phone: one day, three days or the month, a swipe sideways to move, the drawer for the calendars. */
export function MobileCalendar() {
  const { view, anchor, days, events, calendars, ready } = useCalendarView(3);
  const { step, goToday, setView, newEvent, openSearch } = useCalendar.getState();
  const searching = useCalendar((s) => !!s.search);
  const setDrawerOpen = useMail((s) => s.setDrawerOpen);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const today = days.some((d) => sameDay(d, new Date()));
  const empty = ready && !calendars.length;

  return (
    <div className="app-shell flex flex-col overflow-hidden bg-canvas">
      <div className="flex shrink-0 items-center gap-2 px-3 pt-[max(14px,env(safe-area-inset-top))] pb-2">
        <button aria-label={t("Calendars")} onClick={() => setDrawerOpen(true)} className="glass press flex size-10 shrink-0 items-center justify-center rounded-full text-ink">
          <Menu size={19} />
        </button>
        <ModeSwitch phone />
        <span className="flex-1" />
        {!empty && (
          <button aria-label={t("Search events")} onClick={openSearch} className="glass press flex size-10 shrink-0 items-center justify-center rounded-full text-ink">
            <Search size={18} />
          </button>
        )}
        {!empty && (
          <button onClick={goToday} disabled={today} className="glass press h-10 shrink-0 rounded-full px-4 text-[14px] font-medium text-accent-text disabled:text-ink-3">
            {t("Today")}
          </button>
        )}
      </div>
      <h1 className="shrink-0 truncate px-4 pb-2 text-[28px] leading-tight font-bold tracking-[-0.03em] first-letter:uppercase">{formatTitle(view === "day" ? "month" : view, days, new Date(anchor))}</h1>
      {!empty && (
        <div className="shrink-0 px-3 pb-2">
          <Segmented
            id="calendar-view-phone"
            full
            value={view}
            onChange={setView}
            options={[
              { value: "day", label: t("Day") },
              { value: "week", label: t("3 days") },
              { value: "month", label: t("Month") },
            ]}
          />
        </div>
      )}
      <div
        className="mx-2 mb-[max(8px,var(--safe-bottom))] min-h-0 flex-1 overflow-hidden rounded-[20px] bg-solid shadow-[var(--shadow-panel)]"
        onTouchStart={(e) => (touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY })}
        onTouchEnd={(e) => {
          const from = touch.current;
          touch.current = null;
          if (!from || empty) return;
          const dx = e.changedTouches[0].clientX - from.x;
          const dy = e.changedTouches[0].clientY - from.y;
          // Clearly sideways: the next or previous days. Anything else is scrolling the hours.
          if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 2) step(dx < 0 ? 1 : -1, 3);
        }}
      >
        {empty ? (
          <FirstRun mobile />
        ) : view === "month" ? (
          <MonthView days={days} month={new Date(anchor).getMonth()} events={events} calendars={calendars} compact />
        ) : (
          <TimeGrid key={view} days={days} events={events} calendars={calendars} compact />
        )}
      </div>
      {!empty && (
        <button
          aria-label={t("New event")}
          onClick={() => newEvent()}
          className="press absolute right-5 bottom-[max(22px,calc(var(--safe-bottom)+14px))] flex size-14 items-center justify-center rounded-full bg-accent text-on-accent shadow-[var(--shadow-bar)] [--press-scale:0.9]"
        >
          <Plus size={24} />
        </button>
      )}
      {searching && <CalendarSearch mobile />}
      <Drawer />
    </div>
  );
}

/** The calendar's windows: an event's details, the editor, "Add calendar". */
export function CalendarHosts({ mobile }: { mobile: boolean }) {
  return (
    <>
      <EventDetailsHost mobile={mobile} />
      <EventEditorHost mobile={mobile} />
      <AddCalendarHost />
    </>
  );
}
