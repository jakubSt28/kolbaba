"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { atTime, dayKey, eventSpan, formatLongDay, formatTime, parseDay, sameDay, startOfDay, weekdayShort } from "@/lib/calendar/dates";
import { hiddenPerDay, layoutBars, type Bar } from "@/lib/calendar/layout";
import { useCalendar } from "@/lib/calendar/store";
import type { CalEvent, Calendar } from "@/lib/calendar/types";
import { t, tn } from "@/lib/i18n";
import { useNow } from "@/lib/use-now";
import { cn } from "@/lib/utils";
import { hueStyle } from "../ui";
import { dragByDay, type Drag } from "./move-event";

const rectOf = (el: Element) => {
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: r.height };
};

/** The day whose cell is under the pointer (the bars lie over the cells, so every element there is asked). */
function dayAt(x: number, y: number) {
  for (const el of document.elementsFromPoint(x, y)) {
    const key = (el as HTMLElement).dataset?.day;
    if (key) return parseDay(key);
  }
  return null;
}

/** Taking hold of an event to drag it to another day, and opening it with a click. */
interface Handling {
  grab: (event: CalEvent, e: React.PointerEvent) => void;
  open: (event: CalEvent, el: Element) => void;
}

/**
 * The month: weeks as rows, events as bars across the days they cover. A row shows as many lines as
 * fit and says how many more a day has. Click a day's number for that day, an empty spot for a new
 * event; on a phone a tap on a day opens it. An event is dragged to another day and keeps its time.
 */
export function MonthView({ days, month, events, calendars, compact }: { days: Date[]; month: number; events: CalEvent[]; calendars: Calendar[]; compact?: boolean }) {
  const grid = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);
  // Where the event being dragged would land.
  const [drag, setDrag] = useState<Drag | null>(null);
  // A drag just ended: the click that comes with letting go isn't one.
  const dropped = useRef(false);
  const handling = useMemo<Handling>(
    () => ({
      grab: (event, e) =>
        dragByDay(event, e, dayAt, setDrag, () => {
          dropped.current = true;
          setTimeout(() => (dropped.current = false), 0);
        }),
      open: (event, el) => !dropped.current && useCalendar.getState().showEvent(event.id, rectOf(el)),
    }),
    [],
  );
  const now = new Date(useNow());
  const openId = useCalendar((s) => s.openEvent?.id);
  const hueOf = useMemo(() => new Map(calendars.map((c) => [c.id, c.hue])), [calendars]);
  const weeks = useMemo(() => Array.from({ length: days.length / 7 }, (_, i) => days.slice(i * 7, i * 7 + 7)), [days]);

  useEffect(() => {
    const el = grid.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setHeight(el.clientHeight));
    observer.observe(el);
    setHeight(el.clientHeight);
    return () => observer.disconnect();
  }, []);

  const line = compact ? 17 : 22;
  const head = compact ? 26 : 30;
  // How many lines of events a week's row has room for under the day numbers.
  const room = Math.max(1, Math.floor((height / weeks.length - head - 3) / line));

  return (
    <div className={cn("flex h-full min-h-0 flex-col", drag && "select-none [&_*]:!cursor-grabbing")}>
      <div className="grid shrink-0 grid-cols-7 border-b border-line">
        {days.slice(0, 7).map((d) => (
          <div key={d.getDay()} className={cn("py-2 text-center text-[11.5px] font-medium text-ink-3 capitalize", compact && "py-1.5 text-[11px]")}>
            {weekdayShort(d)}
          </div>
        ))}
      </div>
      <div ref={grid} className="grid min-h-0 flex-1" style={{ gridTemplateRows: `repeat(${weeks.length}, minmax(0, 1fr))` }}>
        {weeks.map((week) => (
          <WeekRow key={week[0].getTime()} week={week} month={month} events={events} hueOf={hueOf} room={room} line={line} head={head} now={now} openId={openId} compact={compact} drag={drag} handling={handling} />
        ))}
      </div>
    </div>
  );
}

