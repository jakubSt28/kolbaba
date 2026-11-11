import { createHash } from "node:crypto";
import type { AttendeeStatus, EventAttendee } from "@/lib/calendar/types";
import { env } from "../env";
import { joinUrlFrom, WINDOWS_ZONES } from "../mail/ics";
import { microsoftClaims, microsoftRedirectUri, microsoftToken, refreshMicrosoftToken } from "../microsoft";
import { createApi, DAY_MS, fromWall, isoDate, MAX_DESCRIPTION, mergeGuests, plainText, sameSpan, shiftSeries, toWall, type CalendarGrant, type ProviderDeps, type ProviderOptions, type Span } from "./oauth";
import { CalendarAuthError, type CalendarProvider, type ProviderCalendar, type ProviderEvent } from "./types";

/**
 * Outlook and Microsoft 365 calendars: connecting an account (its own grant: a mailbox's token is for
 * IMAP and SMTP, calendars live in Microsoft Graph) and the provider that reads and changes its events.
 */

export const GRAPH_CALENDAR_SCOPE = "https://graph.microsoft.com/Calendars.ReadWrite";

const AUTHORIZE = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize";
const SIGN_IN_SCOPES = ["openid", "email", "profile", "offline_access", GRAPH_CALENDAR_SCOPE];

export function microsoftCalendarAuthUrl({ state, codeVerifier, loginHint }: { state: string; codeVerifier: string; loginHint?: string }): URL {
  const url = new URL(AUTHORIZE);
  url.searchParams.set("client_id", env.microsoftClientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("response_mode", "query");
  url.searchParams.set("redirect_uri", microsoftRedirectUri());
  url.searchParams.set("scope", SIGN_IN_SCOPES.join(" "));
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", createHash("sha256").update(codeVerifier).digest("base64url"));
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("prompt", "select_account");
  if (loginHint) url.searchParams.set("login_hint", loginHint);
  return url;
}

export async function exchangeMicrosoftCalendarCode(code: string, codeVerifier: string): Promise<CalendarGrant> {
  const res = await microsoftToken({
    grant_type: "authorization_code",
    code,
    redirect_uri: microsoftRedirectUri(),
    code_verifier: codeVerifier,
    scope: SIGN_IN_SCOPES.join(" "),
  });
  if (!res.refresh_token) throw new Error("Microsoft returned no refresh token (offline_access missing?)");
  const scope = res.scope ?? "";
  if (!scope.split(" ").some((s) => /(^|\/)Calendars\.ReadWrite$/i.test(s))) {
    throw new CalendarAuthError("scope_denied: calendar access wasn't allowed on Microsoft's page");
  }
  const claims = microsoftClaims(res.id_token);
  const email = (claims.email ?? claims.preferred_username ?? "").toLowerCase();
  if (!email.includes("@")) throw new Error("Microsoft id_token has no email address");
  return { refreshToken: res.refresh_token, accessToken: res.access_token, expiresAt: Date.now() + res.expires_in * 1000, scope, email };
}

/* ------------------------------ What Graph sends ------------------------------ */

interface GraphTime {
  dateTime?: string;
  timeZone?: string;
}

interface GraphAddress {
  name?: string;
  address?: string;
}

interface GraphAttendee {
  type?: string;
  emailAddress?: GraphAddress;
  status?: { response?: string };
}

interface GraphPattern {
  type?: string;
  interval?: number;
  daysOfWeek?: string[];
  dayOfMonth?: number;
  month?: number;
  index?: string;
  firstDayOfWeek?: string;
}

interface GraphRange {
  type?: string;
  startDate?: string;
  endDate?: string;
  numberOfOccurrences?: number;
  recurrenceTimeZone?: string;
}

/** How a series repeats, the way Graph says it: what repeats (pattern) and for how long (range). */
export interface GraphRecurrence {
  pattern?: GraphPattern;
  range?: GraphRange;
}

interface GraphEvent {
  id: string;
  "@odata.etag"?: string;
  iCalUId?: string;
  seriesMasterId?: string | null;
  subject?: string;
  body?: { contentType?: string; content?: string };
  location?: { displayName?: string };
  start?: GraphTime;
  end?: GraphTime;
  isAllDay?: boolean;
  isCancelled?: boolean;
  isOrganizer?: boolean;
  originalStartTimeZone?: string;
  organizer?: { emailAddress?: GraphAddress };
  attendees?: GraphAttendee[];
  responseStatus?: { response?: string };
  onlineMeeting?: { joinUrl?: string } | null;
  onlineMeetingUrl?: string | null;
  webLink?: string;
  recurrence?: GraphRecurrence | null;
}

interface GraphCalendar {
  id: string;
  name?: string;
  hexColor?: string;
  canEdit?: boolean;
  isDefaultCalendar?: boolean;
}

interface GraphPage<T> {
  value?: T[];
  "@odata.nextLink"?: string;
}

const BASE = "https://graph.microsoft.com/v1.0";
const MAX_PAGES = 100;
/** How many requests Graph takes in one batch. */
const BATCH_SIZE = 20;
/** Times in UTC whatever zone the event was made in, and the description as text instead of Outlook's HTML. */
const PREFER = { prefer: 'outlook.timezone="UTC", outlook.body-content-type="text"' };

/** Whoever called the meeting is coming to it; "none" and "notResponded" are no answer yet. */
const RESPONSES: Record<string, AttendeeStatus> = { accepted: "accepted", organizer: "accepted", tentativelyAccepted: "tentative", declined: "declined" };
const status = (response: string | undefined): AttendeeStatus => RESPONSES[response ?? ""] ?? "needsAction";

/** The IANA name of a zone Graph names, which is a Windows name for most events made in Outlook. Null when unknown. */
function ianaZone(name: string | undefined): string | null {
  if (!name) return null;
  if (WINDOWS_ZONES[name]) return WINDOWS_ZONES[name];
  if (/^tzone:\/\/Microsoft\/Utc$/i.test(name)) return "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: name });
    return name;
  } catch {
    return null;
  }
}

