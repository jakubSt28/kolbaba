import { createHash, randomUUID } from "node:crypto";
import ICAL from "ical.js";
import type { AttendeeStatus, EventAttendee } from "@/lib/calendar/types";
import type { Person } from "../db/schema";
import { fold, joinUrlFrom, unfold, WINDOWS_ZONES, zonedToUtc, zoneOffset } from "../mail/ics";
import type { EventDraft, ProviderEvent, Scope } from "./types";

/**
 * iCalendar (RFC 5545) for the calendar: reading the events of a CalDAV server, a feed or an imported
 * file, listing the occurrences of repeating ones, and writing events back without losing what other
 * calendar apps put there. ical.js parses the text and walks the repeat rules; time zones are Intl's,
 * so a weekly 09:00 stays at 09:00 when the clocks change.
 */

type Component = InstanceType<typeof ICAL.Component>;
type Property = InstanceType<typeof ICAL.Property>;
type Recur = InstanceType<typeof ICAL.Recur>;

/** One event as a CalDAV server keeps it: a VCALENDAR with the master VEVENT and its RECURRENCE-ID overrides. */
export interface IcsObject {
  uid: string;
  ics: string;
  /** Earliest start. */
  firstAt: Date | null;
  /** Latest end of any occurrence; null when it repeats without an end. */
  lastAt: Date | null;
}

export interface ParsedCalendar {
  /** X-WR-CALNAME, when the file has one. */
  name: string | null;
  /** X-APPLE-CALENDAR-COLOR / COLOR as "#rrggbb", when present. */
  color: string | null;
  objects: IcsObject[];
}

export interface ExpandOptions {
  /** IANA zone for "floating" times (no TZID, no Z). */
  tz: string;
  /** What identifies the object within its calendar (CalDAV: the resource href; Kolbaba's own: the UID). */
  key: string;
  etag?: string | null;
  /** The calendar owner's addresses, lowercase: finds their own answer and whether they organize. */
  me?: string[];
}

export interface BuildOptions {
  uid?: string;
  /** With attendees: who invites. */
  organizer?: Person | null;
  /** ATTENDEE lines get SCHEDULE-AGENT=CLIENT (RFC 6638): Kolbaba emails the guests itself, the server must not. */
  clientSchedules?: boolean;
  now?: Date;
}

const PRODID = "-//Kolbaba//Calendar//EN";
const DAY = 86_400_000;
const MAX_DESCRIPTION = 8000;
/** Occurrences one object may give in one listing. */
const MAX_OCCURRENCES = 2000;
/** Steps through a repeat rule before giving up: a rule without an end must not run forever. */
const MAX_STEPS = 20_000;
/** A series with more occurrences than this counts as one without an end. */
const MAX_COUNTED = 5000;
/** Property lines longer than this (inline attachments) are left out of imported files. */
const MAX_LINE = 64 * 1024;

// ---------------------------------------------------------------------------------------------
// Times. A wall-clock time ("09:00 on 6 October", wherever) is kept as the UTC milliseconds of the
// same digits, so adding and comparing wall times is plain arithmetic.

const pad = (n: number, width = 2) => String(n).padStart(width, "0");
const startOfDay = (wall: number) => Math.floor(wall / DAY) * DAY;
const wholeSeconds = (date: Date) => Math.floor(date.getTime() / 1000) * 1000;

function fmtDate(wall: number) {
  const d = new Date(wall);
  return `${pad(d.getUTCFullYear(), 4)}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
}

function fmtTime(wall: number) {
  const d = new Date(wall);
  return `${fmtDate(wall)}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
}

/** "20261006", "20261006T090000Z" or ical.js's "2026-10-06T09:00:00" → the wall time and how it was written. */
function parseWall(value: string): { wall: number; date: boolean; utc: boolean } | null {
  const m = /^(\d{4})-?(\d{2})-?(\d{2})(?:T(\d{2}):?(\d{2}):?(\d{2})(Z?))?$/.exec(value.trim());
  if (!m) return null;
  const wall = Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0));
  return Number.isFinite(wall) ? { wall, date: m[4] === undefined, utc: m[7] === "Z" } : null;
}

function icalTime(wall: number, isDate: boolean, utc = false) {
  const d = new Date(wall);
  const data = { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), hour: d.getUTCHours(), minute: d.getUTCMinutes(), second: d.getUTCSeconds(), isDate };
  return utc ? ICAL.Time.fromData(data, ICAL.Timezone.utcTimezone) : ICAL.Time.fromData(data);
}

// ---------------------------------------------------------------------------------------------
// Zones

/** The zone a time is written in, and how to get to real instants and back. */
interface Zone {
  /** How its times are written: with Z, bare (floating), or with a TZID. */
  form: "utc" | "floating" | "tzid";
  /** The TZID as the file writes it. */
  tzid: string | null;
  /** The IANA name, when it is a zone Intl knows. */
  iana: string | null;
  toUtc(wall: number): number;
  toWall(utc: number): number;
}

const UTC: Zone = { form: "utc", tzid: null, iana: "UTC", toUtc: (wall) => wall, toWall: (utc) => utc };
/** All-day events: a date is its own midnight UTC. */
const DATES: Zone = { form: "floating", tzid: null, iana: null, toUtc: (wall) => wall, toWall: (utc) => utc };

function ianaConversions(zone: string): Pick<Zone, "toUtc" | "toWall"> {
  return {
    toUtc: (wall) => {
      const d = new Date(wall);
      return zonedToUtc(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), zone);
    },
    toWall: (utc) => utc + zoneOffset(utc, zone) * 60_000,
  };
}

const ianaNames = new Map<string, string | null>();

/**
 * The IANA zone a TZID means, or null. Outlook writes Windows names, and some servers put a prefix
 * in front ("/freeassociation.sourceforge.net/Europe/Prague").
 */
function ianaZone(tzid: string): string | null {
  const known = ianaNames.get(tzid);
  if (known !== undefined) return known;
  const name = tzid.trim().replace(/^"|"$/g, "");
  const parts = name.replace(/^\/+/, "").split("/");
  let found: string | null = null;
  for (const candidate of [WINDOWS_ZONES[name], ...parts.map((_, i) => parts.slice(i).join("/"))]) {
    if (!candidate) continue;
    try {
      found = new Intl.DateTimeFormat("en-US", { timeZone: candidate }).resolvedOptions().timeZone;
      break;
    } catch {
      // Not a zone: try without the next prefix.
    }
  }
  if (ianaNames.size > 500) ianaNames.clear();
  ianaNames.set(tzid, found);
  return found;
}

const isUtcName = (iana: string) => /^(UTC|GMT|Etc\/(UTC|GMT|UCT|Zulu|Universal))$/i.test(iana);

/** What reading an object needs to know besides the event itself. */
interface Ctx {
  /** Zone for floating times. */
  tz: string;
  vcal: Component | null;
  zones: Map<string, Zone>;
}

function floatingZone(ctx: Ctx): Zone {
  let zone = ctx.zones.get("");
  if (!zone) {
    zone = { form: "floating", tzid: null, iana: null, ...ianaConversions(ianaZone(ctx.tz) ?? "UTC") };
    ctx.zones.set("", zone);
  }
  return zone;
}

/** A zone only the file's own VTIMEZONE describes. */
function vtimezoneConversions(component: Component, tzid: string): Pick<Zone, "toUtc" | "toWall"> {
  const zone = new ICAL.Timezone({ component, tzid });
  const offset = (wall: number) => zone.utcOffset(icalTime(wall, false)) * 1000;
  return { toUtc: (wall) => wall - offset(wall), toWall: (utc) => utc + offset(utc + offset(utc)) };
}

