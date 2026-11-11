import { and, asc, eq, gt, inArray, lt, notInArray, sql } from "drizzle-orm";
import {
  DEFAULT_REMINDER,
  type AttendeeStatus,
  type CalEvent,
  type Calendar,
  type CalendarBootstrap,
  type CalendarSettings,
  type CalendarSource,
  type CalendarSuggestion,
  type EditScope,
  type EventInput,
} from "@/lib/calendar/types";
import { tk } from "@/lib/i18n";
import { seal, unseal } from "../crypto";
import { ACCOUNT_COLUMNS, db, schema } from "../db";
import type { CalendarCredentials, MailboxCredentials } from "../db/schema";
import { env } from "../env";
import { revokeGoogleToken } from "../google";
import { HttpError } from "../http-error";
import { logWarn, safeError } from "../log";
import type { AccountRow } from "../mail/adapters";
import { microsoftEnabled } from "../microsoft";
import { createCalDavProvider, discoverCalDav } from "./caldav";
import { createGoogleProvider } from "./google";
import { sendAnswer, sendInvitations, type InvitationChange } from "./invitations";
import { createLocalProvider, FEED_EVERY_MS, feedUrl, importObjects, refreshFeed } from "./local";
import { createMicrosoftProvider } from "./microsoft";
import { CalendarAuthError, CalendarConflictError, type CalendarProvider, type EventDraft, type EventRef, type ProviderEvent } from "./types";

/**
 * The calendar's data layer. Calendars live at their providers; the database holds a copy of the
 * events in a window of time around what the user looks at, so the grid shows at once and reminders
 * know what's coming. A window is re-read when it's asked for and older than a minute, and after
 * every change made here.
 */

const sources = schema.calendarSources;
const calendars = schema.calendars;
const events = schema.calendarEvents;

export type SourceRow = typeof sources.$inferSelect;
export type CalendarRow = typeof calendars.$inferSelect;
export type EventRow = typeof events.$inferSelect;

const DAY = 86_400_000;
/** A window read this recently is shown as it is. */
const FRESH_MS = 60_000;
/** How often the list of an account's calendars is read again (a calendar made at Google shows up here). */
const LIST_EVERY_MS = 6 * 3600_000;
/** The colours calendars get when their provider doesn't give one (the mailbox palette, src/lib/store.ts). */
const HUES = [200, 152, 28, 262, 340, 88, 48, 312, 178, 12, 228, 282];

/* -------------------------------- Settings -------------------------------- */

export async function calendarSettings(userId: string): Promise<CalendarSettings> {
  const [row] = await db().select({ settings: schema.users.settings }).from(schema.users).where(eq(schema.users.id, userId));
  return row?.settings.calendar ?? {};
}

export function validZone(zone: string | null | undefined): string | null {
  if (!zone) return null;
  try {
    new Intl.DateTimeFormat("en", { timeZone: zone });
    return zone;
  } catch {
    return null;
  }
}

/** Merges a change into the user's calendar settings (one statement, so two devices can't undo each other's keys). */
export async function saveCalendarSettings(userId: string, patch: CalendarSettings) {
  const clean = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
  if (!Object.keys(clean).length) return;
  await db()
    .update(schema.users)
    .set({ settings: sql`jsonb_set(${schema.users.settings}, '{calendar}', coalesce(${schema.users.settings}->'calendar', '{}'::jsonb) || ${JSON.stringify(clean)}::jsonb)` })
    .where(eq(schema.users.id, userId));
}

/** The zone times without one are read in: what the app last ran in. */
async function zoneOf(userId: string) {
  return validZone((await calendarSettings(userId)).timeZone) ?? "UTC";
}

/* --------------------------------- Shapes --------------------------------- */

const sourceDto = (s: SourceRow): CalendarSource => ({ id: s.id, kind: s.kind, accountId: s.accountId, label: s.label, status: s.status, statusMessage: s.statusMessage });

const calendarDto = (c: CalendarRow): Calendar => ({ id: c.id, sourceId: c.sourceId, name: c.name, hue: c.hue, visible: c.visible, readOnly: c.readOnly, primary: c.primary });

const dateOnly = (d: Date) => d.toISOString().slice(0, 10);

/** Google and Microsoft tell the organizer themselves; for the rest the answer goes out by email (./invitations.ts). */
const TELLS_ORGANIZER = new Set(["google", "microsoft"]);

function eventDto(e: EventRow, calendar: Pick<CalendarRow, "readOnly">, kind: string, own?: OwnReminders): CalEvent {
  const reminder = own ? ownReminder(own, e) : undefined;
  return {
    ...(reminder !== undefined ? { reminder } : {}),
    id: e.id,
    calendarId: e.calendarId,
    title: e.title,
    location: e.location,
    description: e.description,
    start: e.allDay ? dateOnly(e.startAt) : e.startAt.toISOString(),
    end: e.allDay ? dateOnly(e.endAt) : e.endAt.toISOString(),
    allDay: e.allDay,
    recurring: !!e.seriesId,
    recurrence: e.recurrence,
    organizer: e.organizer ?? null,
    attendees: e.attendees,
    myStatus: e.myStatus ?? null,
    joinUrl: e.joinUrl,
    url: e.url,
    canEdit: e.canEdit && !calendar.readOnly,
    canRespond: !!e.myStatus && kind !== "feed" && !calendar.readOnly,
  };
}

/* -------------------------------- Reminders -------------------------------- */

const reminders = schema.calendarReminders;

/** Events with a reminder of their own, by calendar and key (an occurrence, or a whole series). */
type OwnReminders = Map<string, number | null>;

async function ownReminders(userId: string): Promise<OwnReminders> {
  const rows = await db().select({ calendarId: reminders.calendarId, key: reminders.key, minutes: reminders.minutes }).from(reminders).where(eq(reminders.userId, userId));
  return new Map(rows.map((r) => [`${r.calendarId}\n${r.key}`, r.minutes]));
}

/** The event's own reminder: the occurrence's, else its series'; undefined when it has none of its own. */
function ownReminder(own: OwnReminders, e: Pick<EventRow, "calendarId" | "providerId" | "seriesId">): number | null | undefined {
  const mine = own.get(`${e.calendarId}\n${e.providerId}`);
  if (mine !== undefined || !e.seriesId) return mine;
  return own.get(`${e.calendarId}\n${e.seriesId}`);
}

