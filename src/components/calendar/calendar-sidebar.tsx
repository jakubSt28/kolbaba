"use client";

import { CalendarDays, CalendarPlus, Check, CircleCheckBig, ChevronLeft, ChevronRight, Ellipsis, Link2, Mail, Plus, RefreshCw, TriangleAlert, X } from "lucide-react";
import { motion } from "motion/react";
import { DropdownMenu } from "radix-ui";
import { useEffect, useMemo, useState } from "react";
import { addMonths, dayKey, eventSpan, formatMonth, monthGrid, onDay, sameDay, startOfMonth, visibleDays, weekdayShort } from "@/lib/calendar/dates";
import { calendarConnectUrl, todayLeft, useCalendar, visibleEvents, type AppMode } from "@/lib/calendar/store";
import type { Calendar, CalendarSource, CalendarSuggestion } from "@/lib/calendar/types";
import { t, tn } from "@/lib/i18n";
import { unreadCount, useMail } from "@/lib/store";
import { viewCount } from "@/lib/tasks/logic";
import { useTasks } from "@/lib/tasks/store";
import { useNow } from "@/lib/use-now";
import { cn } from "@/lib/utils";
import { confirmAction } from "../confirm";
import { FOLDER_HUES } from "../folders";
import { hueStyle, MailboxBadge, menuContentClass, menuItemClass, spring, Tooltip } from "../ui";

/* ---------------------------- Mail | Calendar | Tasks ---------------------------- */

const MODES: { id: AppMode; icon: typeof Mail }[] = [
  { id: "mail", icon: Mail },
  { id: "calendar", icon: CalendarDays },
  { id: "tasks", icon: CircleCheckBig },
];

/** How much waits in each: unread mail in the Inbox, what's left on today's calendar, today's tasks (with the late ones). */
function useModeCounts(): Record<AppMode, number> {
  const now = useNow();
  const mail = useMail((s) => unreadCount(s.threads, "all"));
  const calendar = useCalendar((s) => todayLeft(s, now));
  const tasks = useTasks((s) => viewCount(s.tasks, "today", new Date(now)));

  // The calendar and the tasks load once they're opened; their numbers are wanted before that.
  useEffect(() => {
    let last = 0;
    const load = () => {
      if (document.visibilityState !== "visible" || Date.now() - last < 60_000) return;
      last = Date.now();
      void useCalendar.getState().loadToday();
      const tasks = useTasks.getState();
      void (tasks.ready ? tasks.refresh() : tasks.init());
    };
    load();
    window.addEventListener("focus", load);
    document.addEventListener("visibilitychange", load);
    return () => {
      window.removeEventListener("focus", load);
      document.removeEventListener("visibilitychange", load);
    };
  }, []);

  return { mail, calendar, tasks };
}

