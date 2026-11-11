import { eq, like } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { EventInput } from "@/lib/calendar/types";
import { seal } from "../crypto";
import { db, schema } from "../db";
import { sendEventReminders } from "./reminders";
import {
  calendarBootstrap,
  calendarSettings,
  createEvent,
  createLocalCalendar,
  deleteCalendar,
  deleteEvent,
  hueOf,
  importIcs,
  listEvents,
  respondToEvent,
  saveCalendarSettings,
  searchEvents,
  setEventReminder,
  syncRange,
  toDraft,
  updateCalendar,
  updateEvent,
} from "./service";

const notifyUser = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("../push", async (original) => ({ ...(await original<typeof import("../push")>()), notifyUser }));

// Answers to invitations go out by email: that part is faked.
type SentMail = { to: { email: string }[]; subject: string; icalEvent?: { method: string; content: string } };
const adapter = vi.hoisted(() => ({ send: vi.fn<(mail: SentMail) => Promise<object>>(async () => ({})) }));
vi.mock("../mail/adapters", async (original) => ({
  ...(await original<typeof import("../mail/adapters")>()),
  withAdapter: async (_row: unknown, fn: (a: typeof adapter) => Promise<unknown>) => fn(adapter),
}));

const DOMAIN = "calendar-test.invalid";
let me = "";
let other = "";

beforeEach(async () => {
  notifyUser.mockClear();
  adapter.send.mockClear();
  await db().delete(schema.users).where(like(schema.users.email, `%@${DOMAIN}`));
  const rows = await db()
    .insert(schema.users)
    .values([{ email: `me@${DOMAIN}`, settings: { calendar: { timeZone: "Europe/Prague" } } }, { email: `other@${DOMAIN}` }])
    .returning();
  [me, other] = rows.map((r) => r.id);
});
afterAll(async () => {
  await db().delete(schema.users).where(like(schema.users.email, `%@${DOMAIN}`));
});

const input = (calendarId: string, patch: Partial<EventInput> = {}): EventInput => ({
  calendarId,
  title: "Planning",
  location: "Room 2",
  description: "",
  start: "2026-11-12T09:00:00.000Z",
  end: "2026-11-12T10:00:00.000Z",
  allDay: false,
  timeZone: "Europe/Prague",
  recurrence: null,
  attendees: [],
  ...patch,
});
const november = [new Date("2026-11-01T00:00:00Z"), new Date("2026-12-01T00:00:00Z")] as const;

const FILE = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "PRODID:-//Example//Test//EN",
  "X-WR-CALNAME:Club",
  "BEGIN:VEVENT",
  "UID:training@example.com",
  "DTSTAMP:20261101T000000Z",
  "DTSTART;TZID=Europe/Prague:20261103T180000",
  "DTEND;TZID=Europe/Prague:20261103T193000",
  "RRULE:FREQ=WEEKLY;COUNT=3",
  "SUMMARY:Training",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:match@example.com",
  "DTSTAMP:20261101T000000Z",
  "DTSTART;VALUE=DATE:20261121",
  "DTEND;VALUE=DATE:20261123",
  "SUMMARY:Tournament",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