/**
 * Gives an event its own reminder time (null: none), for this occurrence or the whole series. A time
 * that's the same as what the event would have anyway isn't kept, so it goes on following the usual one.
 */
async function saveReminder(userId: string, event: Pick<EventRow, "calendarId" | "providerId" | "seriesId">, minutes: number | null, scope: EditScope) {
  const series = scope === "all" && event.seriesId ? event.seriesId : null;
  const key = series ?? event.providerId;
  const [own, settings] = await Promise.all([ownReminders(userId), calendarSettings(userId)]);
  const usual = settings.reminder === undefined ? DEFAULT_REMINDER : settings.reminder;
  const fromSeries = !series && event.seriesId ? own.get(`${event.calendarId}\n${event.seriesId}`) : undefined;
  const inherited = fromSeries === undefined ? usual : fromSeries;
  const at = (k: string) => and(eq(reminders.calendarId, event.calendarId), eq(reminders.key, k));
  // The whole series: this occurrence stops having a time of its own.
  if (series) await db().delete(reminders).where(at(event.providerId));
  if (minutes === inherited) await db().delete(reminders).where(at(key));
  else {
    await db()
      .insert(reminders)
      .values({ userId, calendarId: event.calendarId, key, minutes })
      .onConflictDoUpdate({ target: [reminders.calendarId, reminders.key], set: { minutes } });
  }
  // A reminder that already went out comes again when the new time is still ahead.
  if (minutes !== null) {
    await db()
      .update(events)
      .set({ remindedFor: null })
      .where(and(eq(events.calendarId, event.calendarId), series ? eq(events.seriesId, series) : eq(events.providerId, key), gt(events.startAt, new Date(Date.now() + minutes * 60_000))));
  }
}

export async function setEventReminder(userId: string, eventId: string, minutes: number | null, scope: EditScope) {
  const { event } = await ownedEvent(userId, eventId);
  if (event.allDay) throw new HttpError(400, "All-day events don't remind.", "all_day");
  await saveReminder(userId, event, minutes, scope);
}

/** "#3f51b5" → its hue; greys get a calm blue. */
export function hueOf(color: string | null | undefined, fallback: number) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(color ?? "");
  if (!m) return fallback;
  const [r, g, b] = m.slice(1).map((h) => parseInt(h, 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max - min < 0.08) return 228;
  const d = max - min;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return Math.round((h * 60 + 360) % 360);
}

/* -------------------------------- Providers -------------------------------- */

async function accountOf(source: SourceRow): Promise<AccountRow | null> {
  if (!source.accountId) return null;
  const [row] = await db().select(ACCOUNT_COLUMNS).from(schema.accounts).where(eq(schema.accounts.id, source.accountId));
  return row ?? null;
}

/** The addresses that are the calendar's owner: who "me" is among an event's guests. */
async function ownAddresses(source: SourceRow): Promise<string[]> {
  const mailboxes = await db().select({ email: schema.accounts.email }).from(schema.accounts).where(eq(schema.accounts.userId, source.userId));
  const own = source.label.includes("@") ? [source.label.toLowerCase()] : [];
  return [...new Set([...own, ...mailboxes.map((m) => m.email.toLowerCase())])];
}

/** How to sign in to a CalDAV account: its own password, or the password of the mailbox it came with. */
async function calDavLogin(source: SourceRow) {
  if (source.credentials) {
    const c = unseal<CalendarCredentials>(source.credentials, source.id);
    if (c.kind === "password") return { username: c.username, password: c.password };
  }
  const account = await accountOf(source);
  if (!account) throw new CalendarAuthError("no credentials");
  const c = unseal<MailboxCredentials>(account.credentials, account.id);
  if (c.kind !== "password") throw new CalendarAuthError("no password");
  return { username: account.imap?.username ?? account.email, password: c.password };
}

async function providerFor(source: SourceRow, calendar: CalendarRow | null, tz: string): Promise<CalendarProvider> {
  const me = await ownAddresses(source);
  switch (source.kind) {
    case "google":
    case "microsoft": {
      if (!source.credentials) throw new CalendarAuthError("no credentials");
      const credentials = unseal<CalendarCredentials>(source.credentials, source.id);
      if (credentials.kind !== "oauth") throw new CalendarAuthError("no token");
      const save = async (next: CalendarCredentials) => {
        await db().update(sources).set({ credentials: seal(next, source.id) }).where(eq(sources.id, source.id));
      };
      return source.kind === "google" ? createGoogleProvider({ credentials, save }) : createMicrosoftProvider({ credentials, save });
    }
    case "caldav":
      if (!source.url) throw new CalendarAuthError("no server");
      // The owner's own address first: it's who invites when an event gets guests.
      return createCalDavProvider({ homeUrl: source.url, login: await calDavLogin(source), me, tz });
    default:
      if (!calendar) throw new Error("A calendar of Kolbaba's own is read one at a time");
      return createLocalProvider(calendar.id, { tz, me });
  }
}

/** What went wrong at a provider, as something to tell the user; a refused sign-in also marks the account. */
async function providerFailure(source: SourceRow, err: unknown): Promise<HttpError> {
  if (err instanceof HttpError) return err;
  if (err instanceof CalendarAuthError) {
    await db().update(sources).set({ status: "auth_error", statusMessage: null }).where(eq(sources.id, source.id));
    return new HttpError(401, "This calendar account has to be connected again.", "calendar_auth");
  }
  if (err instanceof CalendarConflictError) return new HttpError(409, "The event changed somewhere else in the meantime. Check it and try again.", "calendar_conflict");
  logWarn(`[calendar] ${source.kind} ${source.id}`, err);
  return new HttpError(502, "The calendar couldn't be reached. Try again in a moment.", "calendar_unreachable");
}

/* -------------------------------- Bootstrap -------------------------------- */

async function suggestions(userId: string, rows: SourceRow[], settings: CalendarSettings): Promise<CalendarSuggestion[]> {
  const accounts = await db().select(ACCOUNT_COLUMNS).from(schema.accounts).where(eq(schema.accounts.userId, userId)).orderBy(asc(schema.accounts.sortOrder));
  const out: CalendarSuggestion[] = [];
  for (const a of accounts) {
    if (settings.skipped?.includes(a.id)) continue;
    if (rows.some((s) => s.accountId === a.id || (s.label.toLowerCase() === a.email.toLowerCase() && s.kind !== "feed"))) continue;
    if (a.provider === "gmail") {
      if (env.hasGoogle) out.push({ accountId: a.id, how: "google" });
      continue;
    }
    let microsoft = false;
    try {
      const c = unseal<MailboxCredentials>(a.credentials, a.id);
      microsoft = c.kind === "oauth" && c.issuer === "microsoft";
    } catch {
      continue;
    }
    if (microsoft) {
      if (microsoftEnabled()) out.push({ accountId: a.id, how: "microsoft" });
    } else out.push({ accountId: a.id, how: "caldav" });
  }
  return out;
}

