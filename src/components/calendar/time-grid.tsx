"use client";

import { Repeat, Video } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { addDays, atTime, eventSpan, formatTime, minutesOf, sameDay, spansDays, startOfDay, weekdayShort } from "@/lib/calendar/dates";
import { layoutBars, layoutDay, type TimedBox } from "@/lib/calendar/layout";
import { useCalendar } from "@/lib/calendar/store";
import type { CalEvent, Calendar } from "@/lib/calendar/types";
import { intlLocale, t } from "@/lib/i18n";
import { useNow } from "@/lib/use-now";
import { cn } from "@/lib/utils";
import { hueStyle } from "../ui";
import { canDrag, DRAG_SLOP, dragByDay, moveEvent, type Drag } from "./move-event";

/** One hour's height. Roomy enough that a half-hour event shows its title and time. */
const HOUR = 52;
const SNAP = 15;
const BAR = 24;

const rectOf = (el: Element) => {
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: r.height };
};

const snap = (m: number, step = SNAP) => Math.round(m / step) * step;
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
/** A day and minutes from its midnight (before it or past its end too) → that local moment. */
const minuteOf = (day: Date, minutes: number) => new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, minutes);

/** Taking hold of an event: to move it, or by its lower edge to make it longer or shorter. */
type Grab = (event: CalEvent, kind: "move" | "resize", e: ReactPointerEvent) => void;

/**
 * Days side by side with the hours down the page (the week and day views; three days on a phone).
 * Events of a whole day or more sit in a strip on top. Click an empty time to make an event there,
 * or drag over the time it should take. An event is dragged to another time or day, and by its lower
 * edge to another length.
 */
