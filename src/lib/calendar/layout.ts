import { addDays, eventSpan, minutesOf, onDay, sameDay, spansDays, startOfDay } from "./dates";
import type { CalEvent } from "./types";

/**
 * Where events go on screen. The time grid puts overlapping events side by side; the month and the
 * strip of all-day events above the time grid lay events out as bars across the days they cover.
 */

/** An event's box in one day of the time grid, in minutes from midnight and as a share of the day's width. */
export interface TimedBox {
  event: CalEvent;
  /** Minutes from midnight, clipped to this day. */
  top: number;
  bottom: number;
  /** 0-based column among the events it overlaps, and how many columns that group has. */
  column: number;
  columns: number;
  /** It began before this day / goes on after it. */
  fromBefore: boolean;
  toAfter: boolean;
}

/** Short events still need room for their title. */
const MIN_MINUTES = 22;

/** The timed events of one day, side by side where they overlap. Events of a day or longer go to the top strip instead. */
export function layoutDay(events: CalEvent[], day: Date): TimedBox[] {
  const dayStart = startOfDay(day);
  const dayEnd = addDays(dayStart, 1);
  const boxes = events
    .filter((e) => !spansDays(e))
    .map((event) => ({ event, span: eventSpan(event) }))
    .filter(({ span }) => onDay(span, day))
    .map(({ event, span }) => {
      const fromBefore = span.start < dayStart;
      const toAfter = span.end > dayEnd;
      const top = fromBefore ? 0 : minutesOf(span.start);
      const bottom = toAfter || (!sameDay(span.end, day) && span.end > dayStart) ? 1440 : minutesOf(span.end);
      return { event, top, bottom: Math.max(bottom, Math.min(1440, top + MIN_MINUTES)), column: 0, columns: 1, fromBefore, toAfter };
    })
    .sort((a, b) => a.top - b.top || b.bottom - a.bottom || a.event.title.localeCompare(b.event.title));

  // Events that overlap (directly or through others) share a group; each takes the first free column.
  let group: TimedBox[] = [];
  let groupEnd = -1;
  const close = () => {
    const columns = Math.max(0, ...group.map((b) => b.column)) + 1;
    for (const b of group) b.columns = columns;
    group = [];
  };
  for (const box of boxes) {
    if (group.length && box.top >= groupEnd) close();
    const taken = new Set(group.filter((b) => b.bottom > box.top).map((b) => b.column));
    let column = 0;
    while (taken.has(column)) column++;
    box.column = column;
    group.push(box);
    groupEnd = Math.max(groupEnd, box.bottom);
  }
  if (group.length) close();
  return boxes;
}

/** An event drawn as a bar across some of the days of a row. */
export interface Bar {
  event: CalEvent;
  /** First column and how many it covers, within the row's days. */
  column: number;
  span: number;
  /** The line it sits on, from the top. */
  line: number;
  /** It began before this row / goes on after it: the bar's end is cut square. */
  fromBefore: boolean;
  toAfter: boolean;
  /** One timed event within a single day: the month shows it as a dot with its time rather than a filled bar. */
  timed: boolean;
}

/**
 * The bars of one row of days (a week of the month, or the strip above the time grid). Longer events
 * come first so they stay on one line across the week, then by when they start.
 */
export function layoutBars(events: CalEvent[], days: Date[]): Bar[] {
  if (!days.length) return [];
  const rowStart = startOfDay(days[0]);
  const rowEnd = addDays(startOfDay(days[days.length - 1]), 1);
  const bars: Bar[] = [];
  for (const event of events) {
    const span = eventSpan(event);
    const first = days.findIndex((d) => onDay(span, d));
    if (first < 0) continue;
    let last = first;
    while (last + 1 < days.length && onDay(span, days[last + 1])) last++;
    bars.push({
      event,
      column: first,
      span: last - first + 1,
      line: 0,
      fromBefore: span.start < rowStart,
      toAfter: span.end > rowEnd,
      timed: !spansDays(event) && last === first,
    });
  }
  const startOf = (b: Bar) => eventSpan(b.event).start.getTime();
  bars.sort((a, b) => Number(a.timed) - Number(b.timed) || a.column - b.column || b.span - a.span || startOf(a) - startOf(b) || a.event.title.localeCompare(b.event.title));
  const lines: boolean[][] = [];
  for (const bar of bars) {
    let line = 0;
    for (;;) {
      const taken = (lines[line] ??= []);
      let free = true;
      for (let c = bar.column; c < bar.column + bar.span; c++) if (taken[c]) free = false;
      if (free) {
        for (let c = bar.column; c < bar.column + bar.span; c++) taken[c] = true;
        break;
      }
      line++;
    }
    bar.line = line;
  }
  return bars;
}

/** How many events of a row are on lines that don't fit, per day: the "+3 more" under each day. */
export function hiddenPerDay(bars: Bar[], days: number, shownLines: number): number[] {
  const hidden = Array.from({ length: days }, () => 0);
  for (const bar of bars) {
    if (bar.line < shownLines) continue;
    for (let c = bar.column; c < bar.column + bar.span; c++) hidden[c]++;
  }
  return hidden;
}

/** The events of one day in reading order: all-day ones first, then by time. */
export function eventsOn(events: CalEvent[], day: Date): CalEvent[] {
  return events
    .filter((e) => onDay(eventSpan(e), day))
    .sort((a, b) => Number(spansDays(b)) - Number(spansDays(a)) || eventSpan(a).start.getTime() - eventSpan(b).start.getTime() || a.title.localeCompare(b.title));
}