export async function calendarBootstrap(userId: string): Promise<CalendarBootstrap> {
  const [sourceRows, calendarRows, settings] = await Promise.all([
    db().select().from(sources).where(eq(sources.userId, userId)).orderBy(asc(sources.createdAt)),
    db().select().from(calendars).where(eq(calendars.userId, userId)).orderBy(asc(calendars.sortOrder), asc(calendars.createdAt)),
    calendarSettings(userId),
  ]);
  return {
    sources: sourceRows.map(sourceDto),
    calendars: calendarRows.map(calendarDto),
    settings,
    suggestions: await suggestions(userId, sourceRows, settings),
    can: { google: env.hasGoogle, microsoft: microsoftEnabled() },
  };
}

/* ------------------------------ Calendar lists ------------------------------ */

/** Reads an account's calendars from its provider: new ones come in, ones that are gone there go. */
export async function refreshCalendarList(source: SourceRow, tz: string) {
  if (source.kind === "local" || source.kind === "feed") return;
  const provider = await providerFor(source, null, tz);
  const listed = await provider.listCalendars();
  const known = await db().select().from(calendars).where(eq(calendars.sourceId, source.id));
  const taken = (await db().select({ hue: calendars.hue }).from(calendars).where(eq(calendars.userId, source.userId))).map((c) => c.hue);
  // CalDAV doesn't say which calendar is the main one: the first that can be written to is.
  const main = listed.find((c) => c.primary) ?? listed.find((c) => !c.readOnly);
  let order = known.length;
  for (const c of listed) {
    const existing = known.find((k) => k.providerId === c.providerId);
    if (existing) {
      await db()
        .update(calendars)
        .set({ name: c.name || existing.name, readOnly: c.readOnly, primary: c === main })
        .where(eq(calendars.id, existing.id));
      continue;
    }
    const fallback = HUES.find((h) => !taken.some((t) => Math.abs(t - h) < 14)) ?? HUES[order % HUES.length];
    const hue = hueOf(c.color, fallback);
    taken.push(hue);
    await db()
      .insert(calendars)
      .values({ userId: source.userId, sourceId: source.id, providerId: c.providerId, name: c.name || source.label, hue, visible: c.shown, readOnly: c.readOnly, primary: c === main, sortOrder: order++ })
      .onConflictDoNothing();
  }
  const gone = known.filter((k) => !listed.some((c) => c.providerId === k.providerId)).map((k) => k.id);
  if (gone.length) await db().delete(calendars).where(inArray(calendars.id, gone));
  await db().update(sources).set({ listedAt: new Date(), status: "ok", statusMessage: null }).where(eq(sources.id, source.id));
}

/** Lists that haven't been read for a while are read again, quietly (the calendar opens without waiting for it). */
export async function refreshStaleLists(userId: string) {
  const rows = await db().select().from(sources).where(eq(sources.userId, userId));
  const tz = await zoneOf(userId);
  await Promise.all(
    rows
      .filter((s) => s.status !== "auth_error" && (!s.listedAt || Date.now() - s.listedAt.getTime() > LIST_EVERY_MS))
      .map((s) => refreshCalendarList(s, tz).catch((err) => providerFailure(s, err))),
  );
}

/* ---------------------------------- Events --------------------------------- */

/** Events of the visible calendars that touch [from, to), from the copy here. */
export async function listEvents(userId: string, from: Date, to: Date, opts: { calendarIds?: string[]; includeHidden?: boolean } = {}): Promise<CalEvent[]> {
  const rows = await db()
    .select({ event: events, readOnly: calendars.readOnly, kind: sources.kind })
    .from(events)
    .innerJoin(calendars, eq(calendars.id, events.calendarId))
    .innerJoin(sources, eq(sources.id, calendars.sourceId))
    .where(
      and(
        eq(events.userId, userId),
        lt(events.startAt, to),
        // An all-day event's last day ends at the following midnight UTC: a day of slack covers every zone.
        gt(events.endAt, new Date(from.getTime() - DAY)),
        gt(events.startAt, new Date(from.getTime() - 400 * DAY)),
        opts.includeHidden ? undefined : eq(calendars.visible, true),
        opts.calendarIds?.length ? inArray(events.calendarId, opts.calendarIds) : undefined,
      ),
    )
    .orderBy(asc(events.startAt));
  const own = await ownReminders(userId);
  return rows.map((r) => eventDto(r.event, { readOnly: r.readOnly }, r.kind, own));
}

const eventValues = (calendar: CalendarRow, e: ProviderEvent) => ({
  userId: calendar.userId,
  calendarId: calendar.id,
  providerId: e.providerId,
  seriesId: e.seriesId,
  uid: e.uid,
  etag: e.etag,
  title: e.title.slice(0, 500),
  location: e.location.slice(0, 500),
  description: e.description.slice(0, 8000),
  startAt: e.start,
  endAt: e.end < e.start ? e.start : e.end,
  allDay: e.allDay,
  timeZone: e.timeZone,
  recurrence: e.recurrence,
  organizer: e.organizer,
  attendees: e.attendees.slice(0, 200),
  myStatus: e.myStatus,
  joinUrl: e.joinUrl,
  url: e.url,
  canEdit: e.canEdit,
});

const excluded = (column: string) => sql.raw(`excluded.${column}`);