/** Graph writes times without a zone ("2026-11-12T09:00:00.0000000") and names the zone next to them. */
function instant(time: GraphTime | undefined): number | null {
  const wall = Date.parse(`${(time?.dateTime ?? "").slice(0, 19)}Z`);
  if (Number.isNaN(wall)) return null;
  const zone = ianaZone(time?.timeZone);
  return zone && zone !== "UTC" ? fromWall(wall, zone) : wall;
}

function spanOf(event: GraphEvent): Span | null {
  const start = instant(event.start);
  const end = instant(event.end);
  if (start === null) return null;
  if (!event.isAllDay) return { start: new Date(start), end: new Date(end ?? start), allDay: false };
  // An all-day event is midnight to midnight. Should Graph ever give those midnights in the zone the
  // event was made in, the nearest UTC midnight is still the right day.
  const day = (ms: number) => Math.round(ms / DAY_MS) * DAY_MS;
  return { start: new Date(day(start)), end: new Date(day(end ?? start + DAY_MS)), allDay: true };
}

/** The text we asked for; should Graph send HTML all the same, the text of that. */
function description(event: GraphEvent) {
  const content = event.body?.content ?? "";
  if (event.body?.contentType === "html") return plainText(content);
  return content.replace(/\r\n?/g, "\n").trim().slice(0, MAX_DESCRIPTION);
}

function toEvent(event: GraphEvent, rules: Map<string, string>): ProviderEvent | null {
  if (event.isCancelled) return null;
  const span = spanOf(event);
  if (!span) return null;
  const organizer = event.organizer?.emailAddress;
  const attendees: EventAttendee[] = (event.attendees ?? [])
    .filter((a) => a.type !== "resource" && a.emailAddress?.address)
    .map((a) => ({ name: a.emailAddress?.name ?? "", email: a.emailAddress?.address ?? "", status: status(a.status?.response) }));
  const location = event.location?.displayName ?? "";
  return {
    providerId: event.id,
    seriesId: event.seriesMasterId ?? null,
    uid: event.iCalUId ?? null,
    etag: event["@odata.etag"] ?? null,
    title: event.subject ?? "",
    location,
    description: description(event),
    ...span,
    timeZone: ianaZone(event.originalStartTimeZone),
    recurrence: event.seriesMasterId ? (rules.get(event.seriesMasterId) ?? null) : null,
    organizer: organizer?.address ? { name: organizer.name ?? "", email: organizer.address } : null,
    attendees,
    myStatus: event.isOrganizer ? null : status(event.responseStatus?.response),
    joinUrl: joinUrlFrom({ teams: event.onlineMeeting?.joinUrl, conferences: event.onlineMeetingUrl ? [event.onlineMeetingUrl] : [], location, description: event.body?.content ?? "" }),
    url: event.webLink ?? null,
    canEdit: event.isOrganizer !== false,
  };
}