describe("the calendar's own calendars", () => {
  it("makes an event, changes it and deletes it", async () => {
    const calendar = await createLocalCalendar(me, "Family", 28);
    const made = await createEvent(me, input(calendar.id));
    expect(made).toMatchObject({ title: "Planning", location: "Room 2", start: "2026-11-12T09:00:00.000Z", end: "2026-11-12T10:00:00.000Z", allDay: false, recurring: false, canEdit: true });

    await updateEvent(me, made!.id, input(calendar.id, { title: "Planning, moved", start: "2026-11-13T12:00:00.000Z", end: "2026-11-13T13:30:00.000Z" }), "this");
    const [moved] = await listEvents(me, ...november);
    expect(moved).toMatchObject({ id: made!.id, title: "Planning, moved", start: "2026-11-13T12:00:00.000Z", end: "2026-11-13T13:30:00.000Z" });

    await deleteEvent(me, made!.id, "this");
    expect(await listEvents(me, ...november)).toEqual([]);
  });

  it("keeps all-day events as dates", async () => {
    const calendar = await createLocalCalendar(me, "Trips");
    const made = await createEvent(me, input(calendar.id, { title: "Vienna", allDay: true, start: "2026-11-20", end: "2026-11-23" }));
    expect(made).toMatchObject({ allDay: true, start: "2026-11-20", end: "2026-11-23" });
  });

  it("repeats an event, changes one occurrence, then drops one", async () => {
    const calendar = await createLocalCalendar(me, "Work");
    // 10:00 in Prague, every Thursday.
    await createEvent(me, input(calendar.id, { title: "Standup", recurrence: "FREQ=WEEKLY;BYDAY=TH" }));
    let events = await listEvents(me, ...november);
    expect(events.map((e) => e.start)).toEqual(["2026-11-12T09:00:00.000Z", "2026-11-19T09:00:00.000Z", "2026-11-26T09:00:00.000Z"]);
    expect(events.every((e) => e.recurring && e.recurrence === "FREQ=WEEKLY;BYDAY=TH")).toBe(true);

    await updateEvent(me, events[1].id, input(calendar.id, { title: "Standup (late)", start: "2026-11-19T13:00:00.000Z", end: "2026-11-19T14:00:00.000Z", recurrence: "FREQ=WEEKLY;BYDAY=TH" }), "this");
    events = await listEvents(me, ...november);
    expect(events.map((e) => [e.title, e.start])).toEqual([
      ["Standup", "2026-11-12T09:00:00.000Z"],
      ["Standup (late)", "2026-11-19T13:00:00.000Z"],
      ["Standup", "2026-11-26T09:00:00.000Z"],
    ]);

    await deleteEvent(me, events[2].id, "this");
    expect((await listEvents(me, ...november)).map((e) => e.start)).toEqual(["2026-11-12T09:00:00.000Z", "2026-11-19T13:00:00.000Z"]);

    await deleteEvent(me, events[0].id, "all");
    expect(await listEvents(me, ...november)).toEqual([]);
  });

  it("imports a file into a new calendar named after it, and again without doubling", async () => {
    const { calendar, count } = await importIcs(me, { text: FILE });
    expect(count).toBe(2);
    expect(calendar.name).toBe("Club");
    await syncRange(me, ...november);
    const events = await listEvents(me, ...november);
    expect(events.map((e) => [e.title, e.start, e.allDay])).toEqual([
      ["Training", "2026-11-03T17:00:00.000Z", false],
      ["Training", "2026-11-10T17:00:00.000Z", false],
      ["Training", "2026-11-17T17:00:00.000Z", false],
      ["Tournament", "2026-11-21", true],
    ]);
    await importIcs(me, { text: FILE, calendarId: calendar.id });
    await syncRange(me, ...november, { force: true });
    expect(await listEvents(me, ...november)).toHaveLength(4);
  });

  it("turns away what isn't a calendar", async () => {
    await expect(importIcs(me, { text: "hello" })).rejects.toMatchObject({ code: "bad_ics" });
    await expect(importIcs(me, { text: "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n" })).rejects.toMatchObject({ code: "empty_ics" });
    // Nothing is left behind.
    expect((await calendarBootstrap(me)).calendars).toEqual([]);
  });

  it("shows only ticked calendars, and only one's own", async () => {
    const mine = await createLocalCalendar(me, "Mine");
    const theirs = await createLocalCalendar(other, "Theirs");
    await createEvent(me, input(mine.id));
    await createEvent(other, input(theirs.id, { title: "Private" }));
    expect((await listEvents(me, ...november)).map((e) => e.title)).toEqual(["Planning"]);
    await expect(createEvent(me, input(theirs.id))).rejects.toMatchObject({ status: 404 });
    await expect(updateCalendar(me, theirs.id, { visible: false })).rejects.toMatchObject({ status: 404 });

    await updateCalendar(me, mine.id, { visible: false });
    expect(await listEvents(me, ...november)).toEqual([]);
    expect(await listEvents(me, ...november, { includeHidden: true })).toHaveLength(1);
  });

  it("deletes a calendar with what's in it", async () => {
    const calendar = await createLocalCalendar(me, "Old");
    await createEvent(me, input(calendar.id));
    await deleteCalendar(me, calendar.id);
    expect((await calendarBootstrap(me)).calendars).toEqual([]);
    expect(await db().select().from(schema.calendarEvents).where(eq(schema.calendarEvents.userId, me))).toEqual([]);
  });

  it("merges settings key by key", async () => {
    await saveCalendarSettings(me, { view: "month" });
    await saveCalendarSettings(me, { reminder: null, skipped: ["acc_1"] });
    expect(await calendarSettings(me)).toEqual({ timeZone: "Europe/Prague", view: "month", reminder: null, skipped: ["acc_1"] });
  });
});