/** Reads one calendar's window from its provider and makes the copy here match it. */
async function syncCalendar(source: SourceRow, calendar: CalendarRow, from: Date, to: Date, tz: string, force = false) {
  if (source.kind === "feed" && source.url && (force || !calendar.syncedAt || Date.now() - calendar.syncedAt.getTime() > FEED_EVERY_MS)) {
    const fresh = await refreshFeed(calendar.id, source.url, calendar.syncState, tz);
    if (fresh.changed) await db().update(calendars).set({ syncState: fresh.state }).where(eq(calendars.id, calendar.id));
  }
  const provider = await providerFor(source, calendar, tz);
  const listed = await provider.listEvents(calendar.providerId, from, to);
  // The same occurrence listed twice would break the one statement below.
  const unique = [...new Map(listed.map((e) => [e.providerId, e])).values()];
  await db().transaction(async (tx) => {
    for (let i = 0; i < unique.length; i += 200) {
      await tx
        .insert(events)
        .values(unique.slice(i, i + 200).map((e) => eventValues(calendar, e)))
        .onConflictDoUpdate({
          target: [events.calendarId, events.providerId],
          set: {
            seriesId: excluded("series_id"),
            uid: excluded("uid"),
            etag: excluded("etag"),
            title: excluded("title"),
            location: excluded("location"),
            description: excluded("description"),
            startAt: excluded("start_at"),
            endAt: excluded("end_at"),
            allDay: excluded("all_day"),
            timeZone: excluded("time_zone"),
            recurrence: excluded("recurrence"),
            organizer: excluded("organizer"),
            attendees: excluded("attendees"),
            myStatus: excluded("my_status"),
            joinUrl: excluded("join_url"),
            url: excluded("url"),
            canEdit: excluded("can_edit"),
            updatedAt: new Date(),
          },
        });
    }
    // What the provider no longer lists in this window is gone (deleted, moved out, cancelled).
    const ids = unique.map((e) => e.providerId);
    await tx.delete(events).where(and(eq(events.calendarId, calendar.id), lt(events.startAt, to), gt(events.endAt, from), ids.length ? notInArray(events.providerId, ids) : undefined));
    await tx.update(calendars).set({ syncedFrom: from, syncedTo: to, syncedAt: new Date() }).where(eq(calendars.id, calendar.id));
  });
}

/** The window kept around a request: the months near today when it's about them, or the asked days with a month on each side. */
function windowFor(from: Date, to: Date, now = Date.now()) {
  const near = { from: now - 45 * DAY, to: now + 120 * DAY };
  if (from.getTime() < near.to && to.getTime() > near.from) return { from: new Date(Math.min(from.getTime(), near.from)), to: new Date(Math.max(to.getTime(), near.to)) };
  return { from: new Date(from.getTime() - 31 * DAY), to: new Date(to.getTime() + 31 * DAY) };
}

async function inBatches<T>(items: T[], size: number, fn: (item: T) => Promise<unknown>) {
  for (let i = 0; i < items.length; i += size) await Promise.all(items.slice(i, i + size).map(fn));
}

/**
 * Brings [from, to) up to date for the visible calendars that need it. One account failing (a revoked
 * sign-in, a server that's down) is noted on it and doesn't stop the others.
 */
export async function syncRange(userId: string, from: Date, to: Date, opts: { force?: boolean; freshMs?: number; calendarIds?: string[] } = {}) {
  const [sourceRows, calendarRows, tz] = await Promise.all([
    db().select().from(sources).where(eq(sources.userId, userId)),
    db().select().from(calendars).where(and(eq(calendars.userId, userId), opts.calendarIds?.length ? inArray(calendars.id, opts.calendarIds) : eq(calendars.visible, true))),
    zoneOf(userId),
  ]);
  const freshMs = opts.freshMs ?? FRESH_MS;
  const due = calendarRows.filter((c) => {
    const covered = c.syncedFrom && c.syncedTo && c.syncedFrom <= from && c.syncedTo >= to;
    const fresh = c.syncedAt && Date.now() - c.syncedAt.getTime() < freshMs;
    return opts.force || !covered || !fresh;
  });
  const window = windowFor(from, to);
  const failed = new Map<string, unknown>();
  const worked = new Set<string>();
  await inBatches(due, 6, async (calendar) => {
    const source = sourceRows.find((s) => s.id === calendar.sourceId);
    // An account that has to be connected again isn't asked until it is.
    if (!source || source.status === "auth_error" || failed.has(source.id)) return;
    try {
      await syncCalendar(source, calendar, window.from, window.to, tz, opts.force);
      worked.add(source.id);
    } catch (err) {
      failed.set(source.id, err);
    }
  });
  for (const source of sourceRows) {
    const err = failed.get(source.id);
    if (err instanceof CalendarAuthError) await db().update(sources).set({ status: "auth_error", statusMessage: null }).where(eq(sources.id, source.id));
    else if (err) {
      logWarn(`[calendar] sync ${source.kind} ${source.id}`, err);
      await db().update(sources).set({ status: "error", statusMessage: safeError(err).slice(0, 200) }).where(eq(sources.id, source.id));
    } else if (worked.has(source.id) && source.status !== "ok") await db().update(sources).set({ status: "ok", statusMessage: null }).where(eq(sources.id, source.id));
  }
}

/* ---------------------------------- Search --------------------------------- */

/** Search looks a year back and a year ahead: the copy here is brought up to that when someone searches. */
const SEARCH_SPAN = 365 * DAY;
/** The wide window is read from a provider again at most this often. */
const SEARCH_FRESH_MS = 10 * 60_000;
const SEARCH_LIMIT = 40;

/** Reads a year each way for the ticked calendars that haven't had it read lately. A calendar that fails is searched as it is. */
async function syncForSearch(userId: string, from: Date, to: Date) {
  const [sourceRows, calendarRows, tz] = await Promise.all([
    db().select().from(sources).where(eq(sources.userId, userId)),
    db().select().from(calendars).where(and(eq(calendars.userId, userId), eq(calendars.visible, true))),
    zoneOf(userId),
  ]);
  const due = calendarRows.filter((c) => !c.syncState.searchedAt || Date.now() - c.syncState.searchedAt > SEARCH_FRESH_MS);
  await inBatches(due, 4, async (calendar) => {
    const source = sourceRows.find((s) => s.id === calendar.sourceId);
    if (!source || source.status === "auth_error") return;
    try {
      await syncCalendar(source, calendar, from, to, tz);
      await db()
        .update(calendars)
        .set({ syncState: sql`${calendars.syncState} || ${JSON.stringify({ searchedAt: Date.now() })}::jsonb` })
        .where(eq(calendars.id, calendar.id));
    } catch (err) {
      logWarn(`[calendar] search sync ${source.kind} ${source.id}`, err);
    }
  });
}