/* ------------------------------- Repeating events ------------------------------- */

const DAY_CODES: Record<string, string> = { sunday: "SU", monday: "MO", tuesday: "TU", wednesday: "WE", thursday: "TH", friday: "FR", saturday: "SA" };
const DAY_NAMES = Object.fromEntries(Object.entries(DAY_CODES).map(([name, code]) => [code, name]));
const WEEK = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
/** "The second Tuesday": Graph's word for the position and iCalendar's number. */
const POSITIONS: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4, last: -1 };

/** Graph's pattern and range as an iCalendar rule ("FREQ=WEEKLY;BYDAY=TU"); null when Graph sent something else. */
export function recurrenceToRrule(recurrence: GraphRecurrence | null | undefined): string | null {
  const pattern = recurrence?.pattern;
  if (!pattern?.type) return null;
  const days = (pattern.daysOfWeek ?? []).map((d) => DAY_CODES[d.toLowerCase()]).filter(Boolean);
  const { dayOfMonth, month } = pattern;
  // One day takes its position in front ("2TU"); several ("the last weekday") need BYSETPOS.
  const nth = () => {
    const position = POSITIONS[pattern.index ?? "first"] ?? 1;
    return days.length === 1 ? [`BYDAY=${position}${days[0]}`] : [`BYDAY=${days.join(",")}`, `BYSETPOS=${position}`];
  };
  let parts: string[];
  switch (pattern.type) {
    case "daily":
      parts = ["FREQ=DAILY"];
      break;
    case "weekly":
      parts = ["FREQ=WEEKLY", ...(days.length > 0 ? [`BYDAY=${days.join(",")}`] : [])];
      break;
    case "absoluteMonthly":
      if (!dayOfMonth) return null;
      parts = ["FREQ=MONTHLY", `BYMONTHDAY=${dayOfMonth}`];
      break;
    case "relativeMonthly":
      if (days.length === 0) return null;
      parts = ["FREQ=MONTHLY", ...nth()];
      break;
    case "absoluteYearly":
      if (!dayOfMonth || !month) return null;
      parts = ["FREQ=YEARLY", `BYMONTH=${month}`, `BYMONTHDAY=${dayOfMonth}`];
      break;
    case "relativeYearly":
      if (days.length === 0 || !month) return null;
      parts = ["FREQ=YEARLY", `BYMONTH=${month}`, ...nth()];
      break;
    default:
      return null;
  }
  if ((pattern.interval ?? 1) > 1) parts.splice(1, 0, `INTERVAL=${pattern.interval}`);
  const range = recurrence?.range;
  if (range?.type === "endDate" && range.endDate) parts.push(`UNTIL=${range.endDate.replace(/-/g, "")}`);
  if (range?.type === "numbered" && range.numberOfOccurrences) parts.push(`COUNT=${range.numberOfOccurrences}`);
  return parts.join(";");
}

const RULE_PARTS = new Set(["FREQ", "INTERVAL", "BYDAY", "BYMONTHDAY", "BYMONTH", "BYSETPOS", "WKST", "COUNT", "UNTIL"]);

/**
 * An iCalendar rule as Graph's pattern and range, for a series whose first event is on `startDate`
 * ("2026-11-12", on the clocks of `timeZone`). Graph knows fewer ways to repeat than iCalendar does:
 * what it can't say throws "unsupported recurrence".
 */
