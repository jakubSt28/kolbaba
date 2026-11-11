import { z } from "zod";
import { EVENT_REMINDER_CHOICES, REMINDER_CHOICES } from "@/lib/calendar/types";

/** What the calendar's API takes (src/app/api/calendar). */

const when = z.string().min(10).max(40);

/** Minutes before the start, one of the choices; null: no reminder. */
const eventReminder = z
  .number()
  .int()
  .refine((n) => (EVENT_REMINDER_CHOICES as readonly number[]).includes(n))
  .nullable();

export const EventBody = z.object({
  calendarId: z.string().min(1).max(64),
  title: z.string().max(600),
  location: z.string().max(600),
  description: z.string().max(16_000),
  start: when,
  end: when,
  allDay: z.boolean(),
  timeZone: z.string().max(64),
  recurrence: z.string().max(300).nullable(),
  attendees: z.array(z.object({ name: z.string().max(200), email: z.string().max(320) })).max(200),
  reminder: eventReminder.optional(),
});

export const ScopeParam = z.enum(["this", "all"]);

export const EventPatch = z.object({ event: EventBody, scope: ScopeParam });

export const RespondBody = z.object({ status: z.enum(["accepted", "tentative", "declined"]), scope: ScopeParam });

export const ReminderBody = z.object({ minutes: eventReminder, scope: ScopeParam });

export const SyncBody = z.object({
  from: when,
  to: when,
  tz: z.string().max(64).optional(),
  /** "Refresh": read everything again, however fresh it is. */
  force: z.boolean().optional(),
});

export const CalendarBody = z.object({ name: z.string().min(1).max(160), hue: z.number().int().min(0).max(360).optional() });

export const CalendarPatch = z.object({ visible: z.boolean().optional(), hue: z.number().int().min(0).max(360).optional(), name: z.string().max(160).optional() });

export const SourceBody = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("caldav"),
    /** The calendar of a mailbox that's already here, signed in with its password. */
    accountId: z.string().max(64).optional(),
    email: z.string().max(320).optional(),
    username: z.string().max(320).optional(),
    password: z.string().max(1000).optional(),
    url: z.string().max(2000).optional(),
  }),
  z.object({ kind: z.literal("feed"), url: z.string().min(8).max(2000), name: z.string().max(160).optional() }),
]);

/** A file read in the browser; 3 MB of text is thousands of events and fits one request. */
export const ImportBody = z.object({ calendarId: z.string().max(64).optional(), name: z.string().max(160).optional(), text: z.string().min(1).max(3_000_000) });

export const SettingsBody = z.object({
  view: z.enum(["month", "week", "day"]).optional(),
  reminder: z.union([z.literal(REMINDER_CHOICES[0]), ...REMINDER_CHOICES.slice(1).map((n) => z.literal(n))]).nullable().optional(),
  skipped: z.array(z.string().max(64)).max(100).optional(),
  timeZone: z.string().max(64).optional(),
  /** The calendar was opened: remembered once, for good. */
  seen: z.literal(true).optional(),
});

/** A moment from a query string or a body; anything else is the client's bug. */
export function instant(value: string | null): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}