describe("what the editor may send", () => {
  it("checks times, rules and guests", () => {
    expect(() => toDraft(input("c", { end: "2026-11-12T08:00:00.000Z" }))).toThrow();
    expect(() => toDraft(input("c", { recurrence: "FREQ=WEEKLY\r\nATTENDEE:mailto:x@example.com" }))).toThrow();
    expect(() => toDraft(input("c", { start: "yesterday" }))).toThrow();
    const draft = toDraft(input("c", { recurrence: "rrule:freq=weekly;byday=th", attendees: [{ name: " Petra ", email: "PETRA@example.com" }, { name: "", email: "petra@example.com" }, { name: "", email: "nobody" }], timeZone: "Mars/Olympus" }));
    expect(draft.recurrence).toBe("FREQ=WEEKLY;BYDAY=TH");
    expect(draft.attendees).toEqual([{ name: "Petra", email: "petra@example.com" }]);
    expect(draft.timeZone).toBe("UTC");
  });

  it("gives a one-day all-day event its day", () => {
    const draft = toDraft(input("c", { allDay: true, start: "2026-11-20", end: "2026-11-20" }));
    expect([draft.start.toISOString(), draft.end.toISOString()]).toEqual(["2026-11-20T00:00:00.000Z", "2026-11-21T00:00:00.000Z"]);
  });

  it("reads a provider's colour as a hue", () => {
    expect(hueOf("#ff0000", 1)).toBe(0);
    expect(hueOf("#00ff00", 1)).toBe(120);
    expect(hueOf("#808080", 1)).toBe(228);
    expect(hueOf(null, 77)).toBe(77);
  });
});

describe("reminders", () => {
  const withPush = (userId: string) => db().insert(schema.pushSubscriptions).values({ userId, endpoint: `https://push.example/${userId}`, p256dh: "k", auth: "a" });

  it("reminds once, ten minutes before, and again when the event moves", async () => {
    await withPush(me);
    const calendar = await createLocalCalendar(me, "Work");
    const made = await createEvent(me, input(calendar.id));
    const start = new Date("2026-11-12T09:00:00.000Z");

    expect(await sendEventReminders(new Date(start.getTime() - 30 * 60_000))).toBe(0);
    expect(await sendEventReminders(new Date(start.getTime() - 9 * 60_000))).toBe(1);
    expect(notifyUser).toHaveBeenCalledWith(me, expect.objectContaining({ title: "Planning", body: "Starts at 10:00 · Room 2", url: `/?calendar=2026-11-12&event=${made!.id}` }));
    expect(await sendEventReminders(new Date(start.getTime() - 8 * 60_000))).toBe(0);

    await updateEvent(me, made!.id, input(calendar.id, { start: "2026-11-12T11:00:00.000Z", end: "2026-11-12T12:00:00.000Z" }), "this");
    expect(await sendEventReminders(new Date("2026-11-12T10:55:00.000Z"))).toBe(1);
  });

  it("stays quiet when reminders are off, for all-day events and without a device to notify", async () => {
    const calendar = await createLocalCalendar(me, "Work");
    await createEvent(me, input(calendar.id));
    const soon = new Date("2026-11-12T08:55:00.000Z");
    // No device with notifications yet.
    expect(await sendEventReminders(soon)).toBe(0);
    await withPush(me);
    await saveCalendarSettings(me, { reminder: null });
    expect(await sendEventReminders(soon)).toBe(0);
    await saveCalendarSettings(me, { reminder: 5 });
    await createEvent(me, input(calendar.id, { title: "Day off", allDay: true, start: "2026-11-12", end: "2026-11-13" }));
    expect(await sendEventReminders(soon)).toBe(1);
    expect(notifyUser).toHaveBeenCalledTimes(1);
  });
});

