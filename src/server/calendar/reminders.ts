import { and, eq, exists, gt, isNotNull, isNull, lte, ne, or, sql } from "drizzle-orm";
import { DEFAULT_REMINDER, EVENT_REMINDER_CHOICES } from "@/lib/calendar/types";
import { intlLocale, translate } from "@/lib/i18n";
import { db, schema } from "../db";
import { logWarn } from "../log";
import { notifyUser } from "../push";
import { syncRange, validZone } from "./service";

/**
 * Reminders: a notification a few minutes before a timed event starts (ten unless the user chose
 * otherwise, or gave the event a time of its own; never for events they declined or calendars they
 * unticked). They're the user's own appointments, so quiet hours don't hold them back.
 */

const events = schema.calendarEvents;
const calendars = schema.calendars;
const users = schema.users;
const own = schema.calendarReminders;

/** The longest usual lead there is (src/lib/calendar/types.ts REMINDER_CHOICES), with a minute to spare. */
const HORIZON_MS = 61 * 60_000;
/** The same for events with a reminder time of their own. */
const OWN_HORIZON_MS = (Math.max(...EVENT_REMINDER_CHOICES) + 1) * 60_000;

const hasPush = (userId: typeof events.userId | typeof users.id) =>
  exists(
    db()
      .select({ one: sql`1` })
      .from(schema.pushSubscriptions)
      .where(eq(schema.pushSubscriptions.userId, userId)),
  );

/** Sends what's due. Each start is reminded once: a moved event reminds again for its new time. */
export async function sendEventReminders(now = new Date()) {
  const coming = (within: number) =>
    and(
      eq(calendars.visible, true),
      eq(events.allDay, false),
      gt(events.startAt, now),
      lte(events.startAt, new Date(now.getTime() + within)),
      or(isNull(events.remindedFor), ne(events.remindedFor, events.startAt)),
      or(isNull(events.myStatus), ne(events.myStatus, "declined")),
      hasPush(events.userId),
    );
  const [soon, special] = await Promise.all([
    db()
      .select({ event: events, settings: users.settings })
      .from(events)
      .innerJoin(calendars, eq(calendars.id, events.calendarId))
      .innerJoin(users, eq(users.id, events.userId))
      .where(coming(HORIZON_MS)),
    // Events with a time of their own can be due a day ahead; they're few, so they're looked up apart.
    db()
      .select({ event: events, settings: users.settings, key: own.key, minutes: own.minutes })
      .from(own)
      .innerJoin(events, and(eq(events.calendarId, own.calendarId), or(eq(events.providerId, own.key), eq(events.seriesId, own.key))))
      .innerJoin(calendars, eq(calendars.id, events.calendarId))
      .innerJoin(users, eq(users.id, events.userId))
      .where(coming(OWN_HORIZON_MS)),
  ]);
  // The occurrence's own time wins over its series'.
  const leads = new Map<string, number | null>();
  for (const row of special) if (row.key === row.event.providerId || !leads.has(row.event.id)) leads.set(row.event.id, row.minutes);
  const due = [...new Map([...soon, ...special].map((row) => [row.event.id, { event: row.event, settings: row.settings }])).values()];
  let sent = 0;
  for (const { event, settings } of due) {
    const usual = settings.calendar?.reminder === undefined ? DEFAULT_REMINDER : settings.calendar.reminder;
    const lead = leads.has(event.id) ? leads.get(event.id)! : usual;
    if (lead === null) continue;
    const minutes = (event.startAt.getTime() - now.getTime()) / 60_000;
    if (minutes > lead) continue;
    // Claimed first, so two rounds (or two workers) can't both send it.
    const [claimed] = await db()
      .update(events)
      .set({ remindedFor: event.startAt })
      .where(and(eq(events.id, event.id), or(isNull(events.remindedFor), ne(events.remindedFor, event.startAt))))
      .returning({ id: events.id });
    if (!claimed) continue;
    const locale = settings.locale === "cs" ? "cs" : "en";
    const zone = validZone(settings.calendar?.timeZone) ?? "UTC";
    const time = new Intl.DateTimeFormat(intlLocale(locale), { hour: "numeric", minute: "2-digit", timeZone: zone }).format(event.startAt);
    const left = Math.max(0, Math.round(minutes));
    // A reminder from the day before says which day it's for.
    const far = minutes > 12 * 60;
    const date = far ? new Intl.DateTimeFormat(intlLocale(locale), { weekday: "long", day: "numeric", month: "long", timeZone: zone }).format(event.startAt) : "";
    const whenText = left < 1 ? translate(locale, "Starts now") : far ? translate(locale, "Starts on {date} at {time}", { date, time }) : translate(locale, "Starts at {time}", { time });
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(event.startAt);
    await notifyUser(event.userId, {
      title: event.title || translate(locale, "(No title)"),
      body: [whenText, event.location].filter(Boolean).join(" · "),
      url: `/?calendar=${day}&event=${event.id}`,
      tag: `event-${event.id}`,
    }).catch((err) => logWarn("[calendar] reminder", err));
    sent++;
  }
  return sent;
}

/**
 * Keeps the coming day fresh for people who get reminders, so an event made in another app an hour
 * ago still reminds here. Only for accounts at a provider, and only for devices with notifications on.
 */
export async function refreshForReminders(now = new Date()) {
  const rows = await db()
    .selectDistinct({ userId: schema.calendarSources.userId })
    .from(schema.calendarSources)
    .innerJoin(users, eq(users.id, schema.calendarSources.userId))
    .where(
      and(
        ne(schema.calendarSources.kind, "local"),
        eq(schema.calendarSources.status, "ok"),
        hasPush(users.id),
        // Reminders are on, or some event has one of its own.
        or(sql`${users.settings}->'calendar'->'reminder' is distinct from 'null'::jsonb`, exists(db().select({ one: sql`1` }).from(own).where(and(eq(own.userId, users.id), isNotNull(own.minutes))))),
      ),
    );
  for (const { userId } of rows) {
    await syncRange(userId, now, new Date(now.getTime() + 26 * 3600_000), { freshMs: 9 * 60_000 }).catch((err) => logWarn("[calendar] refresh", err));
  }
  return rows.length;
}
