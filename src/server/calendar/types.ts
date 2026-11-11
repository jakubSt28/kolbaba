import type { AttendeeStatus, EventAttendee } from "@/lib/calendar/types";
import type { Person } from "../db/schema";

/**
 * What every kind of calendar account does for Kolbaba (Google, Microsoft, CalDAV, and Kolbaba's own
 * calendars and feeds, which keep iCalendar objects in the database). The service in ./service.ts
 * keeps a copy of the events of a window of time and re-reads that window after every change, so a
 * provider never has to say what a change did to a repeating event.
 */

/** A calendar as its provider lists it. */
export interface ProviderCalendar {
  /** Google calendar id, Graph calendar id, or the CalDAV collection's URL. */
  providerId: string;
  name: string;
  /** "#rrggbb" when the provider has one. */
  color: string | null;
  readOnly: boolean;
  /** The account's main calendar. */
  primary: boolean;
  /** Ticked in the provider's own app (Google keeps that); true when the provider doesn't say. */
  shown: boolean;
}

/** One occurrence in a window of time: a repeating event comes back as one of these per occurrence. */
export interface ProviderEvent {
  /** Unique within its calendar and the same every time this occurrence is listed. */
  providerId: string;
  /** For an occurrence of a repeating event: what identifies the whole series at the provider. */
  seriesId: string | null;
  /** The iCalendar UID. */
  uid: string | null;
  etag: string | null;
  title: string;
  location: string;
  /** Plain text. */
  description: string;
  /** Timed: the instants. All-day: midnight UTC of the first day and of the day after the last. */
  start: Date;
  end: Date;
  allDay: boolean;
  /** IANA zone the event was made in, when known. */
  timeZone: string | null;
  /** The series' rule without "RRULE:" ("FREQ=WEEKLY;BYDAY=TU"); null for a single event. */
  recurrence: string | null;
  organizer: Person | null;
  attendees: EventAttendee[];
  /** The calendar owner's answer when someone else invited them. */
  myStatus: AttendeeStatus | null;
  /** https link to join the call. */
  joinUrl: string | null;
  /** https link to the event at the provider. */
  url: string | null;
  /** The owner may change and delete it (false for other people's events they were invited to). */
  canEdit: boolean;
}

/** An event to create, or the new state of one being changed. */
export interface EventDraft {
  title: string;
  location: string;
  description: string;
  /** As in ProviderEvent. */
  start: Date;
  end: Date;
  allDay: boolean;
  /** IANA zone the times were picked in. */
  timeZone: string;
  /** Rule without "RRULE:", or null. */
  recurrence: string | null;
  attendees: { name: string; email: string }[];
  /** Creating only: the iCalendar UID to give it, so the caller can find the event again. */
  uid?: string;
}

/** Which stored event a change is about (the columns of calendar_events that providers need). */
export interface EventRef {
  providerId: string;
  seriesId: string | null;
  uid: string | null;
  etag: string | null;
  /** The occurrence's start as listed. */
  start: Date;
  allDay: boolean;
}

/** A repeating event: only this occurrence, or the whole series. Ignored for single events. */
export type Scope = "this" | "all";

export interface CalendarProvider {
  listCalendars(): Promise<ProviderCalendar[]>;
  /** Every occurrence that overlaps [from, to), cancelled ones left out. */
  listEvents(calendarId: string, from: Date, to: Date): Promise<ProviderEvent[]>;
  /** Invitations to `draft.attendees` are the provider's job when it sends them itself (see `sendsInvitations`). */
  createEvent(calendarId: string, draft: EventDraft): Promise<void>;
  updateEvent(calendarId: string, ref: EventRef, draft: EventDraft, scope: Scope): Promise<void>;
  deleteEvent(calendarId: string, ref: EventRef, scope: Scope): Promise<void>;
  /** Answer an invitation; providers that can't leave it out. */
  respond?(calendarId: string, ref: EventRef, status: Exclude<AttendeeStatus, "needsAction">, scope: Scope): Promise<void>;
  /** The event's iCalendar object as stored (CalDAV, Kolbaba's own calendars): what an emailed invitation is made from. */
  readObject?(calendarId: string, ref: EventRef): Promise<string | null>;
  /** Google and Microsoft email the guests themselves; for the rest Kolbaba sends the invitation (./invitations.ts). */
  readonly sendsInvitations: boolean;
}

/** The provider said no to our sign-in: the user has to connect the account again. */
export class CalendarAuthError extends Error {}

/** The event changed at the provider since we read it (CalDAV If-Match failed): read again, then retry. */
export class CalendarConflictError extends Error {}