/**
 * Events of the ticked calendars whose title, place, notes or guests have every word of `query`
 * (accents and case don't matter), a year back and a year ahead. A repeating event shows once: its
 * next occurrence, or its last when it's over. What's coming is first, then the past from the newest.
 * `deep` reads that year from the providers first; without it the answer comes from what's here already.
 */
export async function searchEvents(userId: string, query: string, opts: { deep?: boolean; now?: Date } = {}): Promise<CalEvent[]> {
  const words = query.trim().slice(0, 120).split(/\s+/).filter(Boolean).slice(0, 6);
  if (!words.join("").length) return [];
  const now = opts.now ?? new Date();
  const from = new Date(now.getTime() - SEARCH_SPAN);
  const to = new Date(now.getTime() + SEARCH_SPAN);
  if (opts.deep) await syncForSearch(userId, from, to);
  const text = sql`immutable_unaccent(lower(${events.title} || ' ' || ${events.location} || ' ' || ${events.description} || ' ' || ${events.attendees}::text))`;
  const literal = (word: string) => word.replace(/[\\%_]/g, (c) => `\\${c}`);
  const rows = await db()
    .select({ event: events, readOnly: calendars.readOnly, kind: sources.kind })
    .from(events)
    .innerJoin(calendars, eq(calendars.id, events.calendarId))
    .innerJoin(sources, eq(sources.id, calendars.sourceId))
    .where(and(eq(events.userId, userId), eq(calendars.visible, true), gt(events.endAt, from), lt(events.startAt, to), ...words.map((w) => sql`${text} like '%' || immutable_unaccent(lower(${literal(w)})) || '%'`)))
    .orderBy(asc(events.startAt))
    .limit(3000);
  // One row per series: the first that hasn't ended, else the last.
  const picked = new Map<string, EventRow>();
  const meta = new Map<string, { readOnly: boolean; kind: string }>();
  for (const { event, readOnly, kind } of rows) {
    const key = event.seriesId ? `${event.calendarId}\n${event.seriesId}` : event.id;
    const have = picked.get(key);
    if (!have || have.endAt < now) picked.set(key, event);
    meta.set(event.id, { readOnly, kind });
  }
  const all = [...picked.values()];
  const coming = all.filter((e) => e.endAt >= now).sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
  const past = all.filter((e) => e.endAt < now).sort((a, b) => b.startAt.getTime() - a.startAt.getTime());
  const own = await ownReminders(userId);
  return [...coming, ...past].slice(0, SEARCH_LIMIT).map((e) => eventDto(e, { readOnly: meta.get(e.id)!.readOnly }, meta.get(e.id)!.kind, own));
}

/* --------------------------------- Changes --------------------------------- */

const EMAIL = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** What the editor sent, checked, as the providers take it. */
export function toDraft(input: EventInput): EventDraft {
  const bad = () => new HttpError(400, "Invalid request", "bad_request");
  let start: Date;
  let end: Date;
  if (input.allDay) {
    if (!DATE.test(input.start) || !DATE.test(input.end)) throw bad();
    start = new Date(`${input.start}T00:00:00Z`);
    end = new Date(`${input.end}T00:00:00Z`);
    if (end <= start) end = new Date(start.getTime() + DAY);
  } else {
    start = new Date(input.start);
    end = new Date(input.end);
  }
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) throw bad();
  if (end < start) throw new HttpError(400, "The event ends before it starts.", "bad_times");
  if (end.getTime() - start.getTime() > 366 * DAY) throw new HttpError(400, "An event can last a year at most.", "too_long");
  const recurrence = input.recurrence?.replace(/^RRULE:/i, "").trim().toUpperCase() || null;
  if (recurrence && !/^FREQ=[A-Z]+(;[A-Z]+=[A-Z0-9,+:-]+)*$/.test(recurrence)) throw bad();
  const seen = new Set<string>();
  const attendees = input.attendees
    .map((a) => ({ name: a.name.trim().slice(0, 120), email: a.email.trim().toLowerCase() }))
    .filter((a) => EMAIL.test(a.email) && !seen.has(a.email) && seen.add(a.email));
  if (attendees.length > 100) throw new HttpError(400, "An event can have 100 guests at most.", "too_many_guests");
  return {
    title: input.title.trim().slice(0, 300),
    location: input.location.trim().slice(0, 300),
    description: input.description.trim().slice(0, 8000),
    start,
    end,
    allDay: input.allDay,
    timeZone: validZone(input.timeZone) ?? "UTC",
    recurrence,
    attendees,
  };
}

async function ownedCalendar(userId: string, calendarId: string) {
  const [row] = await db()
    .select({ calendar: calendars, source: sources })
    .from(calendars)
    .innerJoin(sources, eq(sources.id, calendars.sourceId))
    .where(and(eq(calendars.id, calendarId), eq(calendars.userId, userId)));
  if (!row) throw new HttpError(404, "Calendar not found", "not_found");
  return row;
}

async function ownedEvent(userId: string, eventId: string) {
  const [event] = await db()
    .select()
    .from(events)
    .where(and(eq(events.id, eventId), eq(events.userId, userId)));
  if (!event) throw new HttpError(404, "That event is no longer there.", "not_found");
  return { event, ...(await ownedCalendar(userId, event.calendarId)) };
}

const refOf = (e: EventRow): EventRef => ({ providerId: e.providerId, seriesId: e.seriesId, uid: e.uid, etag: e.etag, start: e.startAt, allDay: e.allDay });

/** After a change: read the calendar's window again, stretched to hold the changed event. */
async function resync(source: SourceRow, calendar: CalendarRow, around: { start: Date; end: Date }[], tz: string) {
  const base = calendar.syncedFrom && calendar.syncedTo ? { from: calendar.syncedFrom, to: calendar.syncedTo } : windowFor(new Date(), new Date());
  const from = new Date(Math.min(base.from.getTime(), ...around.map((a) => a.start.getTime() - DAY)));
  const to = new Date(Math.max(base.to.getTime(), ...around.map((a) => a.end.getTime() + DAY)));
  await syncCalendar(source, calendar, from, to, tz, true);
}