/** The zone of a time property. A bare time takes `inherit` (an override follows its master), else the floating zone. */
function zoneOf(prop: Property, utc: boolean, ctx: Ctx, inherit?: Zone): Zone {
  if (utc) return UTC;
  const tzid = prop.getFirstParameter("tzid");
  if (!tzid) return inherit ?? floatingZone(ctx);
  const cached = ctx.zones.get(tzid);
  if (cached) return cached;
  let zone: Zone;
  const iana = ianaZone(tzid);
  if (iana) zone = { form: "tzid", tzid, iana, ...ianaConversions(iana) };
  else {
    const own = ctx.vcal?.getAllSubcomponents("vtimezone").find((z) => z.getFirstPropertyValue("tzid") === tzid);
    let conversions: Pick<Zone, "toUtc" | "toWall"> | null = null;
    try {
      if (own) conversions = vtimezoneConversions(own, tzid);
    } catch {
      // A VTIMEZONE ical.js can't read is as good as none.
    }
    // A zone nobody describes: its times are read like floating ones, and keep their name when written back.
    const fallback = floatingZone(ctx);
    zone = { form: "tzid", tzid, iana: null, toUtc: conversions?.toUtc ?? fallback.toUtc, toWall: conversions?.toWall ?? fallback.toWall };
  }
  ctx.zones.set(tzid, zone);
  return zone;
}

// ---------------------------------------------------------------------------------------------
// Reading an object

interface Loaded {
  vcal: Component;
  /** The VEVENT without RECURRENCE-ID. Missing when the owner was invited to single occurrences of someone's series. */
  master: Component | null;
  overrides: Component[];
  ctx: Ctx;
}

/** When one VEVENT is, on its own clock. */
interface Timing {
  allDay: boolean;
  zone: Zone;
  /** Start as wall time (all-day: midnight of the first day). */
  start: number;
  /** End minus start on the wall clock: a repeating event keeps its hours across clock changes. */
  span: number;
  startUtc: number;
  endUtc: number;
}

function parseStrict(text: string): Component {
  const parsed: unknown = ICAL.parse(text);
  // Several VCALENDARs in one text come back as a list of them.
  const jcal = Array.isArray(parsed) && Array.isArray(parsed[0]) ? parsed[0] : parsed;
  const vcal = new ICAL.Component(jcal as unknown[]);
  if (vcal.name !== "vcalendar") throw new Error("Not an iCalendar object");
  return vcal;
}

function timingOf(event: Component, ctx: Ctx, inherit?: Zone): Timing {
  const dtstart = event.getFirstProperty("dtstart");
  const first = dtstart ? parseWall(String(dtstart.jCal[3])) : null;
  if (!dtstart || !first) throw new Error("The event has no start");
  const dtend = event.getFirstProperty("dtend");
  const last = dtend ? parseWall(String(dtend.jCal[3])) : null;
  const duration = event.getFirstPropertyValue("duration");
  const length = duration instanceof ICAL.Duration ? duration.toSeconds() * 1000 : null;
  if (first.date) {
    // DTEND of an all-day event is already the day after the last; without one it lasts a day.
    let end = last ? startOfDay(last.wall) : length !== null ? first.wall + Math.ceil(length / DAY) * DAY : first.wall + DAY;
    if (end <= first.wall) end = first.wall + DAY;
    return { allDay: true, zone: DATES, start: first.wall, span: end - first.wall, startUtc: first.wall, endUtc: end };
  }
  const zone = zoneOf(dtstart, first.utc, ctx, inherit);
  const startUtc = zone.toUtc(first.wall);
  let endUtc = startUtc;
  if (dtend && last && !last.date) endUtc = zoneOf(dtend, last.utc, ctx, zone).toUtc(last.wall);
  else if (!dtend && length !== null) endUtc = zone.toUtc(first.wall + length);
  if (endUtc < startUtc) endUtc = startUtc;
  return { allDay: false, zone, start: first.wall, span: Math.max(0, zone.toWall(endUtc) - first.wall), startUtc, endUtc };
}

function load(ics: string, tz: string): Loaded {
  let vcal: Component;
  try {
    vcal = parseStrict(ics);
  } catch {
    // One bad line fails the whole parse: keep the events that can be read on their own.
    const rest = salvage(ics);
    if (!rest) throw new Error("Not a readable iCalendar object");
    vcal = parseStrict(rest);
  }
  const ctx: Ctx = { tz, vcal, zones: new Map() };
  const events = vcal.getAllSubcomponents("vevent").filter((event) => {
    try {
      timingOf(event, ctx);
      return true;
    } catch {
      vcal.removeSubcomponent(event);
      return false;
    }
  });
  if (!events.length) throw new Error("No event in the iCalendar object");
  const master = events.find((e) => !e.hasProperty("recurrence-id")) ?? null;
  return { vcal, master, overrides: events.filter((e) => e.hasProperty("recurrence-id")), ctx };
}

function serialize(vcal: Component): string {
  // Zones first: some readers want a zone described before a time uses it.
  const parts = vcal.getAllSubcomponents();
  const firstOther = parts.findIndex((c) => c.name !== "vtimezone");
  if (firstOther >= 0 && parts.slice(firstOther).some((c) => c.name === "vtimezone")) {
    for (const part of parts.filter((c) => c.name !== "vtimezone")) {
      vcal.removeSubcomponent(part);
      vcal.addSubcomponent(part);
    }
  }
  return vcal.toString().replace(/[\r\n]+$/, "") + "\r\n";
}

const isRecurring = (event: Component) => event.hasProperty("rrule") || event.hasProperty("rdate");

function rulesOf(event: Component): Recur[] {
  return event
    .getAllProperties("rrule")
    .map((p) => p.getFirstValue())
    .filter((v): v is Recur => v instanceof ICAL.Recur);
}

/** Every value of a multi-value property (EXDATE, RDATE) as text; a period gives its start. */
function valuesOf(prop: Property): string[] {
  return (prop.jCal.slice(3) as unknown[]).map((v) => String(Array.isArray(v) ? v[0] : v));
}

/** A RECURRENCE-ID, EXDATE or RDATE value as wall time on the master's clock. */
function onMasterClock(value: string, prop: Property, t: Timing, ctx: Ctx): number | null {
  const v = parseWall(value);
  if (!v) return null;
  if (t.allDay) return startOfDay(v.wall);
  // A date for a timed series means that day's occurrence.
  if (v.date) return v.wall + (t.start - startOfDay(t.start));
  const zone = zoneOf(prop, v.utc, ctx, t.zone);
  return zone === t.zone ? v.wall : t.zone.toWall(zone.toUtc(v.wall));
}

function wallsOf(event: Component, name: string, t: Timing, ctx: Ctx): number[] {
  const walls: number[] = [];
  for (const prop of event.getAllProperties(name)) {
    for (const value of valuesOf(prop)) {
      const wall = onMasterClock(value, prop, t, ctx);
      if (wall !== null) walls.push(wall);
    }
  }
  return walls;
}

/** The occurrence a RECURRENCE-ID override stands for, on the master's clock. */
function overrideWall(override: Component, t: Timing, ctx: Ctx): number | null {
  const prop = override.getFirstProperty("recurrence-id");
  return prop ? onMasterClock(String(prop.jCal[3]), prop, t, ctx) : null;
}

/** A rule's UNTIL on the event's own clock. UNTIL is written in UTC, or as a date (then the whole day counts). */
function untilWall(rule: Recur, t: Timing): number | null {
  const v = rule.until ? parseWall(rule.until.toString()) : null;
  if (!v) return null;
  if (t.allDay) return startOfDay(v.wall);
  if (v.date) return v.wall + DAY - 1000;
  return v.utc ? t.zone.toWall(v.wall) : v.wall;
}

