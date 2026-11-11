import { decodeIdToken } from "arctic";
import type { AttendeeStatus, EventAttendee } from "@/lib/calendar/types";
import { googleClient, refreshAccessToken } from "../google";
import { decodeEntities } from "../mail/gmail/parse";
import { joinUrlFrom } from "../mail/ics";
import { createApi, isoDate, mergeGuests, plainText, sameSpan, shiftSeries, type CalendarGrant, type ProviderDeps, type ProviderOptions, type Span } from "./oauth";
import { CalendarAuthError, type CalendarProvider, type ProviderCalendar, type ProviderEvent } from "./types";

export type { CalendarGrant, ProviderOptions } from "./oauth";

/**
 * Google Calendar: connecting an account (its own grant, apart from a Gmail mailbox's) and the
 * provider that reads and changes its events through the Calendar API.
 */

const EVENTS_SCOPE = "https://www.googleapis.com/auth/calendar.events";
const CALENDAR_LIST_SCOPE = "https://www.googleapis.com/auth/calendar.calendarlist.readonly";

/** Events to read and change, and the list of calendars to show; nothing else of the account. */
export const GOOGLE_CALENDAR_SCOPES = ["openid", "email", EVENTS_SCOPE, CALENDAR_LIST_SCOPE];

export function googleCalendarAuthUrl({ state, codeVerifier, loginHint }: { state: string; codeVerifier: string; loginHint?: string }): URL {
  const url = googleClient().createAuthorizationURL(state, codeVerifier, GOOGLE_CALENDAR_SCOPES);
  // offline + consent: Google only returns a refresh token on the first consent unless we force it again.
  // No include_granted_scopes: this token is for calendars only, a mailbox's Gmail access stays out of it.
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  if (loginHint) url.searchParams.set("login_hint", loginHint);
  return url;
}

export async function exchangeGoogleCalendarCode(code: string, codeVerifier: string): Promise<CalendarGrant> {
  const tokens = await googleClient().validateAuthorizationCode(code, codeVerifier);
  if (!tokens.hasRefreshToken()) throw new Error("Google returned no refresh token (prompt=consent missing?)");
  const scopes = tokens.hasScopes() ? tokens.scopes() : [];
  // Each permission is a checkbox on Google's page. Without events there's nothing to show, and without the list no calendar to show them in.
  if (!scopes.includes(EVENTS_SCOPE) || !scopes.includes(CALENDAR_LIST_SCOPE)) {
    throw new CalendarAuthError("scope_denied: calendar access wasn't allowed on Google's page");
  }
  // The id_token comes straight from Google's token endpoint over TLS, so its signature needn't be checked.
  const claims = decodeIdToken(tokens.idToken()) as { email?: string };
  if (!claims.email) throw new Error("Google id_token has no email (missing `email` scope?)");
  return {
    refreshToken: tokens.refreshToken(),
    accessToken: tokens.accessToken(),
    expiresAt: tokens.accessTokenExpiresAt().getTime(),
    scope: scopes.join(" "),
    email: claims.email.toLowerCase(),
  };
}

/* ------------------------------ What Google sends ------------------------------ */

interface GoogleTime {
  date?: string;
  dateTime?: string;
  timeZone?: string;
}

interface GoogleAttendee {
  email?: string;
  displayName?: string;
  responseStatus?: string;
  self?: boolean;
  resource?: boolean;
  /** The rest (optional, comment, additionalGuests) goes back to Google as it came. */
  [key: string]: unknown;
}

interface GoogleEvent {
  id: string;
  status?: string;
  eventType?: string;
  etag?: string;
  iCalUID?: string;
  recurringEventId?: string;
  summary?: string;
  location?: string;
  description?: string;
  htmlLink?: string;
  hangoutLink?: string;
  start?: GoogleTime;
  end?: GoogleTime;
  recurrence?: string[];
  organizer?: { email?: string; displayName?: string; self?: boolean };
  attendees?: GoogleAttendee[];
  guestsCanModify?: boolean;
  conferenceData?: { entryPoints?: { entryPointType?: string; uri?: string }[] };
}

interface GoogleCalendarEntry {
  id: string;
  summary?: string;
  summaryOverride?: string;
  backgroundColor?: string;
  accessRole?: string;
  primary?: boolean;
  selected?: boolean;
  deleted?: boolean;
}

interface Page<T> {
  items?: T[];
  nextPageToken?: string;
}

const BASE = "https://www.googleapis.com/calendar/v3";
/** A listing that never ends would be Google's bug; this many pages is far beyond any real calendar. */
const MAX_PAGES = 100;

const STATUSES: Record<string, AttendeeStatus> = { accepted: "accepted", tentative: "tentative", declined: "declined", needsAction: "needsAction" };
const status = (value: string | undefined): AttendeeStatus => STATUSES[value ?? ""] ?? "needsAction";