export async function createEvent(userId: string, input: EventInput, opts: { tz?: string } = {}): Promise<CalEvent | null> {
  const { calendar, source } = await ownedCalendar(userId, input.calendarId);
  if (calendar.readOnly) throw new HttpError(403, "This calendar can only be read.", "read_only");
  const draft = { ...toDraft(input), uid: `${crypto.randomUUID()}@kolbaba` };
  const tz = validZone(opts.tz) ?? (await zoneOf(userId));
  let provider: CalendarProvider;
  try {
    provider = await providerFor(source, calendar, tz);
    await provider.createEvent(calendar.providerId, draft);
    await resync(source, calendar, [draft], tz);
  } catch (err) {
    throw await providerFailure(source, err);
  }
  // Google and Microsoft give the event a UID of their own: it's the newest row with these times and this title.
  const [row] = await db()
    .select()
    .from(events)
    .where(and(eq(events.calendarId, calendar.id), provider.sendsInvitations ? and(eq(events.startAt, draft.start), eq(events.title, draft.title)) : eq(events.uid, draft.uid)))
    .orderBy(asc(events.startAt), sql`${events.updatedAt} desc`)
    .limit(1);
  if (row && draft.attendees.length && !provider.sendsInvitations) await invite(userId, source, calendar, provider, row, { kind: "created" }, tz);
  if (row && input.reminder !== undefined && !row.allDay) await saveReminder(userId, row, input.reminder, "all");
  return row ? eventDto(row, calendar, source.kind, await ownReminders(userId)) : null;
}

export async function updateEvent(userId: string, eventId: string, input: EventInput, scope: EditScope, opts: { tz?: string } = {}) {
  const { event, calendar, source } = await ownedEvent(userId, eventId);
  if (calendar.readOnly || !event.canEdit) throw new HttpError(403, "This event can't be changed here.", "read_only");
  const draft = toDraft(input);
  const tz = validZone(opts.tz) ?? (await zoneOf(userId));
  const before = event.attendees.map((a) => a.email);
  try {
    const provider = await providerFor(source, calendar, tz);
    const old = !provider.sendsInvitations && before.length ? await provider.readObject?.(calendar.providerId, refOf(event)) : null;
    await provider.updateEvent(calendar.providerId, refOf(event), draft, event.seriesId ? scope : "this");
    await resync(source, calendar, [draft, { start: event.startAt, end: event.endAt }], tz);
    if (!provider.sendsInvitations && (before.length || draft.attendees.length)) {
      const removed = before.filter((email) => !draft.attendees.some((a) => a.email === email));
      await invite(userId, source, calendar, provider, event, { kind: "updated", removed, old: old ?? null, scope: event.seriesId ? scope : "this" }, tz);
    }
    if (input.reminder !== undefined && !draft.allDay) await saveReminder(userId, event, input.reminder, scope);
  } catch (err) {
    // A conflict means the copy here was behind: bring it up to date so the user sees what changed.
    if (err instanceof CalendarConflictError) await resync(source, calendar, [{ start: event.startAt, end: event.endAt }], tz).catch(() => {});
    throw await providerFailure(source, err);
  }
}

export async function deleteEvent(userId: string, eventId: string, scope: EditScope, opts: { tz?: string } = {}) {
  const { event, calendar, source } = await ownedEvent(userId, eventId);
  if (calendar.readOnly) throw new HttpError(403, "This calendar can only be read.", "read_only");
  const tz = validZone(opts.tz) ?? (await zoneOf(userId));
  try {
    const provider = await providerFor(source, calendar, tz);
    // Guests are told it's off; that needs the event as it was.
    const guests = !provider.sendsInvitations && event.attendees.length && event.canEdit;
    const old = guests ? await provider.readObject?.(calendar.providerId, refOf(event)) : null;
    await provider.deleteEvent(calendar.providerId, refOf(event), event.seriesId ? scope : "this");
    if (old) await sendInvitations(userId, source, { kind: "cancelled", ics: old, event, scope: event.seriesId ? scope : "this", tz }).catch((err) => logWarn("[calendar] cancellation", err));
    await resync(source, calendar, [{ start: event.startAt, end: event.endAt }], tz);
    // Its own reminder time goes with it.
    const keys = [event.providerId, ...(scope === "all" && event.seriesId ? [event.seriesId] : [])];
    await db().delete(reminders).where(and(eq(reminders.calendarId, calendar.id), inArray(reminders.key, keys)));
  } catch (err) {
    throw await providerFailure(source, err);
  }
}

/** Emails the guests of an event kept at CalDAV or here, from the object as it now is. */
async function invite(userId: string, source: SourceRow, calendar: CalendarRow, provider: CalendarProvider, event: EventRow, change: InvitationChange, tz: string) {
  try {
    const [fresh] = await db()
      .select()
      .from(events)
      .where(and(eq(events.calendarId, calendar.id), eq(events.providerId, event.providerId)));
    const row = fresh ?? event;
    const ics = await provider.readObject?.(calendar.providerId, refOf(row));
    if (ics) await sendInvitations(userId, source, { ...change, ics, event: row, tz });
  } catch (err) {
    // The event is saved either way; an invitation that didn't go out is worth a line in the log, not a failed save.
    logWarn("[calendar] invitation", err);
  }
}

export async function respondToEvent(userId: string, eventId: string, status: Exclude<AttendeeStatus, "needsAction">, scope: EditScope) {
  const { event, calendar, source } = await ownedEvent(userId, eventId);
  if (calendar.readOnly || !event.myStatus) throw new HttpError(400, "This invitation can't be answered here.", "no_rsvp");
  const tz = await zoneOf(userId);
  const which = event.seriesId ? scope : "this";
  let told = true;
  try {
    const provider = await providerFor(source, calendar, tz);
    if (!provider.respond) throw new HttpError(400, "This invitation can't be answered here.", "no_rsvp");
    await provider.respond(calendar.providerId, refOf(event), status, which);
    if (!TELLS_ORGANIZER.has(source.kind)) {
      const ics = await provider.readObject?.(calendar.providerId, refOf(event));
      // The answer is in the calendar either way; the email is how the organizer learns of it.
      if (ics) told = await sendAnswer(userId, source, { ics, event, status, scope: which }).then(() => true, (err) => (logWarn("[calendar] answer", err), false));
    }
    await resync(source, calendar, [{ start: event.startAt, end: event.endAt }], tz);
  } catch (err) {
    throw await providerFailure(source, err);
  }
  if (!told) throw new HttpError(502, "Your answer is saved in your calendar, but the email to the organizer didn't go out. Try again.", "answer_not_sent");
}

/* ------------------------- Connecting and removing ------------------------- */