interface Source {
  head: number | null;
  next(): number | null;
}

function listSource(walls: number[]): Source {
  const sorted = [...walls].sort((a, b) => a - b);
  let i = 0;
  const next = () => (i < sorted.length ? sorted[i++] : null);
  return { head: next(), next };
}

const STEP: Record<string, number | undefined> = { SECONDLY: 1000, MINUTELY: 60_000, HOURLY: 3_600_000, DAILY: DAY, WEEKLY: 7 * DAY };

/**
 * Where to start walking a rule so that it gets to `near` soon instead of stepping through years:
 * DTSTART moved by whole intervals, which keeps the days of the week and "every other" in step.
 * Rules that count their occurrences (COUNT, BYSETPOS) have to be walked from the beginning.
 */
function skipAhead(rule: Recur, start: number, near: number): number {
  if (rule.count || rule.getComponent("BYSETPOS").length) return start;
  const interval = Math.max(1, rule.interval || 1);
  const step = STEP[rule.freq];
  const plain = !Object.values(rule.parts as Record<string, unknown[]>).some((values) => values?.length);
  if (step && (step >= DAY || plain)) {
    const skip = Math.floor((near - start) / (step * interval)) - 1;
    return skip > 0 ? start + skip * step * interval : start;
  }
  const [a, b] = [new Date(start), new Date(near)];
  // Not from the 29th on: the month landed in may be shorter.
  if (rule.freq !== "MONTHLY" || a.getUTCDate() > 28) return start;
  const months = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + b.getUTCMonth() - a.getUTCMonth();
  const skip = Math.floor(months / interval) - 1;
  return skip > 0 ? Date.UTC(a.getUTCFullYear(), a.getUTCMonth() + skip * interval, a.getUTCDate(), a.getUTCHours(), a.getUTCMinutes(), a.getUTCSeconds()) : start;
}

/** One RRULE, walked on the wall clock; with `near`, from close before it. */
function ruleSource(rule: Recur, t: Timing, near?: number): Source {
  const walked = rule.clone();
  const until = untilWall(rule, t);
  if (until !== null) walked.until = icalTime(until, t.allDay);
  const from = near === undefined ? t.start : skipAhead(walked, t.start, near);
  let iterator: ReturnType<Recur["iterator"]> | null = null;
  const next = () => {
    try {
      iterator ??= walked.iterator(icalTime(from, t.allDay));
      const time = iterator.next();
      return time ? Date.UTC(time.year, time.month - 1, time.day, time.hour, time.minute, time.second) : null;
    } catch {
      return null;
    }
  };
  return { head: next(), next };
}

/**
 * The starts of a master's occurrences as wall times, ascending: DTSTART, every RRULE, RDATEs.
 * EXDATEs are still in. Ends after MAX_STEPS at the latest.
 */
function* startsOf(master: Component, t: Timing, ctx: Ctx, near?: number): Generator<number> {
  const sources = [listSource([t.start]), listSource(wallsOf(master, "rdate", t, ctx)), ...rulesOf(master).map((rule) => ruleSource(rule, t, near))];
  for (let steps = 0; steps < MAX_STEPS; ) {
    let min: number | null = null;
    for (const s of sources) if (s.head !== null && (min === null || s.head < min)) min = s.head;
    if (min === null) return;
    for (const s of sources) {
      if (s.head !== min) continue;
      s.head = s.next();
      steps++;
    }
    yield min;
  }
}

/** How an occurrence is named in a providerId: its original start. */
function ridOf(wall: number, t: Timing): string {
  if (t.allDay) return fmtDate(wall);
  // A floating series has no instants of its own; its wall time names the occurrence wherever the owner is.
  return t.zone.form === "floating" ? fmtTime(wall) : `${fmtTime(t.zone.toUtc(wall))}Z`;
}

/** A rid back to wall time on the master's clock. */
function ridToWall(rid: string, t: Timing): number | null {
  const v = parseWall(rid);
  if (!v) return null;
  if (t.allDay) return startOfDay(v.wall);
  if (v.date) return v.wall + (t.start - startOfDay(t.start));
  return v.utc ? t.zone.toWall(v.wall) : v.wall;
}

function overrideAt(obj: Loaded, t: Timing, wall: number): Component | null {
  return obj.overrides.find((o) => overrideWall(o, t, obj.ctx) === wall) ?? null;
}

// ---------------------------------------------------------------------------------------------
// Event fields

const textOf = (c: Component, name: string) => {
  const value = c.getFirstPropertyValue(name);
  return typeof value === "string" ? value : "";
};