/** The switch next to the name: the mail, the calendar or the tasks. They're apps side by side, not folders of each other. Each says how much waits in it. */
export function ModeSwitch({ collapsed, onSwitch }: { collapsed?: boolean; onSwitch?: () => void }) {
  const mode = useCalendar((s) => s.mode);
  const setMode = useCalendar((s) => s.setMode);
  const counts = useModeCounts();
  return (
    <div role="tablist" aria-label={t("Mail, calendar or tasks")} className={cn("relative flex shrink-0 rounded-[10px] bg-hover p-0.5", collapsed && "flex-col")}>
      {MODES.map((m) => {
        const name = m.id === "mail" ? t("Mail@@mode") : m.id === "calendar" ? t("Calendar") : t("Tasks");
        const n = counts[m.id];
        const label = !n
          ? name
          : m.id === "mail"
            ? tn(n, "Mail: {n} unread", "Mail: {n} unread")
            : m.id === "calendar"
              ? tn(n, "Calendar: {n} event left today", "Calendar: {n} events left today")
              : tn(n, "Tasks: {n} for today", "Tasks: {n} for today");
        return (
          <Tooltip key={m.id} label={label} side={collapsed ? "right" : "bottom"}>
            <button
              role="tab"
              aria-selected={mode === m.id}
              aria-label={label}
              onClick={() => {
                setMode(m.id);
                onSwitch?.();
              }}
              className="press relative flex h-7 w-8 items-center justify-center rounded-[8px] [--press-scale:0.9] pointer-coarse:h-8 pointer-coarse:w-10"
            >
              {mode === m.id && (
                <motion.span
                  layoutId={collapsed ? "mode-switch-narrow" : "mode-switch"}
                  transition={spring}
                  className="absolute inset-0 rounded-[8px] bg-solid shadow-[0_1px_2px_rgb(0_0_0/0.08),0_0_0_0.5px_var(--line)]"
                />
              )}
              <m.icon size={15} strokeWidth={mode === m.id ? 2.2 : 1.9} className={cn("relative transition-colors", mode === m.id ? "text-ink" : "text-ink-3")} />
              {n > 0 && (
                <span
                  aria-hidden
                  className="absolute -top-1.5 -right-1 z-10 h-[15px] min-w-[15px] rounded-full bg-accent px-[4px] text-center text-[9.5px] leading-[15px] font-semibold text-on-accent tabular-nums ring-2 ring-[var(--glass-strong)]"
                >
                  {n > 99 ? "99+" : n}
                </span>
              )}
            </button>
          </Tooltip>
        );
      })}
    </div>
  );
}

/* --------------------------------- Sidebar --------------------------------- */

/** What the sidebar holds while the calendar is open: a new event, a small month to jump around in, and the calendars with their ticks. */
export function CalendarSidebar({ collapsed, onNavigate }: { collapsed?: boolean; onNavigate?: () => void }) {
  const newEvent = useCalendar((s) => s.newEvent);
  const calendars = useCalendar((s) => s.calendars);
  const toggle = useCalendar((s) => s.toggleCalendar);
  const setAdding = useCalendar((s) => s.setAdding);

  if (collapsed) {
    return (
      <>
        <Tooltip label={t("New event")} shortcut="C" side="right">
          <button
            onClick={() => newEvent()}
            aria-label={t("New event")}
            className="press mb-2 flex size-9 items-center justify-center rounded-[11px] bg-accent text-on-accent shadow-[0_1px_2px_rgb(0_0_0/0.12),inset_0_1px_0_rgb(255_255_255/0.18)] [--press-scale:0.97] hover:bg-accent-hover"
          >
            <Plus size={17} strokeWidth={2.2} />
          </button>
        </Tooltip>
        <div className="no-scrollbar flex min-h-0 flex-1 flex-col items-center gap-1 overflow-y-auto">
          {calendars.map((c) => (
            <Tooltip key={c.id} label={c.name} side="right">
              <button onClick={() => toggle(c.id)} aria-pressed={c.visible} aria-label={c.name} className="flex size-9 items-center justify-center rounded-[10px] hover:bg-hover">
                <Tick on={c.visible} hue={c.hue} />
              </button>
            </Tooltip>
          ))}
          <Tooltip label={t("Add calendar")} side="right">
            <button onClick={() => setAdding("menu")} aria-label={t("Add calendar")} className="flex size-9 items-center justify-center rounded-[10px] text-ink-3 hover:bg-hover hover:text-ink">
              <CalendarPlus size={15} />
            </button>
          </Tooltip>
        </div>
      </>
    );
  }

  return (
    <>
      <Tooltip label={t("New event")} shortcut="C" side="right">
        <button
          onClick={() => {
            newEvent();
            onNavigate?.();
          }}
          className="press mb-3 flex h-9 w-full shrink-0 items-center justify-center gap-2 rounded-[11px] bg-accent text-[13px] font-medium text-on-accent shadow-[0_1px_2px_rgb(0_0_0/0.12),inset_0_1px_0_rgb(255_255_255/0.18)] [--press-scale:0.97] hover:bg-accent-hover"
        >
          <Plus size={16} strokeWidth={2.2} />
          {t("New event")}
        </button>
      </Tooltip>
      <MiniMonth onPick={onNavigate} />
      <div className="no-scrollbar -mx-2.5 mt-3 flex min-h-0 flex-1 flex-col overflow-y-auto px-2.5">
        <Suggestions />
        <CalendarList />
        <button
          onClick={() => {
            setAdding("menu");
            onNavigate?.();
          }}
          className="mt-2 flex h-[34px] w-full shrink-0 items-center gap-2.5 rounded-[10px] px-1.5 text-left text-[13.5px] text-ink-3 transition-colors hover:bg-hover hover:text-ink-2"
        >
          <span className="inline-flex size-[22px] items-center justify-center">
            <Plus size={15} />
          </span>
          {t("Add calendar")}
        </button>
      </div>
    </>
  );
}