export function rruleToRecurrence(rule: string, startDate: string, timeZone: string): GraphRecurrence {
  const unsupported = () => new Error("unsupported recurrence");
  const parts = new Map<string, string>();
  for (const part of rule.replace(/^RRULE:/i, "").split(";").filter(Boolean)) {
    const split = part.indexOf("=");
    const name = part.slice(0, split).toUpperCase();
    if (split < 1 || !RULE_PARTS.has(name) || parts.has(name)) throw unsupported();
    parts.set(name, part.slice(split + 1).toUpperCase());
  }
  /** One whole number between `min` and `max`, or `fallback` when the rule doesn't have the part. */
  const number = (name: string, min: number, max: number, fallback: number) => {
    const raw = parts.get(name);
    if (raw === undefined) return fallback;
    const value = Number(raw);
    if (!/^[+-]?\d+$/.test(raw) || value < min || value > max) throw unsupported();
    return value;
  };
  const without = (...names: string[]) => {
    if (names.some((name) => parts.has(name))) throw unsupported();
  };
  const days = (parts.get("BYDAY")?.split(",") ?? []).map((day) => {
    const match = /^([+-]?\d+)?(SU|MO|TU|WE|TH|FR|SA)$/.exec(day);
    if (!match) throw unsupported();
    return { position: match[1] ? Number(match[1]) : null, name: DAY_NAMES[match[2]] };
  });
  const start = new Date(`${startDate}T00:00:00Z`);
  if (Number.isNaN(start.getTime())) throw unsupported();
  const interval = number("INTERVAL", 1, 999, 1);

  /** "The second Tuesday" (BYDAY=2TU) or "the last weekday" (BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1). */
  const nth = () => {
    const position = days.length === 1 && days[0].position !== null ? days[0].position : number("BYSETPOS", -1, 4, 0);
    const index = Object.keys(POSITIONS).find((word) => POSITIONS[word] === position);
    if (!index || (parts.has("BYSETPOS") && days.some((d) => d.position !== null)) || (days.length > 1 && !parts.has("BYSETPOS"))) throw unsupported();
    without("BYMONTHDAY");
    return { daysOfWeek: days.map((d) => d.name), index };
  };

  let pattern: GraphPattern;
  switch (parts.get("FREQ")) {
    case "DAILY":
      without("BYDAY", "BYMONTHDAY", "BYMONTH", "BYSETPOS");
      pattern = { type: "daily", interval };
      break;
    case "WEEKLY":
      without("BYMONTHDAY", "BYMONTH", "BYSETPOS");
      if (days.some((d) => d.position !== null)) throw unsupported();
      // iCalendar's week starts on Monday unless the rule says otherwise; it matters for "every other week".
      pattern = { type: "weekly", interval, daysOfWeek: days.length > 0 ? days.map((d) => d.name) : [WEEK[start.getUTCDay()]], firstDayOfWeek: DAY_NAMES[parts.get("WKST") ?? "MO"] };
      if (!pattern.firstDayOfWeek) throw unsupported();
      break;
    case "MONTHLY":
      without("BYMONTH");
      pattern = days.length > 0 ? { type: "relativeMonthly", interval, ...nth() } : { type: "absoluteMonthly", interval, dayOfMonth: number("BYMONTHDAY", 1, 31, start.getUTCDate()) };
      break;
    case "YEARLY": {
      const month = number("BYMONTH", 1, 12, start.getUTCMonth() + 1);
      pattern = days.length > 0 ? { type: "relativeYearly", interval, ...nth(), month } : { type: "absoluteYearly", interval, dayOfMonth: number("BYMONTHDAY", 1, 31, start.getUTCDate()), month };
      break;
    }
    default:
      throw unsupported();
  }
  if (days.length === 0) without("BYSETPOS");

  const range: GraphRange = { type: "noEnd", startDate, recurrenceTimeZone: timeZone };
  if (parts.has("COUNT")) {
    without("UNTIL");
    range.type = "numbered";
    range.numberOfOccurrences = number("COUNT", 1, 9999, 1);
  }
  const until = parts.get("UNTIL");
  if (until) {
    const match = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z?))?$/.exec(until);
    if (!match) throw unsupported();
    const [year, month, day, hour, minute, second] = match.slice(1, 7).map((n) => Number(n ?? 0));
    const wall = Date.UTC(year, month - 1, day, hour, minute, second);
    // The last day counts on the clocks of the event's zone: late evening in New York is already tomorrow in UTC.
    range.type = "endDate";
    range.endDate = isoDate(match[7] ? toWall(wall, timeZone) : wall);
  }
  return { pattern, range };
}

/** Two rules that say the same, whatever order their parts are in. */
const sameRule = (a: string, b: string | null) => b !== null && a.toUpperCase().split(";").sort().join(";") === b.toUpperCase().split(";").sort().join(";");