/** Outlook's HTML description (X-ALT-DESC) as plain text, for events that have no other. */
function htmlToPlain(html: string) {
  return html
    .replace(/<(style|script|head)\b[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>|<\/(p|div|li|tr|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n) || 32))
    .replace(/&amp;/gi, "&")
    .replace(/[ \t]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function fullDescription(c: Component): string {
  const plain = textOf(c, "description").trim();
  if (plain) return plain;
  const html = textOf(c, "x-alt-desc");
  return html ? htmlToPlain(html.replace(/\\n/gi, "\n").replace(/\\([,;\\])/g, "$1")) : "";
}

const descriptionOf = (c: Component) => fullDescription(c).slice(0, MAX_DESCRIPTION);

/** An ORGANIZER or ATTENDEE line as a person; null when it names no email address (a room, a urn:uuid). */
function personOf(prop: Property): Person | null {
  const value = String(prop.getFirstValue() ?? "").trim();
  const param = String(prop.getFirstParameter("email") ?? "");
  const address = /^mailto:/i.test(value) ? value : param || (/^[^:\s]+@[^:\s]+$/.test(value) ? value : "");
  const email = address.replace(/^mailto:/i, "").trim().toLowerCase();
  return email ? { name: String(prop.getFirstParameter("cn") ?? "").trim(), email } : null;
}

const STATUSES: Record<string, AttendeeStatus> = { ACCEPTED: "accepted", TENTATIVE: "tentative", DECLINED: "declined" };

function attendeesOf(c: Component): EventAttendee[] {
  const out: EventAttendee[] = [];
  for (const prop of c.getAllProperties("attendee")) {
    const who = personOf(prop);
    if (who) out.push({ ...who, status: STATUSES[String(prop.getFirstParameter("partstat") ?? "").toUpperCase()] ?? "needsAction" });
  }
  return out;
}

const isCancelled = (c: Component) => textOf(c, "status").trim().toUpperCase() === "CANCELLED";

/** The master's rule as text ("FREQ=WEEKLY;BYDAY=TU"), the way ical.js writes it. */
const ruleText = (event: Component) => rulesOf(event)[0]?.toString() ?? null;

function toEvent(c: Component, t: Timing, startUtc: number, endUtc: number, rid: string | null, recurrence: string | null, opts: ExpandOptions): ProviderEvent {
  const me = (opts.me ?? []).map((m) => m.toLowerCase());
  const organizerProp = c.getFirstProperty("organizer");
  const organizer = organizerProp ? personOf(organizerProp) : null;
  const attendees = attendeesOf(c);
  const invited = !!organizer && !me.includes(organizer.email);
  const location = textOf(c, "location").trim();
  const description = fullDescription(c);
  return {
    providerId: rid ? `${opts.key}#${rid}` : opts.key,
    seriesId: rid ? opts.key : null,
    uid: textOf(c, "uid").trim() || null,
    etag: opts.etag ?? null,
    title: textOf(c, "summary").trim(),
    location,
    description: description.slice(0, MAX_DESCRIPTION),
    start: new Date(startUtc),
    end: new Date(endUtc),
    allDay: t.allDay,
    timeZone: !t.allDay && t.zone.form === "tzid" ? t.zone.iana : null,
    recurrence,
    organizer,
    attendees,
    myStatus: invited ? (attendees.find((a) => me.includes(a.email))?.status ?? null) : null,
    joinUrl: joinUrlFrom({
      teams: textOf(c, "x-microsoft-skypeteamsmeetingurl"),
      google: textOf(c, "x-google-conference"),
      conferences: c.getAllProperties("conference").map((p) => String(p.getFirstValue() ?? "")),
      location,
      url: textOf(c, "url"),
      description,
    }),
    url: null,
    canEdit: !(invited && me.length > 0),
  };
}

/** [start, end) of an event against [from, to); an event without length counts at its start. */
const overlaps = (start: number, end: number, from: number, to: number) => start < to && (end > from || (end === start && start >= from));

/** Every occurrence of the object that overlaps [from, to). Cancelled (STATUS:CANCELLED) and EXDATEd ones are left out;
 *  overrides replace their occurrence (also when the override moved it into or out of the window). */
export function expandObject(ics: string, from: Date, to: Date, opts: ExpandOptions): ProviderEvent[] {
  const obj = load(ics, opts.tz);
  const { master, overrides, ctx } = obj;
  const [fromMs, toMs] = [from.getTime(), to.getTime()];
  const out: ProviderEvent[] = [];
  const base = master ? timingOf(master, ctx) : null;
  const recurrence = master ? ruleText(master) : null;

  if (master && base && !isRecurring(master) && !overrides.length) {
    if (!isCancelled(master) && overlaps(base.startUtc, base.endUtc, fromMs, toMs)) out.push(toEvent(master, base, base.startUtc, base.endUtc, null, null, opts));
    return out;
  }

  if (master && base && !isCancelled(master)) {
    const skip = new Set(wallsOf(master, "exdate", base, ctx));
    for (const o of overrides) {
      const wall = overrideWall(o, base, ctx);
      if (wall !== null) skip.add(wall);
    }
    const instant = (wall: number) => (base.allDay ? wall : base.zone.toUtc(wall));
    const near = (base.allDay ? fromMs : base.zone.toWall(fromMs)) - base.span - DAY;
    for (const wall of startsOf(master, base, ctx, near)) {
      const startUtc = instant(wall);
      if (startUtc >= toMs) break;
      if (skip.has(wall)) continue;
      const endUtc = instant(wall + base.span);
      if (!overlaps(startUtc, endUtc, fromMs, toMs)) continue;
      out.push(toEvent(master, base, startUtc, endUtc, ridOf(wall, base), recurrence, opts));
      if (out.length >= MAX_OCCURRENCES) break;
    }
  }

  for (const o of overrides) {
    if (isCancelled(o)) continue;
    const t = timingOf(o, ctx, base?.zone);
    if (!overlaps(t.startUtc, t.endUtc, fromMs, toMs)) continue;
    const naming = base ?? t;
    const wall = overrideWall(o, naming, ctx);
    if (wall !== null) out.push(toEvent(o, t, t.startUtc, t.endUtc, ridOf(wall, naming), recurrence, opts));
  }
  return out.sort((a, b) => a.start.getTime() - b.start.getTime());
}

/** providerId ↔ its parts. Single event: providerId === key. Occurrence of a repeating event: `${key}#${rid}` where
 *  rid is the occurrence's ORIGINAL start (its RECURRENCE-ID): "YYYYMMDDTHHMMSSZ" in UTC, "YYYYMMDD" for all-day, or
 *  "YYYYMMDDTHHMMSS" (wall time) for a series written without any zone. */
export function splitProviderId(providerId: string): { key: string; rid: string | null } {
  const at = providerId.lastIndexOf("#");
  const rid = at >= 0 ? providerId.slice(at + 1) : "";
  return /^\d{8}(T\d{6}Z?)?$/.test(rid) ? { key: providerId.slice(0, at), rid } : { key: providerId, rid: null };
}

function boundsOf(obj: Loaded): { firstAt: Date | null; lastAt: Date | null } {
  const { master, overrides, ctx } = obj;
  let first = Infinity;
  let last = -Infinity;
  let endless = false;
  const base = master ? timingOf(master, ctx) : null;
  if (master && base) {
    first = base.startUtc;
    last = base.endUtc;
    const endOf = (wall: number) => (base.allDay ? wall + base.span : base.zone.toUtc(wall + base.span));
    const rules = rulesOf(master);
    if (rules.some((r) => !r.isFinite())) endless = true;
    else if (rules.some((r) => r.count)) {
      // COUNT says how many, not until when: walk them.
      let n = 0;
      for (const wall of startsOf(master, base, ctx)) {
        last = Math.max(last, endOf(wall));
        if (++n >= MAX_COUNTED) endless = true;
        if (endless) break;
      }
    } else {
      const ends = [...wallsOf(master, "rdate", base, ctx), ...rules.map((r) => untilWall(r, base) ?? base.start)];
      for (const wall of ends) last = Math.max(last, endOf(wall));
    }
  }
  for (const o of overrides) {
    const t = timingOf(o, ctx, base?.zone);
    first = Math.min(first, t.startUtc);
    last = Math.max(last, t.endUtc);
  }
  return { firstAt: Number.isFinite(first) ? new Date(first) : null, lastAt: endless || !Number.isFinite(last) ? null : new Date(last) };
}

/** firstAt / lastAt of one object (same meaning as in IcsObject). For a rule with UNTIL, lastAt may be a little
 *  after the last occurrence (UNTIL itself plus the event's length), never before it. */
export function objectBounds(ics: string, opts: { tz: string }): { firstAt: Date | null; lastAt: Date | null } {
  return boundsOf(load(ics, opts.tz));
}

// ---------------------------------------------------------------------------------------------
// Whole files

interface Pieces {
  /** A VCALENDAR was there at all. */
  found: boolean;
  /** The calendar's own property lines. */
  props: string[];
  zones: Map<string, string[]>;
  events: string[][];
}

const lineValue = (line: string) => line.slice(line.indexOf(":") + 1).trim();

/** The first line of a property among a component's own lines (not those of a VALARM inside it). */
function ownLine(block: string[], name: string): string | null {
  const re = new RegExp(`^${name}[;:]`, "i");
  let depth = 0;
  for (const line of block.slice(1, -1)) {
    if (/^BEGIN:/i.test(line)) depth++;
    else if (/^END:/i.test(line)) depth--;
    else if (depth === 0 && re.test(line)) return line;
  }
  return null;
}

/** A file cut into its VEVENT and VTIMEZONE blocks, line by line, so one broken event can't take the rest with it. */
function takeApart(text: string): Pieces {
  const pieces: Pieces = { found: false, props: [], zones: new Map(), events: [] };
  const stack: string[] = [];
  let block: string[] | null = null;
  for (const line of unfold(text)) {
    const begin = /^BEGIN:(.+)$/i.exec(line)?.[1].trim().toUpperCase();
    const end = /^END:(.+)$/i.exec(line)?.[1].trim().toUpperCase();
    if (begin) {
      stack.push(begin);
      if (begin === "VCALENDAR") pieces.found = true;
      else if (!block && stack.length === 2 && stack[0] === "VCALENDAR") block = [];
    }
    if (block) {
      if (line.length <= MAX_LINE) block.push(line);
    } else if (!begin && !end && stack.length === 1 && stack[0] === "VCALENDAR") pieces.props.push(line);
    if (!end) continue;
    const opened = stack.lastIndexOf(end);
    if (opened < 0) continue;
    stack.length = opened;
    if (!block || stack.length > 1) continue;
    if (opened === 1 && end === "VEVENT") pieces.events.push(block);
    else if (opened === 1 && end === "VTIMEZONE") {
      const tzid = ownLine(block, "TZID");
      if (tzid) pieces.zones.set(lineValue(tzid), block);
    }
    block = null;
  }
  return pieces;
}

const wrap = (lines: string[]) => ["BEGIN:VCALENDAR", "VERSION:2.0", ...lines, "END:VCALENDAR"].map(fold).join("\r\n") + "\r\n";

const parsed = new WeakMap<string[], boolean>();

/** Whether one block parses on its own. Remembered: a feed's zone block is asked about once per event. */
function parses(block: string[]) {
  let ok = parsed.get(block);
  if (ok === undefined) {
    try {
      parseStrict(wrap(block));
      ok = true;
    } catch {
      ok = false;
    }
    parsed.set(block, ok);
  }
  return ok;
}

/** The zone blocks a set of events refers to, in the file's words. */
function zonesFor(events: string[][], zones: Map<string, string[]>): string[][] {
  const used = new Set<string>();
  for (const block of events) {
    for (const line of block) for (const m of line.matchAll(/;TZID=(?:"([^"]+)"|([^;:]+))/gi)) used.add(m[1] ?? m[2]);
  }
  return [...used].flatMap((tzid) => {
    const zone = zones.get(tzid);
    return zone && parses(zone) ? [zone] : [];
  });
}

/** An object with a broken part: the same without the VEVENTs (and zones) that can't be parsed. Null when nothing is left. */
function salvage(ics: string): string | null {
  const pieces = takeApart(ics);
  const events = pieces.events.filter(parses);
  if (!events.length) return null;
  return wrap([...zonesFor(events, pieces.zones), ...events].flat());
}

function hexColor(value: string): string | null {
  const m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(value.trim());
  return m ? `#${m[1].toLowerCase()}` : null;
}

const unescapeText = (s: string) => s.replace(/\\n/gi, "\n").replace(/\\([,;\\])/g, "$1");

/** A whole .ics file (an import or a feed) taken apart: VEVENTs grouped by UID, each a standalone VCALENDAR
 *  (with the VTIMEZONEs it needs). VTODO/VJOURNAL/VFREEBUSY are ignored. A VEVENT without UID gets a stable
 *  generated one (hash of its content). Never throws on a broken event: skips it. Throws only when the text
 *  isn't iCalendar at all. `tz` is the IANA zone for times written without one. */
export function parseCalendar(text: string, opts: { tz: string }): ParsedCalendar {
  const pieces = takeApart(text);
  if (!pieces.found) throw new Error("Not an iCalendar file");
  const prop = (name: string) => {
    const line = pieces.props.find((l) => new RegExp(`^${name}[;:]`, "i").test(l));
    return line ? unescapeText(lineValue(line)) : "";
  };

  const groups = new Map<string, { master: string[] | null; overrides: string[][] }>();
  for (const block of pieces.events) {
    let uid = lineValue(ownLine(block, "UID") ?? "");
    if (!uid) {
      // The same event must get the same UID on the next read of a feed, whatever its timestamps say then.
      const stable = block.filter((l) => !/^(DTSTAMP|LAST-MODIFIED|CREATED|SEQUENCE)[;:]/i.test(l));
      uid = `kolbaba-${createHash("sha1").update(stable.join("\n")).digest("hex").slice(0, 32)}`;
      block.splice(1, 0, `UID:${uid}`);
    }
    const group = groups.get(uid) ?? { master: null, overrides: [] };
    // Two events without RECURRENCE-ID under one UID: the later one is the newer copy.
    if (ownLine(block, "RECURRENCE-ID")) group.overrides.push(block);
    else group.master = block;
    groups.set(uid, group);
  }

  const objects: IcsObject[] = [];
  const prodid = pieces.props.find((l) => /^PRODID[;:]/i.test(l));
  for (const [uid, group] of groups) {
    let events = [...(group.master ? [group.master] : []), ...group.overrides];
    const build = () => wrap([...(prodid ? [prodid] : []), ...zonesFor(events, pieces.zones), ...events].flat());
    try {
      let ics = build();
      let obj: Loaded;
      try {
        obj = load(ics, opts.tz);
        // load() drops what it can't place in time; keep the text in step with it.
        if (obj.vcal.getAllSubcomponents("vevent").length !== events.length) ics = serialize(obj.vcal);
      } catch {
        events = events.filter(parses);
        if (!events.length) continue;
        ics = build();
        obj = load(ics, opts.tz);
      }
      objects.push({ uid, ics, ...boundsOf(obj) });
    } catch {
      // Nothing readable under this UID.
    }
  }
  return { name: prop("X-WR-CALNAME").trim() || null, color: hexColor(prop("X-APPLE-CALENDAR-COLOR")) ?? hexColor(prop("COLOR")), objects };
}

// ---------------------------------------------------------------------------------------------
// Writing

function setProp(c: Component, prop: Property) {
  c.removeAllProperties(prop.name);
  c.addProperty(prop);
}

/** A DTSTART, DTEND, RECURRENCE-ID or EXDATE line in a zone's own form. */
function timeProp(name: string, wall: number, allDay: boolean, zone: Zone): Property {
  if (allDay) return ICAL.Property.fromString(`${name};VALUE=DATE:${fmtDate(wall)}`);
  const prop = ICAL.Property.fromString(`${name}:${fmtTime(wall)}${zone.form === "utc" ? "Z" : ""}`);
  if (zone.form === "tzid" && zone.tzid) prop.setParameter("tzid", zone.tzid);
  return prop;
}

const stampProp = (name: string, now: Date) => ICAL.Property.fromString(`${name}:${fmtTime(wholeSeconds(now))}Z`);

function writeTimes(c: Component, start: number, span: number, allDay: boolean, zone: Zone) {
  setProp(c, timeProp("DTSTART", start, allDay, zone));
  c.removeAllProperties("duration");
  setProp(c, timeProp("DTEND", start + span, allDay, zone));
}

/** DTSTAMP and LAST-MODIFIED are now, SEQUENCE goes up. */
function touch(c: Component, now: Date) {
  setProp(c, stampProp("DTSTAMP", now));
  setProp(c, stampProp("LAST-MODIFIED", now));
  c.updatePropertyWithValue("sequence", (Number(c.getFirstPropertyValue("sequence")) || 0) + 1);
}

/** The zone a draft's times are written in. `keep` is the event's present zone: kept when it is the same one under another name. */
function draftZone(draft: EventDraft, keep?: Zone): Zone {
  const iana = ianaZone(draft.timeZone);
  if (!iana || isUtcName(iana)) return UTC;
  if (keep && keep.form === "tzid" && keep.iana === iana) return keep;
  return { form: "tzid", tzid: iana, iana, ...ianaConversions(iana) };
}

function draftTimes(draft: EventDraft, keep?: Zone): { start: number; span: number; allDay: boolean; zone: Zone } {
  if (Number.isNaN(draft.start.getTime()) || Number.isNaN(draft.end.getTime())) throw new Error("The event has no valid time");
  if (draft.allDay) {
    const start = startOfDay(draft.start.getTime());
    return { start, span: Math.max(DAY, startOfDay(draft.end.getTime()) - start), allDay: true, zone: DATES };
  }
  const zone = draftZone(draft, keep);
  const start = zone.toWall(wholeSeconds(draft.start));
  return { start, span: Math.max(0, zone.toWall(wholeSeconds(draft.end)) - start), allDay: false, zone };
}

interface ClockChange {
  at: number;
  /** Offsets in minutes, before and after. */
  from: number;
  to: number;
}

/** When a zone's clocks change in a year, to the second. */
function clockChanges(iana: string, year: number): ClockChange[] {
  const out: ClockChange[] = [];
  let before = zoneOffset(Date.UTC(year, 0, 1), iana);
  for (let day = 1; day <= 366; day++) {
    const t = Date.UTC(year, 0, 1 + day);
    const after = zoneOffset(t, iana);
    if (after === before) continue;
    let [lo, hi] = [t - DAY, t];
    while (hi - lo > 1000) {
      const mid = Math.round((lo + hi) / 2000) * 1000;
      if (zoneOffset(mid, iana) === before) lo = mid;
      else hi = mid;
    }
    out.push({ at: hi, from: before, to: after });
    before = after;
  }
  return out;
}

const WEEKDAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

/** A clock change as a yearly rule: "the last Sunday of October", and the wall time it happens at. */
function changeRule(change: ClockChange) {
  const local = new Date(change.at + change.from * 60_000);
  const daysInMonth = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth() + 1, 0)).getUTCDate();
  const nth = local.getUTCDate() + 7 > daysInMonth ? -1 : Math.ceil(local.getUTCDate() / 7);
  return { wall: local.getTime(), rule: `FREQ=YEARLY;BYMONTH=${local.getUTCMonth() + 1};BYDAY=${nth}${WEEKDAYS[local.getUTCDay()]}`, time: local.getTime() % DAY };
}

const offsetText = (minutes: number) => `${minutes < 0 ? "-" : "+"}${pad(Math.floor(Math.abs(minutes) / 60))}${pad(Math.abs(minutes) % 60)}`;

const madeZones = new Map<string, string | null>();

/**
 * A VTIMEZONE for an IANA zone, read off what Intl says its clocks do around `year`. Calendar apps
 * that don't know IANA names (Outlook) need it to place the event. Null when the zone's changes
 * don't follow a yearly "nth weekday of a month" rule: then the TZID alone has to do.
 */
function vtimezoneText(tzid: string, iana: string, year: number): string | null {
  const key = `${tzid}|${iana}|${year}`;
  const made = madeZones.get(key);
  if (made !== undefined) return made;
  // Start a year early, so both halves of the year are described before the event begins.
  const base = clockChanges(iana, year - 1);
  const later = [clockChanges(iana, year), clockChanges(iana, year + 1)];
  const lines = ["BEGIN:VTIMEZONE", `TZID:${tzid}`];
  let ok = later.every((changes) => changes.length === base.length);
  if (ok && !base.length) {
    const offset = offsetText(zoneOffset(Date.UTC(year, 0, 1), iana));
    lines.push("BEGIN:STANDARD", "DTSTART:19700101T000000", `TZOFFSETFROM:${offset}`, `TZOFFSETTO:${offset}`, "END:STANDARD");
  } else if (ok && base.length === 2) {
    for (const change of base) {
      const { wall, rule, time } = changeRule(change);
      // It is a rule only when the next years follow it too.
      ok &&= later.every((changes) => {
        const same = changes.find((c) => c.to === change.to && c.from === change.from);
        return !!same && changeRule(same).rule === rule && changeRule(same).time === time;
      });
      const kind = change.to > change.from ? "DAYLIGHT" : "STANDARD";
      lines.push(`BEGIN:${kind}`, `DTSTART:${fmtTime(wall)}`, `TZOFFSETFROM:${offsetText(change.from)}`, `TZOFFSETTO:${offsetText(change.to)}`, `RRULE:${rule}`, `END:${kind}`);
    }
  } else ok = false;
  lines.push("END:VTIMEZONE");
  const result = ok ? lines.join("\r\n") : null;
  if (madeZones.size > 500) madeZones.clear();
  madeZones.set(key, result);
  return result;
}

/** Adds the VTIMEZONE for a zone the calendar uses but doesn't describe yet. */
function ensureZone(vcal: Component, zone: Zone, wall: number) {
  if (zone.form !== "tzid" || !zone.tzid || !zone.iana) return;
  if (vcal.getAllSubcomponents("vtimezone").some((z) => z.getFirstPropertyValue("tzid") === zone.tzid)) return;
  const text = vtimezoneText(zone.tzid, zone.iana, new Date(wall).getUTCFullYear());
  if (text) vcal.addSubcomponent(ICAL.Component.fromString(text));
}

/** An RRULE line from a draft's rule. UNTIL is put the way the standard wants it: a date for all-day events, UTC otherwise. */
function ruleProp(text: string, allDay: boolean, zone: Zone): Property {
  const rule = ICAL.Recur.fromString(text.trim().replace(/^RRULE:/i, ""));
  const until = rule.until ? parseWall(rule.until.toString()) : null;
  if (until && allDay) rule.until = icalTime(startOfDay(until.wall), true);
  else if (until && !until.utc && zone.form !== "floating") rule.until = icalTime(zone.toUtc(until.date ? until.wall + DAY - 1000 : until.wall), false, true);
  const prop = new ICAL.Property("rrule");
  prop.setValue(rule);
  return prop;
}

function setText(c: Component, name: string, value: string) {
  if (value.trim()) c.updatePropertyWithValue(name, value.trim());
  else c.removeAllProperties(name);
}

const cleanName = (name: string) => name.trim().replace(/"/g, "'");

function attendeeProp(person: Person, opts: BuildOptions): Property {
  const email = person.email.trim().toLowerCase();
  const organizes = email === opts.organizer?.email.trim().toLowerCase();
  const prop = new ICAL.Property("attendee");
  if (cleanName(person.name)) prop.setParameter("cn", cleanName(person.name));
  prop.setParameter("role", "REQ-PARTICIPANT");
  prop.setParameter("partstat", organizes ? "ACCEPTED" : "NEEDS-ACTION");
  if (!organizes) prop.setParameter("rsvp", "TRUE");
  if (opts.clientSchedules) prop.setParameter("schedule-agent", "CLIENT");
  prop.setValue(`mailto:${email}`);
  return prop;
}

/** Title, place, description and guests of a draft, onto a VEVENT. Guests who stay keep their line (and their answer). */
function applyDetails(c: Component, draft: EventDraft, opts: BuildOptions) {
  setText(c, "summary", draft.title);
  setText(c, "location", draft.location);
  // The description may have come from HTML or been cut short for listing: only a real change replaces it.
  if (draft.description.trim() !== descriptionOf(c)) {
    setText(c, "description", draft.description);
    c.removeAllProperties("x-alt-desc");
  }
  const wanted = new Map(draft.attendees.filter((a) => a.email.trim()).map((a) => [a.email.trim().toLowerCase(), a]));
  const have = new Set<string>();
  for (const prop of c.getAllProperties("attendee")) {
    const who = personOf(prop);
    if (!who) continue;
    if (!wanted.has(who.email) || have.has(who.email)) c.removeProperty(prop);
    else have.add(who.email);
  }
  for (const [email, person] of wanted) if (!have.has(email)) c.addProperty(attendeeProp(person, opts));
  if (!wanted.size) c.removeAllProperties("organizer");
  else if (!c.hasProperty("organizer") && opts.organizer?.email.trim()) {
    const prop = new ICAL.Property("organizer");
    if (cleanName(opts.organizer.name)) prop.setParameter("cn", cleanName(opts.organizer.name));
    prop.setValue(`mailto:${opts.organizer.email.trim().toLowerCase()}`);
    c.addProperty(prop);
  }
}

/** A new VCALENDAR with one VEVENT from the draft (PRODID "-//Kolbaba//Calendar//EN"). Timed events are written with
 *  TZID=draft.timeZone and a matching wall time (so a repeating event keeps its hour across clock changes), with the
 *  zone's VTIMEZONE when its clock changes follow a plain yearly rule; all-day ones as VALUE=DATE. Returns { uid, ics }. */
export function buildObject(draft: EventDraft, opts: BuildOptions = {}): { uid: string; ics: string } {
  const uid = opts.uid?.trim() || randomUUID();
  const now = opts.now ?? new Date();
  const vcal = new ICAL.Component("vcalendar");
  vcal.addPropertyWithValue("version", "2.0");
  vcal.addPropertyWithValue("prodid", PRODID);
  vcal.addPropertyWithValue("calscale", "GREGORIAN");
  const event = new ICAL.Component("vevent");
  event.addPropertyWithValue("uid", uid);
  for (const name of ["DTSTAMP", "CREATED", "LAST-MODIFIED"]) event.addProperty(stampProp(name, now));
  event.addPropertyWithValue("sequence", 0);
  const when = draftTimes(draft);
  writeTimes(event, when.start, when.span, when.allDay, when.zone);
  ensureZone(vcal, when.zone, when.start);
  if (draft.recurrence?.trim()) event.addProperty(ruleProp(draft.recurrence, when.allDay, when.zone));
  applyDetails(event, draft, opts);
  vcal.addSubcomponent(event);
  return { uid, ics: serialize(vcal) };
}

const cloneOf = (c: Component) => new ICAL.Component(JSON.parse(JSON.stringify(c.toJSON())) as unknown[]);

/** One occurrence of a series as its own VEVENT: the master's copy with RECURRENCE-ID and no rule. */
function occurrenceOf(master: Component, t: Timing, wall: number): Component {
  const c = cloneOf(master);
  for (const name of ["rrule", "rdate", "exdate", "exrule"]) c.removeAllProperties(name);
  writeTimes(c, wall, t.span, t.allDay, t.zone);
  c.addProperty(timeProp("RECURRENCE-ID", wall, t.allDay, t.zone));
  return c;
}

/** The object with the draft applied. Unknown properties (alarms, X-…, categories) are kept. SEQUENCE goes up,
 *  DTSTAMP/LAST-MODIFIED are set.
 *  - single event, or scope "all": the master gets the draft's text fields, attendees, rule and times. For a repeating
 *    event `draft.start/end` are the edited OCCURRENCE's new times: the master's DTSTART shifts by the same amount the
 *    occurrence moved (new start − that occurrence's current start, on the wall clock) and the duration is the draft's.
 *    When the time of day, the date or the rule changed, overrides and EXDATEs go (they no longer line up); when only
 *    text fields or the length changed, they stay and the change goes to the master only. A weekly rule left as it was
 *    moves its days of the week along with the series, and an UNTIL moves with it.
 *  - scope "this" on a repeating event: adds or replaces the override VEVENT with RECURRENCE-ID = rid, carrying the
 *    draft's fields and no RRULE.
 *  `rid` is the occurrence's rid from splitProviderId (null for a single event). */
export function updateObject(ics: string, draft: EventDraft, scope: Scope, rid: string | null, opts: BuildOptions = {}): string {
  const now = opts.now ?? new Date();
  const obj = load(ics, draft.timeZone);
  const { vcal, master, overrides, ctx } = obj;
  const base = master ?? overrides[0];
  const t = timingOf(base, ctx);
  const at = rid ? ridToWall(rid, t) : null;
  const own = at !== null ? overrideAt(obj, t, at) : null;

  if (!master || (isRecurring(master) && scope === "this" && at !== null)) {
    let target = own ?? (master ? null : base);
    if (!target && master && at !== null) target = vcal.addSubcomponent(occurrenceOf(master, t, at));
    if (!target) throw new Error("No such occurrence");
    const when = draftTimes(draft, timingOf(target, ctx, t.zone).zone);
    applyDetails(target, draft, opts);
    writeTimes(target, when.start, when.span, when.allDay, when.zone);
    ensureZone(vcal, when.zone, when.start);
    touch(target, now);
    return serialize(vcal);
  }

  applyDetails(master, draft, opts);
  const when = draftTimes(draft, t.zone);
  const rule = draft.recurrence?.trim() ? ruleProp(draft.recurrence, when.allDay, when.zone) : null;
  const dropSeries = () => {
    master.removeAllProperties("exdate");
    for (const o of overrides) vcal.removeSubcomponent(o);
  };

  if (!isRecurring(master) || !rule) {
    // A single event, before or from now on: the draft's times are its times.
    if (isRecurring(master)) {
      for (const name of ["rrule", "rdate", "exrule"]) master.removeAllProperties(name);
      dropSeries();
    }
    writeTimes(master, when.start, when.span, when.allDay, when.zone);
    ensureZone(vcal, when.zone, when.start);
    if (rule) master.addProperty(rule);
    touch(master, now);
    return serialize(vcal);
  }

  // The edited occurrence as it is now, and the series' start, on the clock the draft is written in.
  const onClock = (utc: number) => (when.allDay ? (t.allDay ? utc : startOfDay(t.zone.toWall(utc))) : t.allDay ? utc : when.zone.toWall(utc));
  const current = own ? timingOf(own, ctx, t.zone).startUtc : at !== null ? (t.allDay ? at : t.zone.toUtc(at)) : t.startUtc;
  const delta = when.start - onClock(current);
  const moved = delta !== 0 || when.allDay !== t.allDay;
  const sameRule = String(rule.getFirstValue()) === ruleText(master);
  const start = onClock(t.startUtc) + delta;

  if (moved) {
    if (sameRule) {
      const days = Math.round((startOfDay(start) - startOfDay(onClock(t.startUtc))) / DAY);
      for (const prop of master.getAllProperties("rrule")) {
        const value = prop.getFirstValue();
        if (!(value instanceof ICAL.Recur)) continue;
        // The series ends on the same occurrence as before, wherever that one moved to.
        const until = untilWall(value, t);
        if (until !== null) {
          const end = startOfDay(onClock(t.allDay ? until : t.zone.toUtc(until)) + delta) + DAY - 1000;
          value.until = when.allDay ? icalTime(end, true) : icalTime(when.zone.toUtc(end), false, true);
        }
        const byDay = value.getComponent("BYDAY").map(String);
        if (value.freq === "WEEKLY" && byDay.length && days % 7 !== 0) {
          value.setComponent("BYDAY", byDay.map((day) => WEEKDAYS[(((WEEKDAYS.indexOf(day.slice(-2)) + days) % 7) + 7) % 7]));
        }
        prop.setValue(value);
      }
    }
    writeTimes(master, start, when.span, when.allDay, when.zone);
    ensureZone(vcal, when.zone, start);
  } else if (when.span !== t.span) writeTimes(master, t.start, when.span, t.allDay, t.zone);
  if (!sameRule) {
    master.removeAllProperties("rrule");
    master.addProperty(rule);
  }
  if (moved || !sameRule) dropSeries();
  touch(master, now);
  return serialize(vcal);
}

/** The object without that one occurrence (EXDATE added in the master's own form, an override for it dropped). */
export function removeOccurrence(ics: string, rid: string, opts: { now?: Date } = {}): string {
  const obj = load(ics, "UTC");
  const { vcal, master, overrides, ctx } = obj;
  const t = timingOf(master ?? overrides[0], ctx);
  const at = ridToWall(rid, t);
  if (at === null) return ics;
  const own = overrideAt(obj, t, at);
  if (own) vcal.removeSubcomponent(own);
  if (master) {
    master.addProperty(timeProp("EXDATE", at, t.allDay, t.zone));
    touch(master, opts.now ?? new Date());
  }
  return serialize(vcal);
}

/** The iTIP message to email to guests (RFC 5546): METHOD:REQUEST or METHOD:CANCEL (CANCEL sets STATUS:CANCELLED and
 *  bumps SEQUENCE), SCHEDULE-AGENT parameters and VALARMs stripped, attendees get RSVP=TRUE on REQUEST. With `rid`,
 *  only that occurrence (its override, or the master narrowed to it with RECURRENCE-ID). */
export function itipMessage(ics: string, method: "REQUEST" | "CANCEL", opts: { rid?: string | null; now?: Date } = {}): string {
  const now = opts.now ?? new Date();
  const obj = load(ics, "UTC");
  const { vcal, master, overrides, ctx } = obj;
  const base = master ?? overrides[0];
  const t = timingOf(base, ctx);

  let events: Component[];
  if (opts.rid) {
    const at = ridToWall(opts.rid, t);
    const own = at !== null ? overrideAt(obj, t, at) : null;
    events = [own ? cloneOf(own) : master && at !== null && isRecurring(master) ? occurrenceOf(master, t, at) : cloneOf(base)];
  } else if (method === "CANCEL" && master) events = [cloneOf(master)];
  else events = [...(master ? [master] : []), ...overrides].map(cloneOf);

  const out = new ICAL.Component("vcalendar");
  out.addPropertyWithValue("version", "2.0");
  out.addPropertyWithValue("prodid", PRODID);
  out.addPropertyWithValue("calscale", "GREGORIAN");
  out.addPropertyWithValue("method", method);
  for (const zone of vcal.getAllSubcomponents("vtimezone")) out.addSubcomponent(cloneOf(zone));

  const organizer = base.getFirstProperty("organizer");
  const inviter = organizer ? personOf(organizer)?.email : undefined;
  for (const event of events) {
    event.removeAllSubcomponents("valarm");
    for (const prop of [...event.getAllProperties("attendee"), ...event.getAllProperties("organizer")]) {
      for (const param of ["schedule-agent", "schedule-status", "schedule-force-send"]) prop.removeParameter(param);
    }
    setProp(event, stampProp("DTSTAMP", now));
    const sequence = Number(event.getFirstPropertyValue("sequence")) || 0;
    if (method === "REQUEST") {
      for (const prop of event.getAllProperties("attendee")) if (personOf(prop)?.email !== inviter) prop.setParameter("rsvp", "TRUE");
      event.updatePropertyWithValue("sequence", sequence);
    } else {
      event.updatePropertyWithValue("status", "CANCELLED");
      event.updatePropertyWithValue("sequence", sequence + 1);
    }
    const when = timingOf(event, ctx, t.zone);
    ensureZone(out, when.zone, when.start);
    out.addSubcomponent(event);
  }
  return serialize(out);
}

/** Answer an invitation inside the object: the owner's ATTENDEE line gets PARTSTAT (scope "this": in the override for rid,
 *  created when missing). Returns the object unchanged when none of `me` is an attendee. */
export function setPartstat(ics: string, me: string[], status: "ACCEPTED" | "TENTATIVE" | "DECLINED", scope: Scope, rid: string | null): string {
  const obj = load(ics, "UTC");
  const { vcal, master, overrides, ctx } = obj;
  const mine = me.map((m) => m.trim().toLowerCase());
  const lines = (c: Component) => c.getAllProperties("attendee").filter((p) => mine.includes(personOf(p)?.email ?? ""));

  let targets = [...(master ? [master] : []), ...overrides];
  if (scope === "this" && rid && (!master || isRecurring(master))) {
    const t = timingOf(master ?? overrides[0], ctx);
    const at = ridToWall(rid, t);
    let own = at !== null ? overrideAt(obj, t, at) : null;
    if (!own && master && at !== null && lines(master).length) own = vcal.addSubcomponent(occurrenceOf(master, t, at));
    targets = own ? [own] : [];
  }
  let changed = false;
  for (const target of targets) {
    for (const prop of lines(target)) {
      prop.setParameter("partstat", status);
      changed = true;
    }
  }
  return changed ? serialize(vcal) : ics;
}

/**
 * The iTIP REPLY that tells an organizer the owner's answer (RFC 5546): the event (or, with `rid`, that one
 * occurrence) with only the answering guest left on it. Null when there is nobody to tell: no organizer with an
 * address, the owner is the organizer, or none of `me` is invited. `serverReplies` says the calendar server
 * sends answers itself for this event (it marks the organizer with SCHEDULE-STATUS when it does, RFC 6638).
 */
export function itipReply(
  ics: string,
  me: string[],
  status: "ACCEPTED" | "TENTATIVE" | "DECLINED",
  opts: { rid?: string | null; now?: Date } = {},
): { content: string; organizer: Person; attendee: string; serverReplies: boolean } | null {
  const now = opts.now ?? new Date();
  const obj = load(ics, "UTC");
  const { vcal, master, overrides, ctx } = obj;
  const base = master ?? overrides[0];
  if (!base) return null;
  const t = timingOf(base, ctx);
  const mine = me.map((m) => m.trim().toLowerCase());

  let event = cloneOf(base);
  if (opts.rid) {
    const at = ridToWall(opts.rid, t);
    const own = at !== null ? overrideAt(obj, t, at) : null;
    if (own) event = cloneOf(own);
    else if (master && at !== null && isRecurring(master)) event = occurrenceOf(master, t, at);
  }

  const organizerProp = event.getFirstProperty("organizer") ?? base.getFirstProperty("organizer");
  const organizer = organizerProp ? personOf(organizerProp) : null;
  const own = event.getAllProperties("attendee").find((p) => mine.includes(personOf(p)?.email ?? ""));
  const attendee = own ? personOf(own)?.email : undefined;
  if (!organizerProp || !organizer || !own || !attendee || mine.includes(organizer.email)) return null;
  const agent = String(organizerProp.getFirstParameter("schedule-agent") ?? "").toUpperCase();
  const serverReplies = !!organizerProp.getFirstParameter("schedule-status") && agent !== "CLIENT" && agent !== "NONE";

  for (const prop of event.getAllProperties("attendee")) if (prop !== own) event.removeProperty(prop);
  if (!event.getFirstProperty("organizer")) event.addProperty(new ICAL.Property(organizerProp.toJSON() as unknown[]));
  own.setParameter("partstat", status);
  own.removeParameter("rsvp");
  for (const prop of [own, ...event.getAllProperties("organizer")]) {
    for (const param of ["schedule-agent", "schedule-status", "schedule-force-send"]) prop.removeParameter(param);
  }
  event.removeAllSubcomponents("valarm");
  // The organizer has the event; what they need back is who answers what, for which occurrence.
  for (const name of ["description", "x-alt-desc", "attach"]) event.removeAllProperties(name);
  setProp(event, stampProp("DTSTAMP", now));

  const out = new ICAL.Component("vcalendar");
  out.addPropertyWithValue("version", "2.0");
  out.addPropertyWithValue("prodid", PRODID);
  out.addPropertyWithValue("calscale", "GREGORIAN");
  out.addPropertyWithValue("method", "REPLY");
  for (const zone of vcal.getAllSubcomponents("vtimezone")) out.addSubcomponent(cloneOf(zone));
  const when = timingOf(event, ctx, t.zone);
  ensureZone(out, when.zone, when.start);
  out.addSubcomponent(event);
  return { content: serialize(out), organizer, attendee, serverReplies };
}
