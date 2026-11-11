import { intlLocale } from "../i18n";
import type { CalEvent, CalendarView } from "./types";

/**
 * Days and times for the calendar, in the browser's own time zone. A day is named by its local date
 * ("2026-11-11"); timed events are instants, all-day ones are dates and never shift with the zone.
 */

export const DAY_MS = 86_400_000;

const pad = (n: number) => String(n).padStart(2, "0");

export const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Local midnight of "YYYY-MM-DD". */
export function parseDay(key: string) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/** Calendar days, not 24 hours: a day with a clock change is still one day. */
export const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes());

/** The same day of another month, or that month's last day when it's shorter (31 Jan → 28 Feb). */
export function addMonths(d: Date, n: number) {
  const first = new Date(d.getFullYear(), d.getMonth() + n, 1);
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  return new Date(first.getFullYear(), first.getMonth(), Math.min(d.getDate(), last));
}

export const startOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);

/** Weeks start on Monday, as in Czech and British calendars. */
export function startOfWeek(d: Date) {
  const day = startOfDay(d);
  return addDays(day, -((day.getDay() + 6) % 7));
}

export const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

export const isWeekend = (d: Date) => d.getDay() === 0 || d.getDay() === 6;

/** The days a month shows: whole weeks from the Monday on or before the 1st, as many rows as the month needs. */
export function monthGrid(anchor: Date): Date[] {
  const first = startOfWeek(startOfMonth(anchor));
  const lastDay = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
  const weeks = Math.ceil((Math.round((startOfDay(lastDay).getTime() - first.getTime()) / DAY_MS) + 1) / 7);
  return Array.from({ length: weeks * 7 }, (_, i) => addDays(first, i));
}

/** The days a view shows around `anchor`; `days` is how many columns the time grid has (7 on a computer, 3 on a phone). */
export function visibleDays(view: CalendarView, anchor: Date, days = 7): Date[] {
  if (view === "month") return monthGrid(anchor);
  if (view === "day") return [startOfDay(anchor)];
  const first = days === 7 ? startOfWeek(anchor) : startOfDay(anchor);
  return Array.from({ length: days }, (_, i) => addDays(first, i));
}

/** Where a step forwards or back lands. */
export function stepAnchor(view: CalendarView, anchor: Date, delta: number, days = 7) {
  if (view === "month") return addMonths(startOfMonth(anchor), delta);
  return addDays(anchor, delta * (view === "day" ? 1 : days));
}

/** When an event is, as local dates: an all-day one runs from midnight to the midnight after its last day. */
export function eventSpan(e: Pick<CalEvent, "start" | "end" | "allDay">): { start: Date; end: Date } {
  if (!e.allDay) return { start: new Date(e.start), end: new Date(e.end) };
  const start = parseDay(e.start);
  const end = parseDay(e.end);
  return { start, end: end > start ? end : addDays(start, 1) };
}

/** The event touches this day. One that ends at midnight doesn't reach into the next day. */
export function onDay(span: { start: Date; end: Date }, day: Date) {
  const from = startOfDay(day).getTime();
  const to = addDays(startOfDay(day), 1).getTime();
  const end = Math.max(span.end.getTime(), span.start.getTime() + 1);
  return span.start.getTime() < to && end > from;
}

/** Longer than a day, or across midnight for good: drawn as a bar on top like an all-day event. */
export const spansDays = (e: Pick<CalEvent, "start" | "end" | "allDay">) => {
  if (e.allDay) return true;
  const { start, end } = eventSpan(e);
  return end.getTime() - start.getTime() >= DAY_MS;
};

/** Minutes since local midnight, by the clock (right on days when the clock changes too). */
export const minutesOf = (d: Date) => d.getHours() * 60 + d.getMinutes();

/** A day and "HH:MM" → that local moment. */
export function atTime(day: Date, minutes: number) {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), Math.floor(minutes / 60), minutes % 60);
}

/** "9:30" / "09:30", as the language writes it. */
export const formatTime = (d: Date) => new Intl.DateTimeFormat(intlLocale(), { hour: "numeric", minute: "2-digit" }).format(d);

/** "November 2026" / "listopad 2026". */
export const formatMonth = (d: Date) => new Intl.DateTimeFormat(intlLocale(), { month: "long", year: "numeric" }).format(d);

/** "Wed 11 Nov" / "st 11. 11." */
export const formatDay = (d: Date) => new Intl.DateTimeFormat(intlLocale(), { weekday: "short", day: "numeric", month: "short" }).format(d);

/** "Wednesday 11 November" / "středa 11. listopadu". */
export const formatLongDay = (d: Date) => new Intl.DateTimeFormat(intlLocale(), { weekday: "long", day: "numeric", month: "long" }).format(d);

export const weekdayShort = (d: Date) => new Intl.DateTimeFormat(intlLocale(), { weekday: "short" }).format(d);

/** What the header says for the days on screen: a month, or a span of days that crosses months. */
export function formatTitle(view: CalendarView, days: Date[], anchor: Date) {
  if (view === "month") return formatMonth(anchor);
  if (view === "day") return formatLongDay(days[0]);
  const [first, last] = [days[0], days[days.length - 1]];
  if (first.getMonth() === last.getMonth()) return formatMonth(first);
  const short = new Intl.DateTimeFormat(intlLocale(), { month: "short" });
  const year = first.getFullYear() === last.getFullYear() ? "" : ` ${first.getFullYear()}`;
  return `${short.format(first)}${year} – ${short.format(last)} ${last.getFullYear()}`;
}

/** "Wed 11 Nov, 9:00 – 10:00", "Wed 11 Nov" (all day), "Wed 11 Nov, 22:00 – Thu 12 Nov, 2:00", "11 – 13 Nov". */
export function formatWhen(e: Pick<CalEvent, "start" | "end" | "allDay">) {
  const { start, end } = eventSpan(e);
  if (e.allDay) {
    const last = addDays(end, -1);
    return sameDay(start, last) ? formatDay(start) : `${formatDay(start)} – ${formatDay(last)}`;
  }
  if (sameDay(start, end) || end.getTime() === start.getTime()) {
    return end.getTime() === start.getTime() ? `${formatDay(start)}, ${formatTime(start)}` : `${formatDay(start)}, ${formatTime(start)} – ${formatTime(end)}`;
  }
  return `${formatDay(start)}, ${formatTime(start)} – ${formatDay(end)}, ${formatTime(end)}`;
}

/** The ISO week number, for the edge of the month view. */
export function weekNumber(d: Date) {
  const day = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const weekday = day.getUTCDay() || 7;
  day.setUTCDate(day.getUTCDate() + 4 - weekday);
  const yearStart = Date.UTC(day.getUTCFullYear(), 0, 1);
  return Math.ceil(((day.getTime() - yearStart) / DAY_MS + 1) / 7);
}

/** The browser's zone ("Europe/Prague"). */
export const localZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
};