/** 403 because the token doesn't cover calendars (the grant was narrowed): only connecting again helps. */
function scopeRefused(code: number, body: unknown) {
  if (code !== 403) return false;
  const error = (body as { error?: { errors?: { reason?: string }[]; details?: { reason?: string }[] } } | null)?.error;
  return [...(error?.errors ?? []), ...(error?.details ?? [])].some((e) => e.reason === "insufficientPermissions" || e.reason === "ACCESS_TOKEN_SCOPE_INSUFFICIENT");
}

function instant(time: GoogleTime | undefined): { at: Date; allDay: boolean } | null {
  const allDay = !time?.dateTime && !!time?.date;
  const at = new Date(time?.dateTime ?? (time?.date ? `${time.date}T00:00:00Z` : NaN));
  return Number.isNaN(at.getTime()) ? null : { at, allDay };
}

function spanOf(event: GoogleEvent): Span | null {
  const start = instant(event.start);
  if (!start) return null;
  return { start: start.at, end: instant(event.end)?.at ?? start.at, allDay: start.allDay };
}

/** The first rule of a series, without "RRULE:". */
function ruleOf(recurrence: string[] | undefined) {
  const line = recurrence?.find((l) => /^RRULE:/i.test(l));
  return line ? line.slice(6) : null;
}

function toEvent(event: GoogleEvent, rules: Map<string, string>): ProviderEvent | null {
  // Working locations ("Office", "Home") aren't events to a person looking at their week.
  if (event.status === "cancelled" || event.eventType === "workingLocation") return null;
  const span = spanOf(event);
  if (!span) return null;
  const organizer = event.organizer;
  const attendees: EventAttendee[] = (event.attendees ?? [])
    .filter((a) => !a.resource && a.email)
    .map((a) => ({ name: a.displayName ?? "", email: a.email ?? "", status: status(a.responseStatus) }));
  const self = event.attendees?.find((a) => a.self);
  const video = event.conferenceData?.entryPoints?.find((p) => p.entryPointType === "video")?.uri;
  const location = event.location ?? "";
  return {
    providerId: event.id,
    seriesId: event.recurringEventId ?? null,
    uid: event.iCalUID ?? null,
    etag: event.etag ?? null,
    title: event.summary ?? "",
    location,
    description: plainText(event.description ?? ""),
    ...span,
    timeZone: event.start?.timeZone ?? null,
    recurrence: event.recurringEventId ? (rules.get(event.recurringEventId) ?? null) : null,
    // An event made in a shared calendar is "organized" by the calendar's own address: that's nobody.
    organizer: organizer?.email && !organizer.email.endsWith("@group.calendar.google.com") ? { name: organizer.displayName ?? "", email: organizer.email } : null,
    attendees,
    myStatus: self && !organizer?.self ? status(self.responseStatus) : null,
    // The link may hide in an <a href> of the description, so look before the tags are taken out.
    joinUrl: joinUrlFrom({ google: event.hangoutLink, conferences: video ? [video] : [], location, description: decodeEntities(event.description ?? "") }),
    url: event.htmlLink ?? null,
    // Birthdays come from contacts and "fromGmail" events from emails: Google refuses changes to both.
    canEdit: (!organizer || organizer.self === true || event.guestsCanModify === true) && event.eventType !== "birthday" && event.eventType !== "fromGmail",
  };
}

/** start and end as Google takes them. A PATCH clears the other form, or a timed event couldn't become all-day. */
function times(span: Span, timeZone: string, patch: boolean) {
  const at = (date: Date) =>
    span.allDay
      ? { date: isoDate(date.getTime()), ...(patch && { dateTime: null, timeZone: null }) }
      : { dateTime: date.toISOString(), timeZone, ...(patch && { date: null }) };
  return { start: at(span.start), end: at(span.end) };
}

const guest = (g: { name: string; email: string }): GoogleAttendee => ({ email: g.email, ...(g.name && { displayName: g.name }) });

/* --------------------------------- Provider --------------------------------- */