describe("an event's own reminder", () => {
  const withPush = (userId: string) => db().insert(schema.pushSubscriptions).values({ userId, endpoint: `https://push.example/${userId}`, p256dh: "k", auth: "a" });
  const at = (iso: string, minutesBefore: number) => new Date(new Date(iso).getTime() - minutesBefore * 60_000);

  it("reminds at its own time, a day ahead too, or not at all", async () => {
    await withPush(me);
    const calendar = await createLocalCalendar(me, "Work");
    const made = await createEvent(me, input(calendar.id, { reminder: 60 }));
    expect(made!.reminder).toBe(60);
    expect(await sendEventReminders(at("2026-11-12T09:00:00Z", 90))).toBe(0);
    expect(await sendEventReminders(at("2026-11-12T09:00:00Z", 59))).toBe(1);

    const flight = await createEvent(me, input(calendar.id, { title: "Flight", start: "2026-11-20T09:00:00.000Z", end: "2026-11-20T10:00:00.000Z" }));
    await setEventReminder(me, flight!.id, 1440, "this");
    expect(await sendEventReminders(at("2026-11-20T09:00:00Z", 1500))).toBe(0);
    expect(await sendEventReminders(at("2026-11-20T09:00:00Z", 1430))).toBe(1);
    expect(notifyUser).toHaveBeenLastCalledWith(me, expect.objectContaining({ title: "Flight", body: expect.stringMatching(/^Starts on .*20.* at 10:00/) }));

    const lunch = await createEvent(me, input(calendar.id, { title: "Lunch", start: "2026-11-25T11:00:00.000Z", end: "2026-11-25T12:00:00.000Z" }));
    await setEventReminder(me, lunch!.id, null, "this");
    expect((await listEvents(me, ...november)).find((e) => e.id === lunch!.id)!.reminder).toBeNull();
    expect(await sendEventReminders(at("2026-11-25T11:00:00Z", 5))).toBe(0);
    // The usual time again: nothing of its own is kept.
    await setEventReminder(me, lunch!.id, 10, "this");
    expect((await listEvents(me, ...november)).find((e) => e.id === lunch!.id)!.reminder).toBeUndefined();
    expect(await db().select().from(schema.calendarReminders).where(eq(schema.calendarReminders.key, lunch!.id))).toEqual([]);
    expect(await sendEventReminders(at("2026-11-25T11:00:00Z", 5))).toBe(1);
  });

  it("is one for a whole series, with an occurrence that may differ", async () => {
    await withPush(me);
    const calendar = await createLocalCalendar(me, "Work");
    await createEvent(me, input(calendar.id, { title: "Stand-up", recurrence: "FREQ=WEEKLY;BYDAY=TH" }));
    const weeks = async () => (await listEvents(me, ...november)).map((e) => [e.start.slice(0, 10), e.reminder]);
    const [, second, third] = await listEvents(me, ...november);

    await setEventReminder(me, second.id, 30, "all");
    expect(await weeks()).toEqual([["2026-11-12", 30], ["2026-11-19", 30], ["2026-11-26", 30]]);
    await setEventReminder(me, third.id, 5, "this");
    expect(await weeks()).toEqual([["2026-11-12", 30], ["2026-11-19", 30], ["2026-11-26", 5]]);
    expect(await sendEventReminders(at("2026-11-19T09:00:00Z", 25))).toBe(1);
    expect(await sendEventReminders(at("2026-11-26T09:00:00Z", 25))).toBe(0);
    // The series' time set from that occurrence takes its own away.
    await setEventReminder(me, third.id, 15, "all");
    expect(await weeks()).toEqual([["2026-11-12", 15], ["2026-11-19", 15], ["2026-11-26", 15]]);
  });

  it("isn't for all-day events or other people's", async () => {
    const calendar = await createLocalCalendar(me, "Trips");
    const trip = await createEvent(me, input(calendar.id, { title: "Vienna", allDay: true, start: "2026-11-20", end: "2026-11-23" }));
    await expect(setEventReminder(me, trip!.id, 30, "this")).rejects.toMatchObject({ status: 400 });
    const made = await createEvent(me, input(calendar.id));
    await expect(setEventReminder(other, made!.id, 30, "this")).rejects.toMatchObject({ status: 404 });
  });
});