function WeekRow({
  week,
  month,
  events,
  hueOf,
  room,
  line,
  head,
  now,
  openId,
  compact,
  drag,
  handling,
}: {
  week: Date[];
  month: number;
  events: CalEvent[];
  hueOf: Map<string, number>;
  room: number;
  line: number;
  head: number;
  now: Date;
  openId?: string;
  compact?: boolean;
  drag: Drag | null;
  handling: Handling;
}) {
  const bars = useMemo(() => layoutBars(events, week), [events, week]);
  const lines = Math.max(0, ...bars.map((b) => b.line + 1));
  // When not everything fits, the last line is where "+2 more" goes.
  const shown = lines > room ? Math.max(0, room - 1) : room;
  const hidden = hiddenPerDay(bars, 7, shown);
  const { goTo, newEvent } = useCalendar.getState();

  return (
    <div className="relative grid grid-cols-7 border-b border-line last:border-b-0">
      {week.map((day, i) => {
        const today = sameDay(day, now);
        const other = day.getMonth() !== month;
        // The dragged event would cover this day.
        const landing = !!drag && day.getTime() >= startOfDay(drag.start).getTime() && day < drag.end;
        return (
          <div
            key={day.getTime()}
            data-day={dayKey(day)}
            onClick={(e) => {
              if (e.target !== e.currentTarget) return;
              if (compact) goTo(day, "day");
              else newEvent({ start: atTime(day, 9 * 60) });
            }}
            className={cn(
              "min-w-0 border-l border-line first:border-l-0",
              !compact && !drag && "cursor-default hover:bg-hover/60",
              other && "bg-hover/40",
              landing && "bg-accent-soft/70 shadow-[inset_0_0_0_1.5px_var(--accent)]",
            )}
          >
            <button
              onClick={() => goTo(day, "day")}
              aria-label={formatLongDay(day)}
              className={cn(
                "m-1 flex size-6 items-center justify-center rounded-full text-[12.5px] tabular-nums transition-colors",
                compact && "mx-auto",
                today ? "bg-accent font-semibold text-on-accent" : other ? "text-ink-3 hover:bg-hover" : "font-medium text-ink hover:bg-hover",
              )}
            >
              {day.getDate()}
            </button>
            {hidden[i] > 0 && (
              <button
                onClick={() => goTo(day, "day")}
                className="absolute truncate rounded-[5px] px-1.5 text-left text-[11px] font-medium text-ink-3 hover:bg-hover hover:text-ink-2"
                style={{ top: head + shown * line, height: line - 2, left: `calc(${(i / 7) * 100}% + 2px)`, width: `calc(${100 / 7}% - 4px)` }}
              >
                {compact ? `+${hidden[i]}` : tn(hidden[i], "{n} more", "{n} more")}
              </button>
            )}
          </div>
        );
      })}
      {bars
        .filter((b) => b.line < shown)
        .map((bar) => (
          <MonthBar key={`${bar.event.id}:${bar.column}`} bar={bar} hue={hueOf.get(bar.event.calendarId) ?? 200} line={line} head={head} over={eventSpan(bar.event).end < now} open={openId === bar.event.id} compact={compact} lifted={drag?.event.id === bar.event.id} handling={handling} />
        ))}
    </div>
  );
}

function MonthBar({
  bar,
  hue,
  line,
  head,
  over,
  open,
  compact,
  lifted,
  handling,
}: {
  bar: Bar;
  hue: number;
  line: number;
  head: number;
  over: boolean;
  open: boolean;
  compact?: boolean;
  /** It's being dragged: it fades where it was. */
  lifted: boolean;
  handling: Handling;
}) {
  const e = bar.event;
  const declined = e.myStatus === "declined";
  return (
    <button
      data-event={e.id}
      data-open={open ? "" : undefined}
      onPointerDown={(ev) => handling.grab(e, ev)}
      onClick={(ev) => handling.open(e, ev.currentTarget)}
      className={cn(
        "absolute flex items-center gap-1.5 truncate text-left transition-[background-color,opacity]",
        lifted && "!opacity-35",
        compact ? "px-1 text-[10.5px]" : "px-1.5 text-[12px]",
        bar.timed ? "rounded-[5px] hover:bg-hover data-[open]:bg-hover" : "cal-bar font-medium",
        !bar.timed && (bar.fromBefore ? "rounded-l-none" : "rounded-l-[5px]"),
        !bar.timed && (bar.toAfter ? "rounded-r-none" : "rounded-r-[5px]"),
        (over || declined) && "opacity-55 hover:opacity-100",
      )}
      style={{
        ...hueStyle(hue),
        top: head + bar.line * line,
        height: line - 2,
        left: `calc(${(bar.column / 7) * 100}% + 2px)`,
        width: `calc(${(bar.span / 7) * 100}% - 4px)`,
      }}
    >
      {bar.timed && <span className="cal-dot size-[7px] shrink-0 rounded-full" />}
      {bar.timed && !compact && <span className="shrink-0 text-ink-3 tabular-nums">{formatTime(eventSpan(e).start)}</span>}
      <span className={cn("truncate", bar.timed && "font-medium text-ink", declined && "line-through")}>{e.title || t("(No title)")}</span>
    </button>
  );
}