/* ------------------------------ What Graph takes ------------------------------ */

/** The day an event starts on, as the people in its zone see it. */
const startDay = (span: Span, timeZone: string) => isoDate(span.allDay ? span.start.getTime() : toWall(span.start.getTime(), timeZone));

/** start and end as Graph takes them: what the clocks in the event's zone show, and the zone's name next to it. */
function times(span: Span, timeZone: string) {
  const at = (date: Date) =>
    span.allDay
      ? { dateTime: `${isoDate(date.getTime())}T00:00:00`, timeZone: "UTC" }
      : { dateTime: new Date(toWall(date.getTime(), timeZone)).toISOString().slice(0, 19), timeZone };
  return { start: at(span.start), end: at(span.end), isAllDay: span.allDay };
}

const guest = (g: { name: string; email: string }): GraphAttendee => ({ emailAddress: { address: g.email, name: g.name }, type: "required" });

const sameAddress = (a: string | undefined, b: string | undefined) => !!a && a.toLowerCase() === b?.toLowerCase();

/* --------------------------------- Provider --------------------------------- */

export function createMicrosoftProvider(opts: ProviderOptions, deps: ProviderDeps = {}): CalendarProvider {
  const api = createApi(opts, { name: "Microsoft Graph", refresh: (refreshToken) => refreshMicrosoftToken(refreshToken, [GRAPH_CALENDAR_SCOPE, "offline_access"]) }, deps);
  // Graph's ids may hold "/" and "+".
  const eventUrl = (eventId: string) => `${BASE}/me/events/${encodeURIComponent(eventId)}`;

  async function pages<T>(first: string): Promise<T[]> {
    const items: T[] = [];
    let url: string | undefined = first;
    for (let n = 0; url && n < MAX_PAGES; n++) {
      const page: GraphPage<T> = await api.json<GraphPage<T>>("GET", url, { headers: PREFER });
      items.push(...(page.value ?? []));
      const next: string | undefined = page["@odata.nextLink"];
      // The token only ever goes to Graph, whatever address the answer names.
      url = next?.startsWith("https://graph.microsoft.com/") ? next : undefined;
    }
    return items;
  }

  /**
   * The rule of each series, by the series' id: occurrences don't carry it, so the series are asked for,
   * twenty per request. When that fails the events still list, those series just without their rule.
   */
  async function seriesRules(ids: string[]): Promise<Map<string, string>> {
    const rules = new Map<string, string>();
    const batches: string[][] = [];
    for (let i = 0; i < ids.length; i += BATCH_SIZE) batches.push(ids.slice(i, i + BATCH_SIZE));
    await Promise.all(
      batches.map(async (batch) => {
        try {
          const requests = batch.map((id, i) => ({ id: String(i), method: "GET", url: `/me/events/${encodeURIComponent(id)}?$select=id,recurrence` }));
          const answer = await api.json<{ responses?: { id?: string; status?: number; body?: GraphEvent }[] }>("POST", `${BASE}/$batch`, { body: { requests } });
          for (const response of answer.responses ?? []) {
            const id = batch[Number(response.id)];
            const rule = response.status === 200 ? recurrenceToRrule(response.body?.recurrence) : null;
            if (id && rule) rules.set(id, rule);
          }
        } catch {
          // Listed without their rule; the next listing asks again.
        }
      }),
    );
    return rules;
  }

  return {
    sendsInvitations: true,

    async listCalendars(): Promise<ProviderCalendar[]> {
      const calendars = await pages<GraphCalendar>(`${BASE}/me/calendars?$top=100`);
      return calendars.map((c) => ({
        providerId: c.id,
        name: c.name ?? "",
        color: /^#[0-9a-f]{6}$/i.test(c.hexColor ?? "") ? (c.hexColor ?? null) : null,
        readOnly: !c.canEdit,
        primary: c.isDefaultCalendar === true,
        shown: true,
      }));
    },

    async listEvents(calendarId, from, to) {
      const query = `startDateTime=${encodeURIComponent(from.toISOString())}&endDateTime=${encodeURIComponent(to.toISOString())}&$top=250`;
      const events = await pages<GraphEvent>(`${BASE}/me/calendars/${encodeURIComponent(calendarId)}/calendarView?${query}`);
      const seriesIds = new Set(events.filter((e) => !e.isCancelled && e.seriesMasterId).map((e) => e.seriesMasterId ?? ""));
      const rules = await seriesRules([...seriesIds]);
      return events.map((event) => toEvent(event, rules)).filter((event) => event !== null);
    },

    async createEvent(calendarId, draft) {
      const body = {
        subject: draft.title,
        body: { contentType: "text", content: draft.description },
        location: { displayName: draft.location },
        ...times(draft, draft.timeZone),
        // Graph emails the people listed here by itself.
        attendees: draft.attendees.map(guest),
        ...(draft.recurrence && { recurrence: rruleToRecurrence(draft.recurrence, startDay(draft, draft.timeZone), draft.timeZone) }),
      };
      await api.send("POST", `${BASE}/me/calendars/${encodeURIComponent(calendarId)}/events`, { body });
    },

    async updateEvent(_calendarId, ref, draft, scope) {
      const seriesId = scope === "all" ? ref.seriesId : null;
      const url = eventUrl(seriesId ?? ref.providerId);
      // What's there now, so only what the user changed is sent: Graph emails the guests about what it
      // gets, and a description sent back as text would wipe Outlook's formatting.
      const [current, occurrence] = await Promise.all([
        api.json<GraphEvent>("GET", url, { headers: PREFER }),
        seriesId ? api.json<GraphEvent>("GET", `${eventUrl(ref.providerId)}?$select=start,end,isAllDay`, { headers: PREFER }) : null,
      ]);
      const patch: Record<string, unknown> = { subject: draft.title };
      if ((current.location?.displayName ?? "") !== draft.location) patch.location = { displayName: draft.location };
      if (description(current) !== draft.description) patch.body = { contentType: "text", content: draft.description };
      const before = spanOf(current);
      if (seriesId) {
        // The draft has the occurrence's times; the series moves by as much as the occurrence did.
        const was = occurrence && spanOf(occurrence);
        const moved = before && was ? shiftSeries({ ...before, timeZone: ianaZone(current.originalStartTimeZone) }, was, draft) : null;
        if (moved) Object.assign(patch, times(moved, moved.timeZone));
        const range = current.recurrence?.range;
        const zone = moved?.timeZone ?? ianaZone(current.originalStartTimeZone) ?? draft.timeZone;
        const firstDay = moved ? startDay(moved, zone) : (range?.startDate ?? startDay(before ?? draft, zone));
        // No rule in the draft means "as it was": the listing may not have known the rule.
        if (draft.recurrence && !sameRule(draft.recurrence, recurrenceToRrule(current.recurrence))) {
          patch.recurrence = rruleToRecurrence(draft.recurrence, firstDay, zone);
        } else if (current.recurrence && range && firstDay !== range.startDate) {
          // The range says which day the series starts on: it has to follow the first event.
          patch.recurrence = { ...current.recurrence, range: { ...range, startDate: firstDay } };
        }
      } else {
        if (!before || !sameSpan(before, draft)) Object.assign(patch, times(draft, draft.timeZone));
        // One occurrence can't repeat by itself; a single event may start to.
        if (!ref.seriesId && draft.recurrence) patch.recurrence = rruleToRecurrence(draft.recurrence, startDay(draft, draft.timeZone), draft.timeZone);
      }
      const owner = current.organizer?.emailAddress?.address;
      const attendees = mergeGuests(current.attendees ?? [], draft.attendees, {
        email: (a) => a.emailAddress?.address ?? "",
        hidden: (a) => a.type === "resource" || sameAddress(a.emailAddress?.address, owner),
        make: guest,
      });
      if (attendees) patch.attendees = attendees;
      await api.send("PATCH", url, { body: patch });
    },

    async deleteEvent(_calendarId, ref, scope) {
      // 404: somebody deleted it first, which is what was wanted.
      await api.send("DELETE", eventUrl((scope === "all" && ref.seriesId) || ref.providerId), { allow: [404] });
    },

    async respond(_calendarId, ref, answer, scope) {
      const action = { accepted: "accept", tentative: "tentativelyAccept", declined: "decline" }[answer];
      await api.send("POST", `${eventUrl((scope === "all" && ref.seriesId) || ref.providerId)}/${action}`, { body: { sendResponse: true } });
    },
  };
}