export function createGoogleProvider(opts: ProviderOptions, deps: ProviderDeps = {}): CalendarProvider {
  const api = createApi(opts, { name: "Google Calendar", refresh: refreshAccessToken, authRefusal: scopeRefused }, deps);
  const eventsUrl = (calendarId: string) => `${BASE}/calendars/${encodeURIComponent(calendarId)}/events`;
  const eventUrl = (calendarId: string, eventId: string) => `${eventsUrl(calendarId)}/${encodeURIComponent(eventId)}`;

  async function pages<T>(url: URL): Promise<T[]> {
    const items: T[] = [];
    for (let n = 0; n < MAX_PAGES; n++) {
      const page = await api.json<Page<T>>("GET", url.href);
      items.push(...(page.items ?? []));
      if (!page.nextPageToken) break;
      url.searchParams.set("pageToken", page.nextPageToken);
    }
    return items;
  }

  return {
    sendsInvitations: true,

    async listCalendars(): Promise<ProviderCalendar[]> {
      const entries = await pages<GoogleCalendarEntry>(new URL(`${BASE}/users/me/calendarList?maxResults=250`));
      return entries
        .filter((c) => !c.deleted)
        .map((c) => ({
          providerId: c.id,
          name: c.summaryOverride ?? c.summary ?? "",
          color: c.backgroundColor ?? null,
          readOnly: c.accessRole === "reader" || c.accessRole === "freeBusyReader",
          primary: c.primary === true,
          shown: c.selected === true || c.primary === true,
        }));
    },

    async listEvents(calendarId, from, to) {
      const listing = (params: Record<string, string>) => {
        const url = new URL(eventsUrl(calendarId));
        url.search = new URLSearchParams({ ...params, timeMin: from.toISOString(), timeMax: to.toISOString(), maxResults: "2500", showDeleted: "false" }).toString();
        return url;
      };
      // Occurrences don't carry their series' rule, so the series themselves are listed alongside.
      const [occurrences, series] = await Promise.all([
        pages<GoogleEvent>(listing({ singleEvents: "true" })),
        pages<Pick<GoogleEvent, "id" | "recurrence">>(listing({ singleEvents: "false", fields: "items(id,recurrence),nextPageToken" })),
      ]);
      const rules = new Map<string, string>();
      for (const event of series) {
        const rule = ruleOf(event.recurrence);
        if (rule) rules.set(event.id, rule);
      }
      return occurrences.map((event) => toEvent(event, rules)).filter((event) => event !== null);
    },

    async createEvent(calendarId, draft) {
      const body = {
        summary: draft.title,
        location: draft.location,
        description: draft.description,
        ...times(draft, draft.timeZone, false),
        ...(draft.recurrence && { recurrence: [`RRULE:${draft.recurrence}`] }),
        ...(draft.attendees.length > 0 && { attendees: draft.attendees.map(guest) }),
      };
      await api.send("POST", `${eventsUrl(calendarId)}?sendUpdates=${draft.attendees.length > 0 ? "all" : "none"}`, { body });
    },

    async updateEvent(calendarId, ref, draft, scope) {
      const seriesId = scope === "all" ? ref.seriesId : null;
      const url = eventUrl(calendarId, seriesId ?? ref.providerId);
      // What's there now: who is invited (they hear about the change, and keep their answers), and for a
      // whole series its first event and the occurrence the user was looking at.
      const [current, occurrence] = await Promise.all([
        api.json<GoogleEvent>("GET", url),
        seriesId ? api.json<GoogleEvent>("GET", eventUrl(calendarId, ref.providerId)) : null,
      ]);
      const patch: Record<string, unknown> = { summary: draft.title, location: draft.location };
      // Rewriting the description would flatten Google's formatting, so only when the text changed.
      if (plainText(current.description ?? "") !== draft.description) patch.description = draft.description;
      const before = spanOf(current);
      if (seriesId) {
        // The draft has the occurrence's times; the series moves by as much as the occurrence did.
        const was = occurrence && spanOf(occurrence);
        const moved = before && was ? shiftSeries({ ...before, timeZone: current.start?.timeZone ?? null }, was, draft) : null;
        if (moved) Object.assign(patch, times(moved, moved.timeZone, true));
        // No rule in the draft means "as it was": the listing may not have known the rule.
        if (draft.recurrence && draft.recurrence !== ruleOf(current.recurrence)) {
          patch.recurrence = [...(current.recurrence ?? []).filter((l) => !/^RRULE:/i.test(l)), `RRULE:${draft.recurrence}`];
        }
      } else {
        if (!before || !sameSpan(before, draft)) Object.assign(patch, times(draft, draft.timeZone, true));
        // One occurrence can't repeat by itself; a single event may start to.
        if (!ref.seriesId && draft.recurrence) patch.recurrence = [`RRULE:${draft.recurrence}`];
      }
      const invited = current.attendees ?? [];
      const attendees = mergeGuests(invited, draft.attendees, { email: (a) => a.email ?? "", hidden: (a) => a.resource === true || a.self === true, make: guest });
      if (attendees) patch.attendees = attendees;
      const notify = invited.length > 0 || draft.attendees.length > 0;
      await api.send("PATCH", `${url}?sendUpdates=${notify ? "all" : "none"}`, {
        body: patch,
        // Only a single event: the etag we hold for an occurrence isn't the one of its series.
        headers: !ref.seriesId && ref.etag ? { "if-match": ref.etag } : undefined,
      });
    },

    async deleteEvent(calendarId, ref, scope) {
      const id = (scope === "all" && ref.seriesId) || ref.providerId;
      // 404 and 410: somebody deleted it first, which is what was wanted.
      await api.send("DELETE", `${eventUrl(calendarId, id)}?sendUpdates=all`, { allow: [404, 410] });
    },

    async respond(calendarId, ref, answer, scope) {
      const url = eventUrl(calendarId, (scope === "all" && ref.seriesId) || ref.providerId);
      const event = await api.json<GoogleEvent>("GET", url);
      const attendees = event.attendees ?? [];
      if (!attendees.some((a) => a.self)) throw new Error("Google Calendar: the owner isn't invited to this event");
      await api.send("PATCH", `${url}?sendUpdates=all`, { body: { attendees: attendees.map((a) => (a.self ? { ...a, responseStatus: answer } : a)) } });
    },
  };
}
