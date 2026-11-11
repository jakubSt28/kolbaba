import { and, eq, gt, isNull, lt, or, sql } from "drizzle-orm";
import { db, schema } from "../db";
import { buildObject, expandObject, objectBounds, parseCalendar, removeOccurrence, setPartstat, splitProviderId, updateObject } from "./ics";
import { safeFetch } from "./net";
import type { CalendarProvider, EventRef, ProviderEvent } from "./types";

/**
 * Kolbaba's own calendars, imported files and feeds: iCalendar objects in the database, read the way
 * a CalDAV server's would be. A feed's objects are replaced whenever its file changes.
 */

const objects = schema.calendarObjects;
const sqlExcluded = (column: string) => sql.raw(`excluded.${column}`);

/** A feed is asked again at most this often (publishers of holiday and timetable calendars ask for no more). */
export const FEED_EVERY_MS = 15 * 60_000;
/** One file may hold this many events; the rest is left out. */
export const MAX_OBJECTS = 5000;

const PARTSTAT = { accepted: "ACCEPTED", tentative: "TENTATIVE", declined: "DECLINED" } as const;

export function createLocalProvider(calendarId: string, opts: { tz: string; me: string[] }): CalendarProvider {
  const load = async (uid: string) => {
    const [row] = await db()
      .select()
      .from(objects)
      .where(and(eq(objects.calendarId, calendarId), eq(objects.uid, uid)));
    return row;
  };
  const save = async (uid: string, ics: string) => {
    const bounds = objectBounds(ics, { tz: opts.tz });
    await db()
      .insert(objects)
      .values({ calendarId, uid, ics, ...bounds })
      .onConflictDoUpdate({ target: [objects.calendarId, objects.uid], set: { ics, ...bounds, updatedAt: new Date() } });
  };
  const organizer = (attendees: unknown[]) => (attendees.length && opts.me[0] ? { name: "", email: opts.me[0] } : null);

  return {
    sendsInvitations: false,
    async listCalendars() {
      return [];
    },
    async listEvents(_id, from, to) {
      const rows = await db()
        .select({ uid: objects.uid, ics: objects.ics })
        .from(objects)
        .where(and(eq(objects.calendarId, calendarId), or(isNull(objects.firstAt), lt(objects.firstAt, to)), or(isNull(objects.lastAt), gt(objects.lastAt, from))));
      const out: ProviderEvent[] = [];
      for (const row of rows) {
        try {
          out.push(...expandObject(row.ics, from, to, { tz: opts.tz, key: row.uid, me: opts.me }));
        } catch {
          // One unreadable event mustn't hide the rest of the calendar.
        }
      }
      return out;
    },
    async createEvent(_id, draft) {
      const { uid, ics } = buildObject(draft, { uid: draft.uid, organizer: organizer(draft.attendees), clientSchedules: true });
      await save(uid, ics);
    },
    async updateEvent(_id, ref, draft, scope) {
      const { key, rid } = splitProviderId(ref.providerId);
      const row = await load(key);
      if (!row) return;
      await save(key, updateObject(row.ics, draft, rid ? scope : "all", rid, { organizer: organizer(draft.attendees), clientSchedules: true }));
    },
    async deleteEvent(_id, ref, scope) {
      const { key, rid } = splitProviderId(ref.providerId);
      const row = await load(key);
      if (!row) return;
      if (rid && scope === "this") await save(key, removeOccurrence(row.ics, rid));
      else await db().delete(objects).where(eq(objects.id, row.id));
    },
    async readObject(_id, ref: EventRef) {
      return (await load(splitProviderId(ref.providerId).key))?.ics ?? null;
    },
    async respond(_id, ref, status, scope) {
      const { key, rid } = splitProviderId(ref.providerId);
      const row = await load(key);
      if (!row) return;
      const ics = setPartstat(row.ics, opts.me, PARTSTAT[status], rid ? scope : "all", rid);
      if (ics !== row.ics) await save(key, ics);
    },
  };
}

/** Puts a file's events into a calendar; ones it already has (the same UID) are replaced. Returns how many went in. */
export async function importObjects(calendarId: string, text: string, tz: string): Promise<{ count: number; name: string | null; color: string | null }> {
  const parsed = parseCalendar(text, { tz });
  const rows = parsed.objects.slice(0, MAX_OBJECTS);
  for (let i = 0; i < rows.length; i += 200) {
    await db()
      .insert(objects)
      .values(rows.slice(i, i + 200).map((o) => ({ calendarId, uid: o.uid, ics: o.ics, firstAt: o.firstAt, lastAt: o.lastAt })))
      .onConflictDoUpdate({
        target: [objects.calendarId, objects.uid],
        set: { ics: sqlExcluded("ics"), firstAt: sqlExcluded("first_at"), lastAt: sqlExcluded("last_at"), updatedAt: new Date() },
      });
  }
  return { count: rows.length, name: parsed.name, color: parsed.color };
}

export interface FeedState {
  etag?: string;
  lastModified?: string;
}

/** "webcal://…" is how calendars publish these links; it's plain https underneath. */
export const feedUrl = (url: string) => url.trim().replace(/^webcals?:\/\//i, "https://");

/**
 * Downloads a feed and replaces the calendar's events with what it says now. An unchanged file
 * (the server answers 304) is left alone. Returns what to remember for the next time.
 */
export async function refreshFeed(calendarId: string, url: string, state: FeedState, tz: string): Promise<{ state: FeedState; name: string | null; color: string | null; changed: boolean }> {
  const res = await safeFetch(feedUrl(url), {
    headers: {
      accept: "text/calendar, text/plain;q=0.8, */*;q=0.5",
      "user-agent": "Kolbaba-Calendar/1.0",
      ...(state.etag ? { "if-none-match": state.etag } : {}),
      ...(state.lastModified ? { "if-modified-since": state.lastModified } : {}),
    },
    timeoutMs: 20_000,
  });
  if (res.status === 304) return { state, name: null, color: null, changed: false };
  if (res.status < 200 || res.status >= 300) throw new Error(`The calendar link answered HTTP ${res.status}`);
  const parsed = parseCalendar(res.text, { tz });
  const rows = parsed.objects.slice(0, MAX_OBJECTS);
  await db().transaction(async (tx) => {
    await tx.delete(objects).where(eq(objects.calendarId, calendarId));
    for (let i = 0; i < rows.length; i += 200) {
      await tx
        .insert(objects)
        .values(rows.slice(i, i + 200).map((o) => ({ calendarId, uid: o.uid, ics: o.ics, firstAt: o.firstAt, lastAt: o.lastAt })))
        .onConflictDoNothing();
    }
  });
  return {
    state: { etag: res.headers.get("etag") ?? undefined, lastModified: res.headers.get("last-modified") ?? undefined },
    name: parsed.name,
    color: parsed.color,
    changed: true,
  };
}