describe("search", () => {
  const now = new Date("2026-11-13T00:00:00Z");
  const titles = async (userId: string, query: string, deep = false) => (await searchEvents(userId, query, { now, deep })).map((e) => e.title);

  it("finds every word in the title, place, notes or guests, whatever the accents", async () => {
    const calendar = await createLocalCalendar(me, "Work");
    await createEvent(me, input(calendar.id, { title: "Schůzka s Evou", location: "Kavárna Nádraží", description: "Přinést smlouvu", start: "2026-11-20T09:00:00.000Z", end: "2026-11-20T10:00:00.000Z" }));
    await createEvent(me, input(calendar.id, { title: "Review", attendees: [{ name: "Tom Example", email: "tom@example.com" }], start: "2026-11-21T09:00:00.000Z", end: "2026-11-21T10:00:00.000Z" }));
    expect(await titles(me, "evou SCHUZKA")).toEqual(["Schůzka s Evou"]);
    expect(await titles(me, "KAVARNA")).toEqual(["Schůzka s Evou"]);
    expect(await titles(me, "smlouvu")).toEqual(["Schůzka s Evou"]);
    expect(await titles(me, "tom@example")).toEqual(["Review"]);
    expect(await titles(me, "schuzka tom")).toEqual([]);
    expect(await titles(me, "   ")).toEqual([]);
    // A percent sign is looked for as it is.
    expect(await titles(me, "%")).toEqual([]);
    expect(await titles(other, "schuzka")).toEqual([]);
    await updateCalendar(me, calendar.id, { visible: false });
    expect(await titles(me, "schuzka")).toEqual([]);
  });

  it("shows a repeating event once, what's coming first and then the past from the newest", async () => {
    const calendar = await createLocalCalendar(me, "Work");
    await createEvent(me, input(calendar.id, { title: "Team stand-up", recurrence: "FREQ=WEEKLY;BYDAY=TH" }));
    await createEvent(me, input(calendar.id, { title: "Team offsite", start: "2026-12-03T09:00:00.000Z", end: "2026-12-03T16:00:00.000Z" }));
    await createEvent(me, input(calendar.id, { title: "Team dinner", start: "2026-10-20T18:00:00.000Z", end: "2026-10-20T20:00:00.000Z" }));
    await createEvent(me, input(calendar.id, { title: "Team kick-off", start: "2026-10-05T09:00:00.000Z", end: "2026-10-05T10:00:00.000Z" }));
    const found = await searchEvents(me, "team", { now });
    expect(found.map((e) => [e.title, e.start.slice(0, 10)])).toEqual([
      ["Team stand-up", "2026-11-19"],
      ["Team offsite", "2026-12-03"],
      ["Team dinner", "2026-10-20"],
      ["Team kick-off", "2026-10-05"],
    ]);
    // Asking the calendars first reads the whole two years once, and finds the same.
    expect(await titles(me, "team", true)).toEqual(found.map((e) => e.title));
    const [row] = await db().select().from(schema.calendars).where(eq(schema.calendars.id, calendar.id));
    expect(row.syncState.searchedAt).toBeGreaterThan(0);
  });
});

describe("answering an invitation", () => {
  const INVITATION = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Example//Test//EN",
    "BEGIN:VEVENT",
    "UID:offsite@example.com",
    "DTSTAMP:20261101T000000Z",
    "SEQUENCE:2",
    "DTSTART;TZID=Europe/Prague:20261118T100000",
    "DTEND;TZID=Europe/Prague:20261118T110000",
    "SUMMARY:Offsite planning",
    "DESCRIPTION:Agenda in the doc.",
    "ORGANIZER;CN=Eva Example:mailto:eva@example.com",
    `ATTENDEE;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:me@${DOMAIN}`,
    "ATTENDEE;PARTSTAT=ACCEPTED:mailto:tom@example.com",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

  it("saves the answer in the calendar and emails it to the organizer", async () => {
    const id = "acc_calendar_test";
    await db().insert(schema.accounts).values({ id, userId: me, provider: "imap", email: `me@${DOMAIN}`, name: "Me", hue: 200, credentials: seal({ kind: "password", password: "x" }, id), status: "ok" });
    await importIcs(me, { text: INVITATION });
    await syncRange(me, ...november);
    const [invited] = await listEvents(me, ...november);
    expect(invited).toMatchObject({ title: "Offsite planning", myStatus: "needsAction", canRespond: true, canEdit: false });

    await respondToEvent(me, invited.id, "accepted", "this");
    const [answered] = await listEvents(me, ...november);
    expect(answered.myStatus).toBe("accepted");
    expect(adapter.send).toHaveBeenCalledTimes(1);
    const mail = adapter.send.mock.calls[0][0];
    expect(mail).toMatchObject({ to: [{ name: "Eva Example", email: "eva@example.com" }], subject: "Accepted: Offsite planning", icalEvent: { method: "REPLY" } });
    const reply = mail.icalEvent!.content;
    expect(reply).toContain("METHOD:REPLY");
    expect(reply).toContain("UID:offsite@example.com");
    expect(reply).toContain("SEQUENCE:2");
    expect(reply.replace(/\r\n /g, "")).toMatch(new RegExp(`ATTENDEE;PARTSTAT=ACCEPTED:mailto:me@${DOMAIN}`));
    expect(reply).not.toContain("tom@example.com");
    expect(reply).not.toContain("Agenda");

    await respondToEvent(me, invited.id, "declined", "this");
    expect((await listEvents(me, ...november))[0].myStatus).toBe("declined");
    expect(adapter.send.mock.calls[1][0].subject).toBe("Declined: Offsite planning");
  });

  it("is only for invitations, and only one's own", async () => {
    const calendar = await createLocalCalendar(me, "Work");
    const made = await createEvent(me, input(calendar.id));
    await expect(respondToEvent(me, made!.id, "accepted", "this")).rejects.toMatchObject({ status: 400 });
    await expect(respondToEvent(other, made!.id, "accepted", "this")).rejects.toMatchObject({ status: 404 });
    expect(adapter.send).not.toHaveBeenCalled();
  });
});
