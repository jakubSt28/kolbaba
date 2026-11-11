import type { Person } from "../types";

/**
 * The calendar as the app sees it. Calendars come from "sources": a Google or Microsoft account, a
 * CalDAV account (Seznam, iCloud, Fastmail, a company's own server), a link to an .ics file that
 * updates by itself ("feed"), or Kolbaba's own calendars ("local": made here or imported from a file).
 */

export type CalendarSourceKind = "google" | "microsoft" | "caldav" | "feed" | "local";

export interface CalendarSource {
  id: string;
  kind: CalendarSourceKind;
  /** The mailbox it came with, if any: shown under that mailbox's name and picture. */
  accountId: string | null;
  /** Whose calendars these are: the sign-in address, or where a feed comes from. */
  label: string;
  status: "ok" | "auth_error" | "error";
  statusMessage: string | null;
}

export interface Calendar {
  id: string;
  sourceId: string;
  name: string;
  /** 0–360, drawn like mailbox colours. */
  hue: number;
  /** Ticked in the list. */
  visible: boolean;
  readOnly: boolean;
  /** The account's main calendar. */
  primary: boolean;
}

export type AttendeeStatus = "accepted" | "tentative" | "declined" | "needsAction";

export interface EventAttendee {
  name: string;
  email: string;
  status: AttendeeStatus;
}

/** One event as it shows in the grid: a repeating event is one of these per occurrence. */
export interface CalEvent {
  id: string;
  calendarId: string;
  title: string;
  location: string;
  description: string;
  /** ISO instants for timed events; YYYY-MM-DD for all-day ones (`end` is the day after the last). */
  start: string;
  end: string;
  allDay: boolean;
  /** One occurrence of a repeating event. */
  recurring: boolean;
  /** How it repeats, as an iCalendar rule without the "RRULE:" ("FREQ=WEEKLY;BYDAY=TU"), when known. */
  recurrence: string | null;
  organizer: Person | null;
  attendees: EventAttendee[];
  /** The user's own answer, when they're invited by someone else. */
  myStatus: AttendeeStatus | null;
  /** The link to join the call (Meet, Teams, Zoom…). */
  joinUrl: string | null;
  /** The event at its provider (Google Calendar, Outlook). */
  url: string | null;
  /** The user may change or delete it here. */
  canEdit: boolean;
  /** The user may answer the invitation here. */
  canRespond: boolean;
  /** This event's own reminder (minutes before; null: none). Not set: the user's usual reminder. */
  reminder?: number | null;
}

/** What the editor sends to create or change an event. */
export interface EventInput {
  calendarId: string;
  title: string;
  location: string;
  description: string;
  /** As in CalEvent. */
  start: string;
  end: string;
  allDay: boolean;
  /** IANA zone the times were picked in ("Europe/Prague"): a repeating event keeps its hour across clock changes. */
  timeZone: string;
  recurrence: string | null;
  /** People to invite. */
  attendees: { name: string; email: string }[];
  /** This event's own reminder (minutes before; null: none). Not set: leave it as it is. */
  reminder?: number | null;
}

/** A change to a repeating event applies to this occurrence only, or to the whole series. */
export type EditScope = "this" | "all";

export type CalendarView = "month" | "week" | "day";

/** Minutes before an event the reminder comes; null turns reminders off. */
export const REMINDER_CHOICES = [0, 5, 10, 15, 30, 60] as const;
export const DEFAULT_REMINDER = 10;
/** What one event can have instead of the usual reminder. */
export const EVENT_REMINDER_CHOICES = [0, 5, 10, 15, 30, 60, 120, 1440] as const;

/** Saved with the user, so every device opens the calendar the same way. */
export interface CalendarSettings {
  /** When the calendar was first opened (ms). */
  seenAt?: number;
  view?: CalendarView;
  /** Minutes before; null = no reminders; not set = DEFAULT_REMINDER. */
  reminder?: number | null;
  /** Mailboxes whose calendar the user chose not to add: not offered again. */
  skipped?: string[];
  /** The zone the app last ran in: reminders, agents and times without a zone use it. */
  timeZone?: string;
}

/** A mailbox whose calendar isn't here yet, and how it would be added. */
export interface CalendarSuggestion {
  accountId: string;
  /** Google and Microsoft ask for permission on their own page; CalDAV tries the mailbox's own password. */
  how: "google" | "microsoft" | "caldav";
}

/** What opening the calendar loads. */
export interface CalendarBootstrap {
  sources: CalendarSource[];
  calendars: Calendar[];
  settings: CalendarSettings;
  /** Mailboxes without a calendar here that the user hasn't said no to. */
  suggestions: CalendarSuggestion[];
  /** Which kinds of account can be connected on this server. */
  can: { google: boolean; microsoft: boolean };
}