const newId = (prefix: string) => `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;

/** Reads a new account's calendars and the events around today; an account with nothing to show isn't kept. */
async function finishConnecting(source: SourceRow, tz: string) {
  try {
    await refreshCalendarList(source, tz);
  } catch (err) {
    await db().delete(sources).where(eq(sources.id, source.id));
    throw await providerFailure(source, err);
  }
  const [any] = await db().select({ id: calendars.id }).from(calendars).where(eq(calendars.sourceId, source.id)).limit(1);
  if (!any) {
    await db().delete(sources).where(eq(sources.id, source.id));
    throw new HttpError(404, "This account has no calendars.", "no_calendars");
  }
  await syncRange(source.userId, new Date(Date.now() - 7 * DAY), new Date(Date.now() + 30 * DAY)).catch((err) => logWarn("[calendar] first sync", err));
}

/** A Google or Microsoft account the user just allowed (src/app/api/accounts/…/callback). Connecting again renews the sign-in. */
export async function connectOAuth(userId: string, kind: "google" | "microsoft", grant: { email: string; refreshToken: string; accessToken: string; expiresAt: number; scope: string }, accountId?: string | null) {
  const tz = await zoneOf(userId);
  const credentials: CalendarCredentials = { kind: "oauth", issuer: kind, refreshToken: grant.refreshToken, accessToken: grant.accessToken, expiresAt: grant.expiresAt, scope: grant.scope };
  const email = grant.email.toLowerCase();
  const [existing] = await db()
    .select()
    .from(sources)
    .where(and(eq(sources.userId, userId), eq(sources.kind, kind), eq(sources.label, email)));
  // It belongs to the mailbox with the same address (the one it was started from, when that matches).
  const mailboxes = await db().select({ id: schema.accounts.id, email: schema.accounts.email }).from(schema.accounts).where(eq(schema.accounts.userId, userId));
  const mailbox = mailboxes.find((m) => m.id === accountId && m.email.toLowerCase() === email) ?? mailboxes.find((m) => m.email.toLowerCase() === email);
  if (existing) {
    await db()
      .update(sources)
      .set({ credentials: seal(credentials, existing.id), status: "ok", statusMessage: null, accountId: mailbox?.id ?? existing.accountId })
      .where(eq(sources.id, existing.id));
    await finishConnecting({ ...existing, credentials: seal(credentials, existing.id), status: "ok" }, tz);
    return existing.id;
  }
  const id = newId("cso");
  const [row] = await db()
    .insert(sources)
    .values({ id, userId, kind, accountId: mailbox?.id ?? null, label: email, credentials: seal(credentials, id) })
    .returning();
  await finishConnecting(row, tz);
  return id;
}

/**
 * A CalDAV account: the calendar of a mailbox that's already here (its own password signs in), or one
 * on its own with an address, a password and, when it can't be found from the address, the server.
 */
export async function connectCalDav(userId: string, input: { accountId?: string; email?: string; username?: string; password?: string; url?: string }) {
  const tz = await zoneOf(userId);
  let email: string;
  let login: { username: string; password: string };
  let accountId: string | null = null;
  if (input.accountId) {
    const [account] = await db()
      .select(ACCOUNT_COLUMNS)
      .from(schema.accounts)
      .where(and(eq(schema.accounts.id, input.accountId), eq(schema.accounts.userId, userId)));
    if (!account) throw new HttpError(404, "Mailbox not found", "not_found");
    const c = unseal<MailboxCredentials>(account.credentials, account.id);
    if (c.kind !== "password") throw new HttpError(400, "This mailbox's calendar is connected by signing in.", "needs_oauth");
    email = account.email;
    login = { username: account.imap?.username ?? account.email, password: c.password };
    accountId = account.id;
  } else {
    email = (input.email ?? "").trim().toLowerCase();
    if (!EMAIL.test(email) || !input.password) throw new HttpError(400, "Fill in the address and the password.", "bad_request");
    login = { username: input.username?.trim() || email, password: input.password };
  }
  const [existing] = await db()
    .select({ id: sources.id })
    .from(sources)
    .where(and(eq(sources.userId, userId), eq(sources.kind, "caldav"), eq(sources.label, email)));
  if (existing) throw new HttpError(409, "This calendar account is already here.", "exists");

  let home: { homeUrl: string } | null;
  try {
    home = await discoverCalDav({ email, login, url: input.url?.trim() || undefined });
  } catch (err) {
    if (err instanceof CalendarAuthError) {
      const text = accountId ? tk("The calendar didn't accept this mailbox's password. Some providers want a separate app password for calendars.") : tk("The calendar didn't accept this name and password.");
      throw new HttpError(401, text, "calendar_auth");
    }
    logWarn("[calendar] caldav discovery", err);
    home = null;
  }
  if (!home) {
    const text = input.url ? tk("No calendar answered at that address.") : tk("No calendar was found for this address. If you know the CalDAV server's address, fill it in.");
    throw new HttpError(404, text, "no_caldav");
  }
  const id = newId("cso");
  const [row] = await db()
    .insert(sources)
    .values({ id, userId, kind: "caldav", accountId, label: email, url: home.homeUrl, credentials: accountId ? null : seal({ kind: "password", ...login } satisfies CalendarCredentials, id) })
    .returning();
  await finishConnecting(row, tz);
  return id;
}

/** The one "account" that holds the calendars made in Kolbaba and imported files. */
async function localSource(userId: string): Promise<SourceRow> {
  const [existing] = await db()
    .select()
    .from(sources)
    .where(and(eq(sources.userId, userId), eq(sources.kind, "local")));
  if (existing) return existing;
  const [row] = await db().insert(sources).values({ userId, kind: "local", label: "" }).returning();
  return row;
}

async function nextHue(userId: string) {
  const taken = (await db().select({ hue: calendars.hue }).from(calendars).where(eq(calendars.userId, userId))).map((c) => c.hue);
  return HUES.find((h) => !taken.some((t) => Math.abs(t - h) < 14)) ?? HUES[taken.length % HUES.length];
}

export async function createLocalCalendar(userId: string, name: string, hue?: number): Promise<Calendar> {
  const source = await localSource(userId);
  const [row] = await db()
    .insert(calendars)
    .values({ userId, sourceId: source.id, providerId: newId("own"), name: name.trim().slice(0, 80) || "Calendar", hue: hue ?? (await nextHue(userId)), primary: false })
    .returning();
  return calendarDto(row);
}

/** A file's events go into one of Kolbaba's own calendars: an existing one, or a new one named after the file. */
export async function importIcs(userId: string, input: { calendarId?: string; name?: string; text: string }): Promise<{ calendar: Calendar; count: number }> {
  const tz = await zoneOf(userId);
  let calendar: CalendarRow;
  let created = false;
  if (input.calendarId) {
    const owned = await ownedCalendar(userId, input.calendarId);
    if (owned.source.kind !== "local") throw new HttpError(400, "Files can be imported into Kolbaba's own calendars.", "not_local");
    calendar = owned.calendar;
  } else {
    const dto = await createLocalCalendar(userId, input.name ?? "");
    [calendar] = await db().select().from(calendars).where(eq(calendars.id, dto.id));
    created = true;
  }
  let result: Awaited<ReturnType<typeof importObjects>>;
  try {
    result = await importObjects(calendar.id, input.text, tz);
  } catch {
    if (created) await db().delete(calendars).where(eq(calendars.id, calendar.id));
    throw new HttpError(422, "This file isn't a calendar (.ics).", "bad_ics");
  }
  if (!result.count) {
    if (created) await db().delete(calendars).where(eq(calendars.id, calendar.id));
    throw new HttpError(422, "There are no events in this file.", "empty_ics");
  }
  if (created && (result.name || result.color)) {
    const patch = { ...(result.name && !input.name ? { name: result.name.slice(0, 80) } : {}), ...(result.color ? { hue: hueOf(result.color, calendar.hue) } : {}) };
    if (Object.keys(patch).length) [calendar] = await db().update(calendars).set(patch).where(eq(calendars.id, calendar.id)).returning();
  }
  await db().update(calendars).set({ syncedAt: null }).where(eq(calendars.id, calendar.id));
  return { calendar: calendarDto(calendar), count: result.count };
}

/** A calendar that lives at a link (.ics) and updates by itself: holidays, a timetable, someone's shared calendar. */
export async function addFeed(userId: string, rawUrl: string, name?: string): Promise<Calendar> {
  const url = feedUrl(rawUrl);
  let host: string;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && !(env.selfHosted && parsed.protocol === "http:")) throw new Error("not https");
    host = parsed.hostname;
  } catch {
    throw new HttpError(400, "That isn't a link to a calendar. It starts with https:// or webcal://.", "bad_url");
  }
  const [existing] = await db()
    .select({ id: sources.id })
    .from(sources)
    .where(and(eq(sources.userId, userId), eq(sources.kind, "feed"), eq(sources.url, url)));
  if (existing) throw new HttpError(409, "You already follow this calendar.", "exists");
  const tz = await zoneOf(userId);
  const [source] = await db().insert(sources).values({ userId, kind: "feed", label: host, url }).returning();
  try {
    const [calendar] = await db()
      .insert(calendars)
      .values({ userId, sourceId: source.id, providerId: newId("feed"), name: name?.trim().slice(0, 80) || host, hue: await nextHue(userId), readOnly: true })
      .returning();
    const fresh = await refreshFeed(calendar.id, url, {}, tz);
    const patch = {
      syncState: fresh.state,
      ...(fresh.name && !name?.trim() ? { name: fresh.name.slice(0, 80) } : {}),
      ...(fresh.color ? { hue: hueOf(fresh.color, calendar.hue) } : {}),
    };
    const [saved] = await db().update(calendars).set(patch).where(eq(calendars.id, calendar.id)).returning();
    return calendarDto(saved);
  } catch (err) {
    await db().delete(sources).where(eq(sources.id, source.id));
    if (err instanceof HttpError) throw err;
    logWarn("[calendar] feed", err);
    throw new HttpError(422, "No calendar could be read from that link.", "bad_feed");
  }
}

export async function updateCalendar(userId: string, calendarId: string, patch: { visible?: boolean; hue?: number; name?: string }): Promise<Calendar> {
  const { calendar, source } = await ownedCalendar(userId, calendarId);
  // A provider's calendar keeps the name it has there; here it gets a colour and a tick.
  const rename = patch.name !== undefined && (source.kind === "local" || source.kind === "feed");
  const [row] = await db()
    .update(calendars)
    .set({
      ...(patch.visible !== undefined ? { visible: patch.visible } : {}),
      ...(patch.hue !== undefined ? { hue: patch.hue } : {}),
      ...(rename && patch.name!.trim() ? { name: patch.name!.trim().slice(0, 80) } : {}),
    })
    .where(eq(calendars.id, calendar.id))
    .returning();
  return calendarDto(row);
}

/** Removes one of Kolbaba's own calendars with its events, or stops following a feed. A provider's calendar is unticked instead. */
export async function deleteCalendar(userId: string, calendarId: string) {
  const { calendar, source } = await ownedCalendar(userId, calendarId);
  if (source.kind === "feed") return void (await db().delete(sources).where(eq(sources.id, source.id)));
  if (source.kind !== "local") throw new HttpError(400, "This calendar lives at its provider. Untick it, or disconnect the account.", "not_local");
  await db().delete(calendars).where(eq(calendars.id, calendar.id));
}

/** Disconnects a calendar account: its calendars and their events here go; nothing changes at the provider. */
export async function removeSource(userId: string, sourceId: string) {
  const [source] = await db()
    .select()
    .from(sources)
    .where(and(eq(sources.id, sourceId), eq(sources.userId, userId)));
  if (!source) throw new HttpError(404, "Calendar not found", "not_found");
  await db().delete(sources).where(eq(sources.id, source.id));
  // Google: the permission goes too, unless the same address is still a mailbox or a calendar account somewhere.
  if (source.kind !== "google" || !source.credentials) return;
  const [mailbox] = await db()
    .select({ id: schema.accounts.id })
    .from(schema.accounts)
    .where(and(eq(schema.accounts.provider, "gmail"), eq(schema.accounts.email, source.label)))
    .limit(1);
  const [other] = await db()
    .select({ id: sources.id })
    .from(sources)
    .where(and(eq(sources.kind, "google"), eq(sources.label, source.label)))
    .limit(1);
  if (mailbox || other) return;
  try {
    const c = unseal<CalendarCredentials>(source.credentials, source.id);
    if (c.kind === "oauth") await revokeGoogleToken(c.refreshToken);
  } catch (err) {
    logWarn("[calendar] revoke", err);
  }
}
