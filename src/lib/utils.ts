import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { intlLocale, t, tk } from "./i18n";
import type { Person } from "./types";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

/** Date formatters in the app's language, made once per language. */
const formatters = new Map<string, Intl.DateTimeFormat>();
function fmt(name: string, options: Intl.DateTimeFormatOptions) {
  const locale = intlLocale();
  const key = `${locale}:${name}`;
  let f = formatters.get(key);
  if (!f) formatters.set(key, (f = new Intl.DateTimeFormat(locale, options)));
  return f;
}
const timeFmt = () => fmt("time", { hour: "2-digit", minute: "2-digit" });
const weekdayFmt = () => fmt("weekday", { weekday: "short" });
const dayMonthFmt = () => fmt("dayMonth", { day: "numeric", month: "short" });
const fullFmt = () =>
  fmt("full", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

function startOfDay(ts: number) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Compact timestamp for list rows: 09:41 · Yesterday · Mon · 12 Sep */
export function formatListTime(ts: number, now = Date.now()) {
  const today = startOfDay(now);
  if (ts >= today) return timeFmt().format(ts);
  if (ts >= today - DAY) return t("Yesterday");
  if (ts >= today - 6 * DAY) return weekdayFmt().format(ts);
  return dayMonthFmt().format(ts);
}

export function formatFullTime(ts: number) {
  return fullFmt().format(ts);
}

/** Human label for a future moment: "Today 18:00", "Tomorrow 08:00", "Mon 08:00". */
export function formatFuture(ts: number, now = Date.now()) {
  const today = startOfDay(now);
  const time = timeFmt().format(ts);
  if (ts < today + DAY) return t("Today {time}", { time });
  if (ts < today + 2 * DAY) return t("Tomorrow {time}", { time });
  if (ts < today + 7 * DAY) return `${weekdayFmt().format(ts)} ${time}`;
  return `${dayMonthFmt().format(ts)} ${time}`;
}

export type DateGroup = "Today" | "Yesterday" | "This week" | "Earlier";

/** The list's date sections. The value is English; show it with t(). */
export function dateGroup(ts: number, now = Date.now()): DateGroup {
  const today = startOfDay(now);
  if (ts >= today) return tk("Today");
  if (ts >= today - DAY) return tk("Yesterday");
  if (ts >= today - 6 * DAY) return tk("This week");
  return tk("Earlier");
}

export function at(dayOffset: number, hours: number, minutes = 0, now = Date.now()) {
  const d = new Date(now);
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hours, minutes, 0, 0);
  return d.getTime();
}

/** Next given weekday (0 = Sun … 6 = Sat) at a time, always in the future. */
export function nextWeekday(weekday: number, hours: number, now = Date.now()) {
  const d = new Date(now);
  const diff = (weekday - d.getDay() + 7) % 7 || 7;
  d.setDate(d.getDate() + diff);
  d.setHours(hours, 0, 0, 0);
  return d.getTime();
}

export function snoozePresets(now = Date.now()) {
  const laterToday = at(0, 18, 0, now);
  const presets = [
    { id: "later", label: t("Later today"), at: laterToday },
    { id: "tomorrow", label: t("Tomorrow"), at: at(1, 8, 0, now) },
    { id: "weekend", label: t("This weekend"), at: nextWeekday(6, 9, now) },
    { id: "next-week", label: t("Next week"), at: nextWeekday(1, 8, now) },
  ];
  return presets.filter((p) => p.at > now + 30 * MINUTE);
}

export function hashHue(input: string) {
  let h = 0;
  for (let i = 0; i < input.length; i++) h = (h * 31 + input.charCodeAt(i)) >>> 0;
  return h % 360;
}

/** What to call someone: their name, or their address when the email carried none (sent to a bare address). */
export const personName = (p: Person) => p.name.trim() || p.email;

/** Their first name, or their address. */
export const firstName = (p: Person) => p.name.trim().split(/\s+/)[0] || p.email;

export function initials(name: string) {
  const parts = name.replace(/[^\p{L}\s]/gu, "").trim().split(/\s+/);
  if (parts.length === 0 || !parts[0]) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function htmlToText(html: string) {
  return html
    .replace(/<(br|\/p|\/h\d|\/li|\/blockquote)>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

export function isTypingTarget(el: EventTarget | null) {
  if (!(el instanceof HTMLElement)) return false;
  return el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName);
}

/**
 * An id nobody can guess, for things the app names before the server has seen them (drafts): a
 * predictable one could be taken first by someone else, and the real draft then couldn't be saved.
 */
export function randomId(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`;
}

let idCounter = 0;
export function uid(prefix = "id") {
  idCounter += 1;
  return `${prefix}_${Date.now().toString(36)}${idCounter.toString(36)}`;
}
