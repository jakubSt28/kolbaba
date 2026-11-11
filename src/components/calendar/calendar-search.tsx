"use client";

import { LoaderCircle, MapPin, Repeat, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { eventSpan, formatWhen } from "@/lib/calendar/dates";
import { useCalendar } from "@/lib/calendar/store";
import type { CalEvent } from "@/lib/calendar/types";
import { t } from "@/lib/i18n";
import { track } from "@/lib/usage";
import { useNow } from "@/lib/use-now";
import { cn } from "@/lib/utils";
import { hueStyle } from "../ui";

/**
 * Search in events, in place of the days: what's typed is looked for in titles, places, notes and
 * guests, a year back and a year ahead. What's coming is listed first. Picking an event goes to its
 * day and opens it.
 */
export function CalendarSearch({ mobile }: { mobile?: boolean }) {
  const search = useCalendar((s) => s.search);
  const calendars = useCalendar((s) => s.calendars);
  const { setSearch, closeSearch, revealEvent } = useCalendar.getState();
  const [active, setActive] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const now = useNow();
  const hueOf = useMemo(() => new Map(calendars.map((c) => [c.id, c.hue])), [calendars]);
  const nameOf = useMemo(() => new Map(calendars.map((c) => [c.id, c.name])), [calendars]);
  const results = useMemo(() => search?.results ?? [], [search?.results]);
  // The first event that's already over: "Earlier" goes above it.
  const firstPast = results.findIndex((e) => eventSpan(e).end.getTime() < now);
  const query = search?.query ?? "";
  const typed = query.trim().length > 0;

  // The highlighted row stays in view when the arrows move it.
  useEffect(() => {
    list.current?.querySelector(`[data-row="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!search) return null;

  const pick = (event: CalEvent) => {
    track("calSearch");
    revealEvent(event);
  };

  return (
    <div className={cn("flex h-full min-h-0 flex-col", mobile && "absolute inset-0 z-30 bg-canvas pt-[max(10px,env(safe-area-inset-top))]")}>
      {/* As wide as the list under it, so what's typed sits right above what's found. */}
      <div className={cn("mx-auto flex w-full shrink-0 items-center gap-2", mobile ? "px-3 pb-2" : "h-14 max-w-[784px] px-3")}>
        <label className={cn("flex min-w-0 flex-1 items-center gap-2.5 rounded-[12px] bg-hover px-3 transition-shadow focus-within:shadow-[inset_0_0_0_1.5px_var(--accent)]", mobile ? "h-11" : "h-9")}>
          <Search size={15} className="shrink-0 text-ink-3" />
          <input
            autoFocus
            value={query}
            onChange={(e) => {
              setActive(0);
              setSearch(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") closeSearch();
              else if (e.key === "ArrowDown") setActive((i) => Math.min(results.length - 1, i + 1));
              else if (e.key === "ArrowUp") setActive((i) => Math.max(0, i - 1));
              else if (e.key === "Enter" && results[active]) pick(results[active]);
              else return;
              e.preventDefault();
            }}
            type="search"
            enterKeyHint="search"
            autoComplete="off"
            placeholder={t("Search events")}
            aria-label={t("Search events")}
            className={cn("min-w-0 flex-1 bg-transparent outline-none placeholder:text-ink-3 [&::-webkit-search-cancel-button]:hidden", mobile ? "text-[16px]" : "text-[14px]")}
          />
          {search.busy && <LoaderCircle size={14} className="shrink-0 animate-spin text-ink-3" />}
        </label>
        <button
          onClick={closeSearch}
          aria-label={t("Close search")}
          className={cn("flex shrink-0 items-center justify-center text-ink-2 transition-colors hover:text-ink", mobile ? "glass press size-11 rounded-full" : "size-8 rounded-[9px] hover:bg-hover")}
        >
          <X size={mobile ? 18 : 16} />
        </button>
      </div>

      <div ref={list} className={cn("min-h-0 flex-1 overflow-y-auto overscroll-contain", mobile ? "px-2 pb-[max(12px,var(--safe-bottom))]" : "border-t border-line px-3 py-2")}>
        {results.length === 0 ? (
          <div className="px-4 pt-16 text-center">
            {typed && search.results && !search.busy ? (
              <p className="text-[14px] font-medium text-ink">{t("No event has “{query}” in it.", { query: query.trim() })}</p>
            ) : typed ? null : (
              <p className="text-[14px] font-medium text-ink">{t("Search by title, place, notes or guest.")}</p>
            )}
            {(!typed || (search.results && !search.busy)) && <p className="mt-1 text-[12.5px] text-ink-3">{t("Search looks a year back and a year ahead, in the calendars that are ticked.")}</p>}
          </div>
        ) : (
          <ul role="listbox" aria-label={t("Events found")} className="mx-auto flex max-w-[760px] flex-col">
            {results.map((event, i) => (
              <li key={event.id}>
                {(i === 0 || i === firstPast) && <div className="px-3 pt-3 pb-1 text-[12px] font-medium text-ink-3">{i === firstPast ? t("Earlier") : t("Coming up")}</div>}
                <Result
                  event={event}
                  index={i}
                  active={i === active}
                  hue={hueOf.get(event.calendarId) ?? 200}
                  calendar={nameOf.get(event.calendarId) ?? ""}
                  thisYear={new Date(now).getFullYear()}
                  mobile={mobile}
                  onHover={() => setActive(i)}
                  onPick={() => pick(event)}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Result({
  event,
  index,
  active,
  hue,
  calendar,
  thisYear,
  mobile,
  onHover,
  onPick,
}: {
  event: CalEvent;
  index: number;
  active: boolean;
  hue: number;
  calendar: string;
  thisYear: number;
  mobile?: boolean;
  onHover: () => void;
  onPick: () => void;
}) {
  const year = eventSpan(event).start.getFullYear();
  return (
    <button
      role="option"
      aria-selected={active}
      data-row={index}
      onPointerMove={onHover}
      onClick={onPick}
      className={cn("flex w-full items-start gap-3 rounded-[12px] px-3 text-left transition-colors", mobile ? "py-3" : "py-2", active && "bg-hover")}
    >
      <span className="cal-dot mt-[6px] size-2.5 shrink-0 rounded-[3px]" style={hueStyle(hue)} />
      <span className="min-w-0 flex-1">
        <span className={cn("flex items-center gap-1.5 font-medium text-ink", mobile ? "text-[15px]" : "text-[13.5px]", event.myStatus === "declined" && "line-through")}>
          <span className="truncate">{event.title || t("(No title)")}</span>
          {event.recurring && <Repeat size={11} className="shrink-0 text-ink-3" />}
        </span>
        <span className={cn("mt-px flex items-center gap-1.5 text-ink-3", mobile ? "text-[13px]" : "text-[12.5px]")}>
          <span className="shrink-0 text-ink-2">
            {formatWhen(event)}
            {year !== thisYear && ` ${year}`}
          </span>
          {event.location && (
            <>
              <MapPin size={11} className="shrink-0" />
              <span className="truncate">{event.location}</span>
            </>
          )}
        </span>
      </span>
      {!mobile && <span className="mt-[3px] max-w-[160px] shrink-0 truncate text-[12px] text-ink-3">{calendar}</span>}
    </button>
  );
}