/* -------------------------------- Small month ------------------------------- */

/** A month to jump around in: the days on screen are marked, days with something on have a dot. */
function MiniMonth({ onPick }: { onPick?: () => void }) {
  const anchor = useCalendar((s) => s.anchor);
  const view = useCalendar((s) => s.view);
  const events = useCalendar((s) => s.events);
  const calendars = useCalendar((s) => s.calendars);
  const goTo = useCalendar((s) => s.goTo);
  const now = new Date(useNow());
  // Paging here looks around without moving the big view; it follows again when the big view moves.
  const [page, setPage] = useState<{ month: number; from: number } | null>(null);
  const monthAt = page && page.from === anchor ? page.month : startOfMonth(new Date(anchor)).getTime();
  const month = useMemo(() => new Date(monthAt), [monthAt]);
  const days = useMemo(() => monthGrid(month), [month]);
  const onScreen = useMemo(() => new Set(visibleDays(view === "month" ? "day" : view, new Date(anchor)).map(dayKey)), [view, anchor]);
  const busy = useMemo(() => {
    const spans = visibleEvents(events, calendars).map(eventSpan);
    return new Set(days.filter((d) => spans.some((s) => onDay(s, d))).map(dayKey));
  }, [events, calendars, days]);
  const turn = (delta: number) => setPage({ month: addMonths(month, delta).getTime(), from: anchor });

  return (
    <div className="shrink-0">
      <div className="mb-1 flex items-center gap-0.5 pl-1.5">
        <span className="flex-1 text-[13px] font-semibold capitalize">{formatMonth(month)}</span>
        <button onClick={() => turn(-1)} aria-label={t("Previous month")} className="flex size-7 items-center justify-center rounded-[8px] text-ink-3 transition-colors hover:bg-hover hover:text-ink">
          <ChevronLeft size={15} />
        </button>
        <button onClick={() => turn(1)} aria-label={t("Next month")} className="flex size-7 items-center justify-center rounded-[8px] text-ink-3 transition-colors hover:bg-hover hover:text-ink">
          <ChevronRight size={15} />
        </button>
      </div>
      <div className="grid grid-cols-7 text-center">
        {days.slice(0, 7).map((d) => (
          <span key={d.getDay()} className="pb-1 text-[10.5px] font-medium text-ink-3 capitalize">
            {weekdayShort(d).slice(0, 2)}
          </span>
        ))}
        {days.map((d) => {
          const key = dayKey(d);
          const today = sameDay(d, now);
          const shown = view !== "month" && onScreen.has(key);
          return (
            <button
              key={key}
              onClick={() => {
                setPage(null);
                goTo(d);
                onPick?.();
              }}
              className={cn(
                "relative mx-auto flex size-7 items-center justify-center rounded-full text-[12px] tabular-nums transition-colors pointer-coarse:size-9 pointer-coarse:text-[14px]",
                today ? "bg-accent font-semibold text-on-accent" : shown ? "bg-selected font-medium text-ink" : d.getMonth() === month.getMonth() ? "text-ink-2 hover:bg-hover" : "text-ink-3/70 hover:bg-hover",
              )}
            >
              {d.getDate()}
              {busy.has(key) && !today && <span className="absolute bottom-[3px] size-[3px] rounded-full bg-ink-3" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------- Calendars and their ticks ------------------------- */

function Tick({ on, hue }: { on: boolean; hue: number }) {
  return (
    <span data-on={on ? "" : undefined} className="cal-check inline-flex size-[15px] shrink-0 items-center justify-center rounded-[5px] transition-colors" style={hueStyle(hue)}>
      <Check size={11} strokeWidth={3.2} />
    </span>
  );
}

/** Where a group of calendars comes from, in words. */
export function sourceTitle(source: CalendarSource, accountName?: string) {
  if (source.kind === "local") return "Kolbaba";
  if (source.kind === "feed") return t("Followed by link");
  return accountName ?? source.label;
}

function CalendarList() {
  const sources = useCalendar((s) => s.sources);
  const calendars = useCalendar((s) => s.calendars);
  const accounts = useMail((s) => s.accounts);
  // Followed links are one calendar each: they share a heading.
  const groups = useMemo(() => {
    const feeds = sources.filter((s) => s.kind === "feed");
    const rest = sources.filter((s) => s.kind !== "feed");
    return [...rest.map((s) => ({ key: s.id, sources: [s] })), ...(feeds.length ? [{ key: "feeds", sources: feeds }] : [])];
  }, [sources]);

  return (
    <>
      {groups.map((group) => {
        const first = group.sources[0];
        const account = accounts.find((a) => a.id === first.accountId);
        const own = calendars.filter((c) => group.sources.some((s) => s.id === c.sourceId));
        if (!own.length && first.status === "ok") return null;
        const broken = group.sources.find((s) => s.status !== "ok");
        return (
          <section key={group.key} className="mb-1.5">
            <div className="group/source flex h-7 items-center gap-1.5 px-1.5 text-[11px] font-medium tracking-[0.01em] text-ink-3">
              {account && <MailboxBadge icon={account.icon} hue={account.hue} image={account.image} size={14} className="rounded-[4px]" />}
              <span className="min-w-0 flex-1 truncate">{sourceTitle(first, account?.name)}</span>
              {broken && first.kind !== "feed" && (
                <Tooltip label={broken.status === "auth_error" ? t("Has to be connected again") : t("Couldn't be reached last time")} side="right">
                  <TriangleAlert size={13} className="shrink-0 text-warning" />
                </Tooltip>
              )}
              {first.kind !== "local" && first.kind !== "feed" && <SourceMenu source={first} />}
            </div>
            {broken?.status === "auth_error" && first.kind !== "feed" && <Reconnect source={broken} />}
            {own.map((c) => (
              <CalendarRow key={c.id} calendar={c} source={group.sources.find((s) => s.id === c.sourceId)!} />
            ))}
          </section>
        );
      })}
    </>
  );
}

/** A Google or Microsoft account whose permission ran out: one click back to their page. CalDAV follows its mailbox's password. */
function Reconnect({ source }: { source: CalendarSource }) {
  if (source.kind !== "google" && source.kind !== "microsoft") {
    return <p className="px-1.5 pb-1 text-[12px] leading-snug text-ink-3">{t("The calendar no longer accepts the password. Disconnect it and add it again.")}</p>;
  }
  return (
    <a
      href={calendarConnectUrl(source.kind, { accountId: source.accountId ?? undefined, hint: source.label })}
      className="mx-1.5 mb-1 flex h-8 items-center justify-center rounded-[9px] bg-accent-soft text-[12.5px] font-medium text-accent-text hover:bg-accent hover:text-on-accent"
    >
      {t("Connect again")}
    </a>
  );
}

function SourceMenu({ source }: { source: CalendarSource }) {
  const { refresh, removeSource } = useCalendar.getState();
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        aria-label={t("More for {name}", { name: source.label })}
        className="flex size-6 shrink-0 items-center justify-center rounded-md text-ink-3 opacity-0 outline-none transition-[opacity,background-color] group-hover/source:opacity-100 hover:bg-hover hover:text-ink focus-visible:opacity-100 data-[state=open]:bg-hover data-[state=open]:opacity-100 pointer-coarse:opacity-100"
      >
        <Ellipsis size={14} />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={4} collisionPadding={8} className={menuContentClass}>
          <DropdownMenu.Item className={menuItemClass} onSelect={() => void refresh(true)}>
            <RefreshCw size={14} /> {t("Refresh")}
          </DropdownMenu.Item>
          <DropdownMenu.Item
            className={menuItemClass}
            onSelect={() =>
              confirmAction({
                title: t("Disconnect {name}?", { name: source.label }),
                message: t("Its calendars leave Kolbaba. Nothing changes in the calendars themselves."),
                confirmLabel: t("Disconnect"),
                onConfirm: () => void removeSource(source.id),
              })
            }
          >
            <X size={14} /> {t("Disconnect")}
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function CalendarRow({ calendar, source }: { calendar: Calendar; source: CalendarSource }) {
  const { toggleCalendar, showOnly, showAll, updateCalendar, deleteCalendar, setRenaming } = useCalendar.getState();
  const own = source.kind === "local" || source.kind === "feed";
  const rename = () => setRenaming(calendar.id);
  return (
    <div className="group/cal relative flex h-[32px] items-center rounded-[10px] transition-colors hover:bg-hover pointer-coarse:h-10">
      <button onClick={() => toggleCalendar(calendar.id)} aria-pressed={calendar.visible} className="flex h-full min-w-0 flex-1 items-center gap-2.5 px-1.5 text-left text-[13.5px]">
        <span className="inline-flex size-[22px] shrink-0 items-center justify-center">
          <Tick on={calendar.visible} hue={calendar.hue} />
        </span>
        <span className={cn("min-w-0 flex-1 truncate", calendar.visible ? "text-ink-2" : "text-ink-3")}>{calendar.name}</span>
        {source.kind === "feed" && <Link2 size={12} className="shrink-0 text-ink-3" />}
      </button>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger
          aria-label={t("More for {name}", { name: calendar.name })}
          className="mr-1 flex size-6 shrink-0 items-center justify-center rounded-md text-ink-3 opacity-0 outline-none transition-[opacity,background-color] group-hover/cal:opacity-100 hover:bg-selected hover:text-ink focus-visible:opacity-100 data-[state=open]:bg-selected data-[state=open]:opacity-100 pointer-coarse:opacity-100"
        >
          <Ellipsis size={14} />
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content align="end" sideOffset={4} collisionPadding={8} className={cn(menuContentClass, "w-[216px]")}>
            <DropdownMenu.Item className={menuItemClass} onSelect={() => showOnly(calendar.id)}>
              {t("Show only this one")}
            </DropdownMenu.Item>
            <DropdownMenu.Item className={menuItemClass} onSelect={showAll}>
              {t("Show all calendars")}
            </DropdownMenu.Item>
            <div className="my-1 h-px bg-line" />
            <div className="grid grid-cols-6 gap-1 px-2 py-1.5">
              {FOLDER_HUES.map((h) => (
                <button key={h} onClick={() => updateCalendar(calendar.id, { hue: h })} aria-label={t("Colour {n}", { n: FOLDER_HUES.indexOf(h) + 1 })} aria-pressed={calendar.hue === h} className="flex size-7 items-center justify-center rounded-full">
                  <span className={cn("hue-dot flex size-5 items-center justify-center rounded-full text-white", calendar.hue === h && "ring-2 ring-ink/60 ring-offset-2 ring-offset-[var(--solid)]")} style={hueStyle(h)}>
                    {calendar.hue === h && <Check size={11} strokeWidth={3} />}
                  </span>
                </button>
              ))}
            </div>
            {own && (
              <>
                <div className="my-1 h-px bg-line" />
                <DropdownMenu.Item className={menuItemClass} onSelect={rename}>
                  {t("Rename")}
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  className={menuItemClass}
                  onSelect={() =>
                    confirmAction({
                      title: source.kind === "feed" ? t("Stop following {name}?", { name: calendar.name }) : t("Delete {name}?", { name: calendar.name }),
                      message: source.kind === "feed" ? t("Its events leave Kolbaba. You can follow the link again any time.") : t("The calendar and every event in it are deleted for good."),
                      confirmLabel: source.kind === "feed" ? t("Stop following") : t("Delete calendar"),
                      onConfirm: () => void deleteCalendar(calendar.id),
                    })
                  }
                >
                  {source.kind === "feed" ? t("Stop following") : t("Delete calendar")}
                </DropdownMenu.Item>
              </>
            )}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  );
}

/* ------------------------ Calendars of the mailboxes ------------------------ */

/** Add a mailbox's calendar: Google and Microsoft ask on their own page, the rest signs in with the mailbox's password. */
export function useAddSuggestion() {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<{ accountId: string; message: string } | null>(null);
  const accounts = useMail((s) => s.accounts);
  const add = async (s: CalendarSuggestion) => {
    const account = accounts.find((a) => a.id === s.accountId);
    if (s.how !== "caldav") return void window.location.assign(calendarConnectUrl(s.how, { accountId: s.accountId, hint: account?.email }));
    setBusy(s.accountId);
    setError(null);
    const message = await useCalendar.getState().connectCalDav({ accountId: s.accountId });
    setBusy(null);
    if (message) setError({ accountId: s.accountId, message });
  };
  return { add, busy, error };
}

/** Mailboxes whose calendar isn't here yet, offered once in the sidebar (the first-run screen offers them too). */
function Suggestions() {
  const suggestions = useCalendar((s) => s.suggestions);
  const has = useCalendar((s) => s.calendars.length > 0);
  const accounts = useMail((s) => s.accounts);
  const skip = useCalendar((s) => s.skipSuggestion);
  const { add, busy, error } = useAddSuggestion();
  const rows = suggestions.map((s) => ({ s, account: accounts.find((a) => a.id === s.accountId) })).filter((r) => r.account);
  // With no calendar at all, the big screen next door asks instead.
  if (!rows.length || !has) return null;
  return (
    <div className="mb-3 shrink-0 rounded-[12px] bg-accent-soft p-2">
      <div className="px-1 pb-1.5 text-[12px] leading-snug font-medium text-accent-text">{t("Add the calendar of your mailbox too?")}</div>
      {rows.map(({ s, account }) => (
        <div key={s.accountId}>
          <div className="flex h-8 items-center gap-2 px-1">
            <MailboxBadge icon={account!.icon} hue={account!.hue} image={account!.image} size={18} className="rounded-[5px]" />
            <span className="min-w-0 flex-1 truncate text-[13px] text-ink-2">{account!.name}</span>
            <button onClick={() => void add(s)} disabled={busy === s.accountId} className="h-6 shrink-0 rounded-[7px] bg-accent px-2 text-[12px] font-medium text-on-accent hover:bg-accent-hover disabled:opacity-60">
              {busy === s.accountId ? t("Adding…") : t("Add")}
            </button>
            <Tooltip label={t("Don't offer it again")} side="right">
              <button onClick={() => skip(s.accountId)} aria-label={t("Don't offer it again")} className="flex size-6 shrink-0 items-center justify-center rounded-[7px] text-ink-3 hover:bg-hover hover:text-ink">
                <X size={13} />
              </button>
            </Tooltip>
          </div>
          {error?.accountId === s.accountId && <p className="px-1 pb-1 text-[12px] leading-snug text-danger">{error.message}</p>}
        </div>
      ))}
    </div>
  );
}