export function TimeGrid({ days, events, calendars, compact }: { days: Date[]; events: CalEvent[]; calendars: Calendar[]; compact?: boolean }) {
  const scroller = useRef<HTMLDivElement>(null);
  const columns = useRef<HTMLDivElement>(null);
  const strip = useRef<HTMLDivElement>(null);
  // Where the event being dragged would land, in the hours or in the strip on top.
  const [drag, setDrag] = useState<(Drag & { kind: "move" | "resize" | "day" }) | null>(null);
  // A drag just ended: the click that comes with letting go isn't one.
  const dropped = useRef(false);
  const drop = () => {
    dropped.current = true;
    setTimeout(() => (dropped.current = false), 0);
  };
  const open = (event: CalEvent, el: Element) => !dropped.current && useCalendar.getState().showEvent(event.id, rectOf(el));
  const now = new Date(useNow());
  const goTo = useCalendar((s) => s.goTo);
  const openId = useCalendar((s) => s.openEvent?.id);
  const hueOf = useMemo(() => new Map(calendars.map((c) => [c.id, c.hue])), [calendars]);
  const long = useMemo(() => layoutBars(events.filter(spansDays), days), [events, days]);
  const lines = Math.max(0, ...long.map((b) => b.line + 1));
  const gutter = compact ? "w-11" : "w-14";

  // Open on the working day: a little above now when today is on screen, else the morning.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const today = days.some((d) => sameDay(d, new Date()));
    const minutes = today ? Math.max(0, minutesOf(new Date()) - 150) : 7 * 60;
    el.scrollTop = Math.min((minutes / 60) * HOUR, 8.5 * HOUR);
    // Once per mount: stepping to another week keeps the place.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hourLabel = useMemo(() => new Intl.DateTimeFormat(intlLocale(), { hour: "numeric", minute: "2-digit" }), []);

  const grab: Grab = (event, kind, e) => {
    const grid = columns.current;
    if (!grid || !canDrag(event, e)) return;
    const span = eventSpan(event);
    const at = (x: number, y: number) => {
      const r = grid.getBoundingClientRect();
      return { column: clamp(Math.floor((x - r.left) / (r.width / days.length)), 0, days.length - 1), minutes: ((y - r.top) / HOUR) * 60 };
    };
    const from = at(e.clientX, e.clientY);
    // Where in the event it was taken hold of, so it doesn't jump under the pointer.
    const hold = from.minutes - (span.start.getTime() - startOfDay(days[from.column]).getTime()) / 60_000;
    const length = span.end.getTime() - span.start.getTime();
    const origin = { x: e.clientX, y: e.clientY };
    let last = origin;
    let active = false;
    let next: Drag | null = null;
    const update = () => {
      const p = at(last.x, last.y);
      if (kind === "move") {
        const start = minuteOf(days[p.column], snap(p.minutes - hold));
        next = { event, start, end: new Date(start.getTime() + length) };
      } else {
        const end = minuteOf(days[from.column], clamp(snap(p.minutes), 0, 1440));
        next = { event, start: span.start, end: new Date(Math.max(end.getTime(), span.start.getTime() + SNAP * 60_000)) };
      }
      setDrag({ ...next, kind });
    };
    const move = (ev: PointerEvent) => {
      last = { x: ev.clientX, y: ev.clientY };
      if (!active && Math.hypot(last.x - origin.x, last.y - origin.y) < DRAG_SLOP) return;
      active = true;
      update();
    };
    // Near the top or bottom edge the hours scroll under the pointer.
    const scroll = setInterval(() => {
      const el = scroller.current;
      if (!active || !el) return;
      const r = el.getBoundingClientRect();
      const by = last.y < r.top + 36 ? -10 : last.y > r.bottom - 36 ? 10 : 0;
      if (!by) return;
      el.scrollTop += by;
      update();
    }, 16);
    const stop = () => {
      clearInterval(scroll);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("keydown", key, true);
      setDrag(null);
    };
    const up = () => {
      stop();
      if (!active || !next) return;
      drop();
      moveEvent(event, next.start, next.end);
    };
    const key = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape") return;
      ev.stopPropagation();
      stop();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("keydown", key, true);
  };

  /** The day under the pointer in the strip of all-day events. */
  const stripDay = (x: number) => {
    const r = strip.current?.getBoundingClientRect();
    return r ? days[clamp(Math.floor((x - r.left) / (r.width / days.length)), 0, days.length - 1)] : null;
  };
  // The days the dragged all-day event would cover, as columns of the strip.
  const landing = (() => {
    if (drag?.kind !== "day") return null;
    const first = days.findIndex((d) => d.getTime() >= startOfDay(drag.start).getTime() && d < drag.end);
    if (first < 0) return null;
    let span = 0;
    while (first + span < days.length && days[first + span] < drag.end) span++;
    return { first, span };
  })();

  return (
    <div className={cn("flex h-full min-h-0 flex-col", drag && "select-none", drag && (drag.kind === "resize" ? "[&_*]:!cursor-ns-resize" : "[&_*]:!cursor-grabbing"))}>
      <div className="flex shrink-0">
        <div className={cn("shrink-0", gutter)} />
        <div className="grid min-w-0 flex-1" style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}>
          {days.map((day) => {
            const today = sameDay(day, now);
            return (
              <button
                key={day.getTime()}
                onClick={() => goTo(day, "day")}
                className={cn("group flex items-center justify-center gap-1.5 py-2 text-[12px]", compact && "flex-col gap-0.5 py-1.5", today ? "font-medium text-accent-text" : "text-ink-3")}
              >
                <span className="capitalize">{weekdayShort(day)}</span>
                <span
                  className={cn(
                    "flex size-7 items-center justify-center rounded-full text-[14px] font-semibold tabular-nums transition-colors",
                    today ? "bg-accent text-on-accent" : "text-ink group-hover:bg-hover",
                  )}
                >
                  {day.getDate()}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {lines > 0 && (
        <div className="flex shrink-0 border-b border-line">
          <div className={cn("flex shrink-0 items-start justify-end pt-1.5 pr-2 text-[10.5px] text-ink-3", gutter)}>{compact ? "" : t("all day")}</div>
          <div className="relative min-w-0 flex-1 overflow-y-auto" style={{ height: Math.min(lines, 4) * BAR + 6, maxHeight: 4 * BAR + 6 }}>
            <div ref={strip} className="relative" style={{ height: lines * BAR + 4 }}>
              {landing && (
                <div
                  className="pointer-events-none absolute inset-y-0.5 z-10 rounded-[7px] bg-accent-soft/70 shadow-[inset_0_0_0_1.5px_var(--accent)]"
                  style={{ left: `calc(${(landing.first / days.length) * 100}% + 2px)`, width: `calc(${(landing.span / days.length) * 100}% - 5px)` }}
                />
              )}
              {long.map((bar) => (
                <button
                  key={`${bar.event.id}:${bar.column}`}
                  data-event={bar.event.id}
                  data-open={openId === bar.event.id ? "" : undefined}
                  onPointerDown={(e) => dragByDay(bar.event, e, stripDay, (d) => setDrag(d && { ...d, kind: "day" }), drop)}
                  onClick={(e) => open(bar.event, e.currentTarget)}
                  className={cn(
                    "cal-bar absolute flex h-[21px] items-center truncate px-2 text-left text-[12px] font-medium transition-colors",
                    bar.fromBefore ? "rounded-l-none" : "rounded-l-[6px]",
                    bar.toAfter ? "rounded-r-none" : "rounded-r-[6px]",
                    bar.event.myStatus === "declined" && "line-through opacity-60",
                    drag?.event.id === bar.event.id && "opacity-40",
                  )}
                  style={{
                    ...hueStyle(hueOf.get(bar.event.calendarId) ?? 200),
                    top: bar.line * BAR + 2,
                    left: `calc(${(bar.column / days.length) * 100}% + 2px)`,
                    width: `calc(${(bar.span / days.length) * 100}% - 5px)`,
                  }}
                >
                  <span className="truncate">{bar.event.title || t("(No title)")}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
      {lines === 0 && <div className="h-px shrink-0 bg-line" />}

      <div ref={scroller} className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="relative flex" style={{ height: 24 * HOUR }}>
          <div className={cn("relative shrink-0", gutter)}>
            {Array.from({ length: 23 }, (_, i) => i + 1).map((h) => (
              <span key={h} className="absolute right-2 -translate-y-1/2 text-[10.5px] whitespace-nowrap text-ink-3 tabular-nums" style={{ top: h * HOUR }}>
                {hourLabel.format(new Date(2026, 0, 1, h))}
              </span>
            ))}
          </div>
          <div ref={columns} className="relative grid min-w-0 flex-1" style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}>
            {Array.from({ length: 23 }, (_, i) => i + 1).map((h) => (
              <div key={h} className="pointer-events-none absolute inset-x-0 h-px bg-line" style={{ top: h * HOUR }} />
            ))}
            {days.map((day) => (
              <DayColumn key={day.getTime()} day={day} events={events} hueOf={hueOf} now={now} openId={openId} compact={compact} moving={drag && drag.kind !== "day" ? drag : null} grab={grab} open={open} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function DayColumn({
  day,
  events,
  hueOf,
  now,
  openId,
  compact,
  moving,
  grab,
  open,
}: {
  day: Date;
  events: CalEvent[];
  hueOf: Map<string, number>;
  now: Date;
  openId?: string;
  compact?: boolean;
  /** An event being dragged: its part that would land on this day is drawn in its new place. */
  moving: Drag | null;
  grab: Grab;
  open: (event: CalEvent, el: Element) => void;
}) {
  const boxes = useMemo(() => layoutDay(events, day), [events, day]);
  const ref = useRef<HTMLDivElement>(null);
  // The time being dragged over, in minutes from midnight.
  const [drag, setDrag] = useState<{ from: number; to: number } | null>(null);
  const start = useRef<{ y: number; minutes: number } | null>(null);
  // What last pressed here: a mouse drags a time out, a finger taps (and its drag scrolls the page).
  const pointer = useRef("mouse");
  const today = sameDay(day, now);

  const minutesAt = (clientY: number) => {
    const top = ref.current?.getBoundingClientRect().top ?? 0;
    return Math.max(0, Math.min(1440, ((clientY - top) / HOUR) * 60));
  };
  // The part of the dragged event that falls on this day, in minutes from midnight.
  const ghost = (() => {
    if (!moving) return null;
    const midnight = startOfDay(day).getTime();
    const from = (moving.start.getTime() - midnight) / 60_000;
    const to = (moving.end.getTime() - midnight) / 60_000;
    return to <= 0 || from >= 1440 ? null : { top: Math.max(0, from), bottom: Math.min(1440, to) };
  })();

  // The drag goes on outside the column too.
  useEffect(() => {
    if (!drag) return;
    const move = (e: PointerEvent) => {
      const at = snap(minutesAt(e.clientY));
      const origin = start.current?.minutes ?? at;
      setDrag(at >= origin ? { from: origin, to: Math.max(at, origin + SNAP) } : { from: at, to: origin });
    };
    const up = (e: PointerEvent) => {
      const moved = Math.abs(e.clientY - (start.current?.y ?? e.clientY)) > 5;
      const range = moved && drag ? drag : null;
      setDrag(null);
      const from = range ? range.from : Math.min(23 * 60, Math.floor(minutesAt(e.clientY) / 30) * 30);
      const to = range ? range.to : from + 60;
      useCalendar.getState().newEvent({ start: atTime(day, from), end: to >= 1440 ? addDays(startOfDay(day), 1) : atTime(day, to) });
    };
    const cancel = (e: KeyboardEvent) => e.key === "Escape" && setDrag(null);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("keydown", cancel);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("keydown", cancel);
    };
    // `drag` is read at the moment the button is let go.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!drag, drag?.from, drag?.to]);

  return (
    <div
      ref={ref}
      className={cn("relative border-l border-line", today && "bg-accent-soft/25")}
      onPointerDown={(e) => {
        pointer.current = e.pointerType;
        // With a mouse: press and drag over the time. A finger scrolls; it makes an event with a tap (onClick).
        if (e.pointerType !== "mouse" || e.button !== 0 || e.target !== e.currentTarget) return;
        const minutes = snap(minutesAt(e.clientY));
        start.current = { y: e.clientY, minutes };
        setDrag({ from: minutes, to: minutes + SNAP });
      }}
      onClick={(e) => {
        if (pointer.current === "mouse" || e.target !== e.currentTarget) return;
        const from = Math.min(23 * 60, Math.floor(minutesAt(e.clientY) / 30) * 30);
        useCalendar.getState().newEvent({ start: atTime(day, from) });
      }}
    >
      {drag && (
        <div
          className="pointer-events-none absolute inset-x-0.5 z-10 rounded-[8px] bg-accent-soft px-2 py-1 text-[11.5px] font-medium text-accent-text shadow-[inset_0_0_0_1.5px_var(--accent)]"
          style={{ top: (drag.from / 60) * HOUR, height: Math.max(((drag.to - drag.from) / 60) * HOUR, 18) }}
        >
          {formatTime(atTime(day, drag.from))} – {formatTime(atTime(day, Math.min(drag.to, 1439)))}
        </div>
      )}
      {/* Room on the right stays free, so there's always somewhere to click for a new event. */}
      <div className={cn("pointer-events-none absolute inset-y-0 left-0", compact ? "right-1" : "right-2.5")}>
        {boxes.map((box) => (
          <EventBox
            key={box.event.id}
            box={box}
            hue={hueOf.get(box.event.calendarId) ?? 200}
            over={eventSpan(box.event).end < now}
            open={openId === box.event.id}
            compact={compact}
            lifted={moving?.event.id === box.event.id}
            grab={grab}
            onOpen={open}
          />
        ))}
        {moving && ghost && (
          <div
            className="cal-event absolute inset-x-0.5 z-20 overflow-hidden rounded-[7px] py-1 pr-1.5 pl-[9px] shadow-[var(--shadow-float)]"
            style={{ ...hueStyle(hueOf.get(moving.event.calendarId) ?? 200), top: (ghost.top / 60) * HOUR + 1, height: Math.max(((ghost.bottom - ghost.top) / 60) * HOUR - 2, 20) }}
          >
            <span className="block truncate text-[12px] leading-[15px] font-medium">{moving.event.title || t("(No title)")}</span>
            <span className="block truncate text-[11px] leading-[14px] opacity-75">
              {formatTime(moving.start)} – {formatTime(moving.end)}
            </span>
          </div>
        )}
      </div>
      {today && (
        <div className="pointer-events-none absolute inset-x-0 z-10 flex items-center" style={{ top: (minutesOf(now) / 60) * HOUR }}>
          <span className="-ml-[5px] size-[9px] -translate-y-1/2 rounded-full bg-warm" />
          <span className="h-[1.5px] flex-1 -translate-y-1/2 bg-warm" />
        </div>
      )}
    </div>
  );
}

function EventBox({
  box,
  hue,
  over,
  open,
  compact,
  lifted,
  grab,
  onOpen,
}: {
  box: TimedBox;
  hue: number;
  over: boolean;
  open: boolean;
  compact?: boolean;
  /** It's being dragged: it fades where it was. */
  lifted: boolean;
  grab: Grab;
  onOpen: (event: CalEvent, el: Element) => void;
}) {
  const e = box.event;
  const height = ((box.bottom - box.top) / 60) * HOUR;
  const { start, end } = eventSpan(e);
  const time = `${formatTime(start)} – ${formatTime(end)}`;
  // Two lines once there's room for them; a short event says its start after the title.
  const tall = height >= 40;
  return (
    <button
      data-event={e.id}
      data-open={open ? "" : undefined}
      onPointerDown={(ev) => grab(e, "move", ev)}
      onClick={(ev) => onOpen(e, ev.currentTarget)}
      aria-label={`${e.title || t("(No title)")}, ${time}`}
      className={cn(
        "pointer-events-auto absolute overflow-hidden rounded-[7px] pr-1.5 pl-[9px] text-left transition-[background-color,opacity]",
        e.myStatus === "needsAction" || e.myStatus === "tentative" ? "cal-event cal-event-open" : "cal-event",
        e.myStatus === "declined" && "opacity-50",
        over && e.myStatus !== "declined" && "opacity-65 hover:opacity-100",
        lifted && "!opacity-35",
        box.fromBefore && "rounded-t-none",
        box.toAfter && "rounded-b-none",
        // A button centres what's in it; a tall event reads from its top.
        tall ? "flex flex-col justify-start py-1" : "flex items-center",
      )}
      style={{
        ...hueStyle(hue),
        top: (box.top / 60) * HOUR + 1,
        height: height - 2,
        left: `calc(${(box.column / box.columns) * 100}% + 2px)`,
        width: `calc(${100 / box.columns}% - 3px)`,
      }}
    >
      <span className={cn("block truncate text-[12px] leading-[15px] font-medium", e.myStatus === "declined" && "line-through", compact && "text-[11.5px]")}>
        {e.title || t("(No title)")}
        {!tall && !compact && <span className="font-normal opacity-70"> · {formatTime(start)}</span>}
      </span>
      {tall && (
        <span className="mt-px flex items-center gap-1 truncate text-[11px] leading-[14px] opacity-75">
          <span className="truncate">{compact ? formatTime(start) : time}</span>
          {e.recurring && <Repeat size={10} className="shrink-0" />}
          {e.joinUrl && <Video size={11} className="shrink-0" />}
        </span>
      )}
      {height >= 62 && e.location && <span className="block truncate text-[11px] leading-[14px] opacity-65">{e.location}</span>}
      {/* The lower edge: drag it to change when the event ends. */}
      {e.canEdit && !box.toAfter && !compact && (
        <span
          aria-hidden
          onPointerDown={(ev) => {
            ev.stopPropagation();
            grab(e, "resize", ev);
          }}
          className="absolute inset-x-0 bottom-0 h-[6px] cursor-ns-resize"
        />
      )}
    </button>
  );
}
