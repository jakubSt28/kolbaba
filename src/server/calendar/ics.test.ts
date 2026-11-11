import { describe, expect, it } from "vitest";
import { buildObject, expandObject, itipMessage, itipReply, objectBounds, parseCalendar, removeOccurrence, setPartstat, splitProviderId, updateObject } from "./ics";
import type { EventDraft } from "./types";

const cal = (...lines: string[]) => ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Example//Test//EN", ...lines, "END:VCALENDAR"].join("\r\n") + "\r\n";
const event = (...lines: string[]) => ["BEGIN:VEVENT", ...lines, "END:VEVENT"];
const one = (...lines: string[]) => cal(...event(...lines));

const OCTOBER = [new Date("2026-10-01T00:00:00Z"), new Date("2026-11-08T00:00:00Z")] as const;
const KEY = "https://dav.example.com/cal/work/standup.ics";
const opts = { tz: "Europe/Prague", key: KEY, me: ["me@example.com"] };
const expand = (ics: string, more: Partial<typeof opts> & { etag?: string } = {}, window: readonly [Date, Date] = OCTOBER) => expandObject(ics, window[0], window[1], { ...opts, ...more });
const starts = (ics: string, window: readonly [Date, Date] = OCTOBER) => expand(ics, {}, window).map((e) => e.start.toISOString());
const lines = (ics: string) => ics.split("\r\n");
/** The events of an object, without the zone descriptions before them (which have RRULEs of their own). */
const eventsOf = (ics: string) => ics.slice(ics.indexOf("BEGIN:VEVENT"));

/** Every Tuesday 09:00 in Prague from 13 October: summer time ends on the 25th. */
const WEEKLY = ["UID:standup@example.com", "DTSTAMP:20261001T080000Z", "DTSTART;TZID=Europe/Prague:20261013T090000", "DTEND;TZID=Europe/Prague:20261013T093000", "SUMMARY:Stand-up"];

const draft = (over: Partial<EventDraft> = {}): EventDraft => ({
  title: "Planning",
  location: "Room 2",
  description: "Bring the numbers.",
  start: new Date("2026-10-06T07:00:00Z"),
  end: new Date("2026-10-06T08:00:00Z"),
  allDay: false,
  timeZone: "Europe/Prague",
  recurrence: null,
  attendees: [],
  ...over,
});

describe("expandObject: single events", () => {
  it("reads a timed event with a TZID and everything around it", () => {
    const ics = one(
      "UID:plan@example.com",
      "DTSTART;TZID=Europe/Prague:20261006T090000",
      "DTEND;TZID=Europe/Prague:20261006T100000",
      "SUMMARY:Planning\\, Q4",
      "LOCATION:Room 2\\; first floor",
      "DESCRIPTION:Agenda:\\n1. Numbers\\nJoin: https://meet.google.com/abc-defg-hij",
      'ORGANIZER;CN="Dana Organizer":mailto:Dana@Example.com',
      "ATTENDEE;CN=Me Myself;PARTSTAT=TENTATIVE:MAILTO:me@example.com",
      "ATTENDEE;PARTSTAT=ACCEPTED:mailto:dana@example.com",
      "ATTENDEE;CN=Room 2;CUTYPE=ROOM:urn:uuid:1234",
    );
    const [e, ...rest] = expand(ics, { etag: '"e1"' });
    expect(rest).toEqual([]);
    expect(e).toMatchObject({
      providerId: KEY,
      seriesId: null,
      uid: "plan@example.com",
      etag: '"e1"',
      title: "Planning, Q4",
      location: "Room 2; first floor",
      description: "Agenda:\n1. Numbers\nJoin: https://meet.google.com/abc-defg-hij",
      allDay: false,
      timeZone: "Europe/Prague",
      recurrence: null,
      organizer: { name: "Dana Organizer", email: "dana@example.com" },
      myStatus: "tentative",
      joinUrl: "https://meet.google.com/abc-defg-hij",
      url: null,
      canEdit: false,
    });
    expect(e.start.toISOString()).toBe("2026-10-06T07:00:00.000Z");
    expect(e.end.toISOString()).toBe("2026-10-06T08:00:00.000Z");
    expect(e.attendees).toEqual([
      { name: "Me Myself", email: "me@example.com", status: "tentative" },
      { name: "", email: "dana@example.com", status: "accepted" },
    ]);
  });

  it("lets the owner edit their own events and has no answer for them", () => {
    const ics = one("UID:a", "DTSTART:20261006T090000Z", "ORGANIZER:mailto:me@example.com", "ATTENDEE;PARTSTAT=ACCEPTED:mailto:me@example.com", "ATTENDEE:mailto:guest@example.com");
    const [e] = expand(ics);
    expect(e).toMatchObject({ canEdit: true, myStatus: null });
    expect(e.attendees[1]).toEqual({ name: "", email: "guest@example.com", status: "needsAction" });
    // Without knowing who the owner is, nothing is locked.
    expect(expand(one("UID:a", "DTSTART:20261006T090000Z", "ORGANIZER:mailto:dana@example.com"), { me: [] })[0].canEdit).toBe(true);
  });

  it("reads all-day events: several days, and one day when there is no end", () => {
    const [trip] = expand(one("UID:trip", "DTSTART;VALUE=DATE:20261010", "DTEND;VALUE=DATE:20261013", "SUMMARY:Trip"));
    expect(trip).toMatchObject({ allDay: true, timeZone: null });
    expect([trip.start.toISOString(), trip.end.toISOString()]).toEqual(["2026-10-10T00:00:00.000Z", "2026-10-13T00:00:00.000Z"]);
    const [day] = expand(one("UID:day", "DTSTART;VALUE=DATE:20261010"));
    expect(day.end.toISOString()).toBe("2026-10-11T00:00:00.000Z");
  });

  it("puts floating times in the owner's zone", () => {
    const ics = one("UID:f", "DTSTART:20261006T090000", "DTEND:20261006T100000");
    expect(expand(ics)[0].start.toISOString()).toBe("2026-10-06T07:00:00.000Z");
    const [e] = expand(ics, { tz: "America/New_York" });
    expect(e.start.toISOString()).toBe("2026-10-06T13:00:00.000Z");
    expect(e.timeZone).toBeNull();
  });

  it("knows UTC times, Windows zone names, prefixed zone names and zones only the file describes", () => {
    expect(starts(one("UID:z", "DTSTART:20261006T090000Z"))).toEqual(["2026-10-06T09:00:00.000Z"]);
    const windows = expand(one("UID:w", 'DTSTART;TZID="Central Europe Standard Time":20261006T090000'))[0];
    expect([windows.start.toISOString(), windows.timeZone]).toEqual(["2026-10-06T07:00:00.000Z", "Europe/Prague"]);
    const prefixed = expand(one("UID:p", "DTSTART;TZID=/freeassociation.sourceforge.net/Europe/Prague:20261106T090000"))[0];
    expect([prefixed.start.toISOString(), prefixed.timeZone]).toEqual(["2026-11-06T08:00:00.000Z", "Europe/Prague"]);

    const own = cal(
      "BEGIN:VTIMEZONE",
      "TZID:Head Office",
      "BEGIN:STANDARD",
      "DTSTART:16011028T030000",
      "TZOFFSETFROM:+0300",
      "TZOFFSETTO:+0200",
      "RRULE:FREQ=YEARLY;BYDAY=-1SU;BYMONTH=10",
      "END:STANDARD",
      "BEGIN:DAYLIGHT",
      "DTSTART:16010325T020000",
      "TZOFFSETFROM:+0200",
      "TZOFFSETTO:+0300",
      "RRULE:FREQ=YEARLY;BYDAY=-1SU;BYMONTH=3",
      "END:DAYLIGHT",
      "END:VTIMEZONE",
      ...event("UID:o", "DTSTART;TZID=Head Office:20261006T090000", "RRULE:FREQ=MONTHLY;COUNT=2"),
    );
    const office = expand(own);
    expect(office.map((e) => e.start.toISOString())).toEqual(["2026-10-06T06:00:00.000Z", "2026-11-06T07:00:00.000Z"]);
    expect(office[0].timeZone).toBeNull();
  });

  it("takes the length from DURATION, and none when the event has no end", () => {
    const [long] = expand(one("UID:d", "DTSTART:20261006T090000Z", "DURATION:PT1H30M"));
    expect(long.end.toISOString()).toBe("2026-10-06T10:30:00.000Z");
    const [point] = expand(one("UID:n", "DTSTART:20261006T090000Z"));
    expect(point.end.toISOString()).toBe("2026-10-06T09:00:00.000Z");
    // An event without length belongs to the window it starts in.
    expect(expandObject(one("UID:n", "DTSTART:20261006T090000Z"), new Date("2026-10-06T09:00:00Z"), new Date("2026-10-07T00:00:00Z"), opts)).toHaveLength(1);
    expect(expandObject(one("UID:n", "DTSTART:20261006T090000Z"), new Date("2026-10-05T00:00:00Z"), new Date("2026-10-06T09:00:00Z"), opts)).toHaveLength(0);
  });

  it("leaves out what is outside the window or cancelled", () => {
    const ics = one("UID:a", "DTSTART:20261006T090000Z", "DTEND:20261006T100000Z");
    expect(expandObject(ics, new Date("2026-10-06T10:00:00Z"), new Date("2026-10-07T00:00:00Z"), opts)).toEqual([]);
    expect(expandObject(ics, new Date("2026-10-06T09:59:00Z"), new Date("2026-10-07T00:00:00Z"), opts)).toHaveLength(1);
    expect(expand(one("UID:a", "DTSTART:20261006T090000Z", "STATUS:CANCELLED"))).toEqual([]);
  });

  it("falls back to Outlook's HTML description and cuts long ones", () => {
    const [html] = expand(one("UID:h", "DTSTART:20261006T090000Z", "X-ALT-DESC;FMTTYPE=text/html:<html><body><p>Hello <b>all</b>\\,</p><p>see you &amp; bye</p></body></html>"));
    expect(html.description).toBe("Hello all,\nsee you & bye");
    const [long] = expand(one("UID:l", "DTSTART:20261006T090000Z", `DESCRIPTION:${"x".repeat(9000)}`));
    expect(long.description).toHaveLength(8000);
  });

  it("throws for text that isn't a calendar object", () => {
    expect(() => expand("hello")).toThrow();
    expect(() => expand(cal())).toThrow();
  });
});

describe("expandObject: repeating events", () => {
  it("keeps a weekly event at its hour when the clocks change", () => {
    const events = expand(one(...WEEKLY, "RRULE:FREQ=WEEKLY"));
    expect(events.map((e) => e.start.toISOString())).toEqual(["2026-10-13T07:00:00.000Z", "2026-10-20T07:00:00.000Z", "2026-10-27T08:00:00.000Z", "2026-11-03T08:00:00.000Z"]);
    expect(events.map((e) => e.end.toISOString())[2]).toBe("2026-10-27T08:30:00.000Z");
    expect(events[0]).toMatchObject({ providerId: `${KEY}#20261013T070000Z`, seriesId: KEY, recurrence: "FREQ=WEEKLY", timeZone: "Europe/Prague", title: "Stand-up" });
    expect(events[2].providerId).toBe(`${KEY}#20261027T080000Z`);
  });

  it("stops at COUNT and at UNTIL (the last one included)", () => {
    expect(starts(one(...WEEKLY, "RRULE:FREQ=WEEKLY;COUNT=2"))).toEqual(["2026-10-13T07:00:00.000Z", "2026-10-20T07:00:00.000Z"]);
    expect(starts(one(...WEEKLY, "RRULE:FREQ=WEEKLY;UNTIL=20261027T080000Z"))).toEqual(["2026-10-13T07:00:00.000Z", "2026-10-20T07:00:00.000Z", "2026-10-27T08:00:00.000Z"]);
    expect(starts(one(...WEEKLY, "RRULE:FREQ=WEEKLY;UNTIL=20261027T075959Z"))).toHaveLength(2);
    expect(starts(one(...WEEKLY, "RRULE:FREQ=WEEKLY;UNTIL=20261027"))).toHaveLength(3);
  });

  it("leaves out EXDATEs, however they are written", () => {
    const left = ["2026-10-13T07:00:00.000Z", "2026-11-03T08:00:00.000Z"];
    expect(starts(one(...WEEKLY, "RRULE:FREQ=WEEKLY", "EXDATE;TZID=Europe/Prague:20261020T090000,20261027T090000"))).toEqual(left);
    expect(starts(one(...WEEKLY, "RRULE:FREQ=WEEKLY", "EXDATE:20261020T070000Z", "EXDATE:20261027T080000Z"))).toEqual(left);
    expect(starts(one(...WEEKLY, "RRULE:FREQ=WEEKLY", "EXDATE;VALUE=DATE:20261020", "EXDATE;VALUE=DATE:20261027"))).toEqual(left);
  });

  const MOVED = cal(
    ...event(...WEEKLY, "RRULE:FREQ=WEEKLY"),
    ...event("UID:standup@example.com", "RECURRENCE-ID;TZID=Europe/Prague:20261020T090000", "DTSTART;TZID=Europe/Prague:20261021T140000", "DTEND;TZID=Europe/Prague:20261021T150000", "SUMMARY:Stand-up (moved)"),
  );

  it("puts an override in place of its occurrence", () => {
    const events = expand(MOVED);
    expect(events.map((e) => e.start.toISOString())).toEqual(["2026-10-13T07:00:00.000Z", "2026-10-21T12:00:00.000Z", "2026-10-27T08:00:00.000Z", "2026-11-03T08:00:00.000Z"]);
    // It is still named after the start it had in the series.
    expect(events[1]).toMatchObject({ providerId: `${KEY}#20261020T070000Z`, seriesId: KEY, title: "Stand-up (moved)", recurrence: "FREQ=WEEKLY" });
    expect(events[1].end.toISOString()).toBe("2026-10-21T13:00:00.000Z");
  });

  it("follows an override that moved out of the window or into it", () => {
    const tuesday = [new Date("2026-10-20T00:00:00Z"), new Date("2026-10-21T00:00:00Z")] as const;
    const wednesday = [new Date("2026-10-21T00:00:00Z"), new Date("2026-10-22T00:00:00Z")] as const;
    expect(expand(MOVED, {}, tuesday)).toEqual([]);
    expect(expand(MOVED, {}, wednesday).map((e) => e.providerId)).toEqual([`${KEY}#20261020T070000Z`]);
  });

  it("leaves out a cancelled occurrence and a cancelled series", () => {
    const cancelledOne = cal(...event(...WEEKLY, "RRULE:FREQ=WEEKLY;COUNT=3"), ...event("UID:standup@example.com", "RECURRENCE-ID:20261020T070000Z", "DTSTART:20261020T070000Z", "STATUS:CANCELLED"));
    expect(starts(cancelledOne)).toEqual(["2026-10-13T07:00:00.000Z", "2026-10-27T08:00:00.000Z"]);
    expect(starts(one(...WEEKLY, "RRULE:FREQ=WEEKLY;COUNT=3", "STATUS:CANCELLED"))).toEqual([]);
  });

  it("repeats all-day events by date", () => {
    const events = expand(one("UID:bday", "DTSTART;VALUE=DATE:20261030", "RRULE:FREQ=DAILY;COUNT=3", "EXDATE;VALUE=DATE:20261031"));
    expect(events.map((e) => [e.providerId, e.start.toISOString(), e.end.toISOString(), e.allDay])).toEqual([
      [`${KEY}#20261030`, "2026-10-30T00:00:00.000Z", "2026-10-31T00:00:00.000Z", true],
      [`${KEY}#20261101`, "2026-11-01T00:00:00.000Z", "2026-11-02T00:00:00.000Z", true],
    ]);
  });

  it("names the occurrences of a floating series by wall time, so they don't change with the owner's zone", () => {
    const ics = one("UID:f", "DTSTART:20261013T090000", "RRULE:FREQ=WEEKLY;COUNT=2");
    expect(expand(ics).map((e) => e.providerId)).toEqual([`${KEY}#20261013T090000`, `${KEY}#20261020T090000`]);
    expect(expand(ics, { tz: "America/New_York" }).map((e) => [e.providerId, e.start.toISOString()])).toEqual([
      [`${KEY}#20261013T090000`, "2026-10-13T13:00:00.000Z"],
      [`${KEY}#20261020T090000`, "2026-10-20T13:00:00.000Z"],
    ]);
  });

  it("expands RDATE-only series, with no rule to show", () => {
    const events = expand(one("UID:r", "DTSTART:20261006T090000Z", "RDATE:20261008T090000Z,20261009T100000Z"));
    expect(events.map((e) => e.start.toISOString())).toEqual(["2026-10-06T09:00:00.000Z", "2026-10-08T09:00:00.000Z", "2026-10-09T10:00:00.000Z"]);
    expect(events[1]).toMatchObject({ recurrence: null, seriesId: KEY, providerId: `${KEY}#20261008T090000Z` });
  });

  it("shows a single occurrence the owner was invited to, without its series", () => {
    const [e] = expand(cal(...event("UID:s", "RECURRENCE-ID:20261020T070000Z", "DTSTART:20261020T100000Z", "DTEND:20261020T110000Z", "SUMMARY:Just this one")));
    expect(e).toMatchObject({ providerId: `${KEY}#20261020T070000Z`, seriesId: KEY, title: "Just this one" });
  });

  it("finds this week's occurrences of an old daily event, every other week included", () => {
    const week = [new Date("2026-10-05T00:00:00Z"), new Date("2026-10-12T00:00:00Z")] as const;
    expect(starts(one("UID:old", "DTSTART;TZID=Europe/Prague:20010101T080000", "RRULE:FREQ=DAILY"), week)).toHaveLength(7);
    // 5 January 2015 was a Monday; 5 October 2026 is 613 weeks later, so an "every other week" event skips it.
    const biweekly = one("UID:bi", "DTSTART;TZID=Europe/Prague:20150105T080000", "RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE");
    expect(starts(biweekly, week)).toEqual([]);
    expect(starts(biweekly, [new Date("2026-10-12T00:00:00Z"), new Date("2026-10-19T00:00:00Z")])).toEqual(["2026-10-12T06:00:00.000Z", "2026-10-14T06:00:00.000Z"]);
  });

  it("finds this month's occurrences of old monthly and hourly events", () => {
    // First Monday of the month since 1990, and every third month on the 15th.
    expect(starts(one("UID:mo", "DTSTART;TZID=Europe/Prague:19900101T080000", "RRULE:FREQ=MONTHLY;BYDAY=1MO"))).toEqual(["2026-10-05T06:00:00.000Z", "2026-11-02T07:00:00.000Z"]);
    expect(starts(one("UID:q", "DTSTART;VALUE=DATE:20000115", "RRULE:FREQ=MONTHLY;INTERVAL=3"))).toEqual(["2026-10-15T00:00:00.000Z"]);
    // The 31st only exists in some months.
    expect(starts(one("UID:end", "DTSTART;VALUE=DATE:20000131", "RRULE:FREQ=MONTHLY"))).toEqual(["2026-10-31T00:00:00.000Z"]);
    const day = [new Date("2026-10-06T00:00:00Z"), new Date("2026-10-07T00:00:00Z")] as const;
    expect(starts(one("UID:h", "DTSTART:19990101T003000Z", "RRULE:FREQ=HOURLY;INTERVAL=6"), day)).toEqual(["2026-10-06T00:30:00.000Z", "2026-10-06T06:30:00.000Z", "2026-10-06T12:30:00.000Z", "2026-10-06T18:30:00.000Z"]);
  });

  it("never gives more than 2000 occurrences or runs forever", () => {
    const events = expandObject(one("UID:m", "DTSTART:20261001T000000Z", "RRULE:FREQ=MINUTELY"), new Date("2026-10-01T00:00:00Z"), new Date("2036-10-01T00:00:00Z"), opts);
    expect(events).toHaveLength(2000);
    // A rule that counts has to be walked from its start: this one is given up on, not waited for.
    const counted = one("UID:y", "DTSTART:19700101T000000Z", "RRULE:FREQ=SECONDLY;COUNT=2000000000");
    expect(expandObject(counted, new Date("2026-10-01T00:00:00Z"), new Date("2026-10-02T00:00:00Z"), opts)).toEqual([]);
  });
});

describe("splitProviderId", () => {
  it("splits an occurrence's id and leaves a single event's alone", () => {
    expect(splitProviderId(KEY)).toEqual({ key: KEY, rid: null });
    expect(splitProviderId(`${KEY}#20261020T070000Z`)).toEqual({ key: KEY, rid: "20261020T070000Z" });
    expect(splitProviderId("uid-1#20261020")).toEqual({ key: "uid-1", rid: "20261020" });
    expect(splitProviderId("uid-1#20261020T090000")).toEqual({ key: "uid-1", rid: "20261020T090000" });
  });

  it("copes with a # inside the key", () => {
    expect(splitProviderId("room#4@example.com")).toEqual({ key: "room#4@example.com", rid: null });
    expect(splitProviderId("room#4@example.com#20261020T070000Z")).toEqual({ key: "room#4@example.com", rid: "20261020T070000Z" });
  });
});

describe("parseCalendar", () => {
  const FILE = cal(
    "X-WR-CALNAME:Team\\, Prague",
    "X-APPLE-CALENDAR-COLOR:#FF2968FF",
    "BEGIN:VTIMEZONE",
    "TZID:Europe/Prague",
    "BEGIN:STANDARD",
    "DTSTART:19701025T030000",
    "TZOFFSETFROM:+0200",
    "TZOFFSETTO:+0100",
    "RRULE:FREQ=YEARLY;BYDAY=-1SU;BYMONTH=10",
    "END:STANDARD",
    "END:VTIMEZONE",
    ...event(...WEEKLY, "RRULE:FREQ=WEEKLY;COUNT=4", "BEGIN:VALARM", "ACTION:DISPLAY", "TRIGGER:-PT10M", "UID:alarm-uid-is-not-the-events", "END:VALARM"),
    ...event("UID:lunch@example.com", "DTSTART:20261007T110000Z", "DTEND:20261007T120000Z", "SUMMARY:Lunch"),
    "BEGIN:VTODO",
    "UID:todo@example.com",
    "SUMMARY:Not an event",
    "END:VTODO",
    ...event("UID:standup@example.com", "RECURRENCE-ID;TZID=Europe/Prague:20261020T090000", "DTSTART;TZID=Europe/Prague:20261021T140000", "SUMMARY:Moved"),
  );

  it("groups events by UID, each with the zones it needs", () => {
    const parsed = parseCalendar(FILE, { tz: "Europe/Prague" });
    expect(parsed.name).toBe("Team, Prague");
    expect(parsed.color).toBe("#ff2968");
    expect(parsed.objects.map((o) => o.uid)).toEqual(["standup@example.com", "lunch@example.com"]);
    const [standup, lunch] = parsed.objects;
    expect(standup.ics.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    expect(standup.ics).toContain("BEGIN:VTIMEZONE");
    expect(standup.ics).toContain("TRIGGER:-PT10M");
    expect(lunch.ics).not.toContain("VTIMEZONE");
    expect(lunch.ics).not.toContain("Stand-up");
    expect([standup.firstAt?.toISOString(), standup.lastAt?.toISOString()]).toEqual(["2026-10-13T07:00:00.000Z", "2026-11-03T08:30:00.000Z"]);
    expect([lunch.firstAt?.toISOString(), lunch.lastAt?.toISOString()]).toEqual(["2026-10-07T11:00:00.000Z", "2026-10-07T12:00:00.000Z"]);
    // Each object stands on its own.
    expect(starts(standup.ics)).toEqual(["2026-10-13T07:00:00.000Z", "2026-10-21T12:00:00.000Z", "2026-10-27T08:00:00.000Z", "2026-11-03T08:00:00.000Z"]);
  });

  it("gives an event without UID the same one every time, whatever its timestamp says", () => {
    const file = (stamp: string) => cal(...event(`DTSTAMP:${stamp}`, "DTSTART:20261007T110000Z", "SUMMARY:No id"), ...event("DTSTART:20261008T110000Z", "SUMMARY:No id either"));
    const first = parseCalendar(file("20261001T000000Z"), { tz: "UTC" });
    const second = parseCalendar(file("20261002T000000Z"), { tz: "UTC" });
    expect(first.objects).toHaveLength(2);
    expect(first.objects[0].uid).toMatch(/^kolbaba-[0-9a-f]{32}$/);
    expect(first.objects[0].uid).not.toBe(first.objects[1].uid);
    expect(second.objects.map((o) => o.uid)).toEqual(first.objects.map((o) => o.uid));
    expect(first.objects[0].ics).toContain(`UID:${first.objects[0].uid}`);
    expect(expandObject(first.objects[0].ics, ...OCTOBER, opts)[0].uid).toBe(first.objects[0].uid);
  });

  it("skips broken events and keeps the rest", () => {
    const file = cal(
      ...event("UID:bad-date", "DTSTART:garbage", "SUMMARY:Broken"),
      ...event("UID:bad-line", "DTSTART:20261007T110000Z", "this line means nothing"),
      ...event("UID:no-start", "SUMMARY:Never"),
      ...event("UID:bad-rule", "DTSTART:20261007T110000Z", "RRULE:FREQ=SOMETIMES"),
      ...event("UID:fine", "DTSTART:20261007T110000Z", "SUMMARY:Fine"),
      ...event("UID:half", "DTSTART:20261007T110000Z", "RRULE:FREQ=DAILY;COUNT=3", "SUMMARY:Half fine"),
      ...event("UID:half", "RECURRENCE-ID:20261008T110000Z", "DTSTART:nonsense"),
    );
    const parsed = parseCalendar(file, { tz: "UTC" });
    expect(parsed.objects.map((o) => o.uid)).toEqual(["fine", "half"]);
    expect(parsed.objects[1].ics.match(/BEGIN:VEVENT/g)).toHaveLength(1);
    expect(parsed).toMatchObject({ name: null, color: null });
  });

  it("reads files with bare line feeds and folded lines, and a file cut off in the middle", () => {
    const file = "BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:folded\nDTSTART:20261007T110000Z\nSUMMARY:A long\n  title\nEND:VEVENT\nBEGIN:VEVENT\nUID:cut\nDTSTART:20261008T110000Z\n";
    const parsed = parseCalendar(file, { tz: "UTC" });
    expect(parsed.objects.map((o) => o.uid)).toEqual(["folded"]);
    expect(expandObject(parsed.objects[0].ics, ...OCTOBER, opts)[0].title).toBe("A long title");
  });

  it("throws only for text that isn't iCalendar", () => {
    expect(() => parseCalendar("<html><body>Sign in</body></html>", { tz: "UTC" })).toThrow("Not an iCalendar file");
    expect(parseCalendar(cal(), { tz: "UTC" }).objects).toEqual([]);
  });
});

describe("objectBounds", () => {
  const bounds = (ics: string) => {
    const b = objectBounds(ics, { tz: "Europe/Prague" });
    return [b.firstAt?.toISOString() ?? null, b.lastAt?.toISOString() ?? null];
  };

  it("is the event itself for a single one", () => {
    expect(bounds(one("UID:a", "DTSTART:20261006T090000", "DTEND:20261006T100000"))).toEqual(["2026-10-06T07:00:00.000Z", "2026-10-06T08:00:00.000Z"]);
    expect(bounds(one("UID:a", "DTSTART;VALUE=DATE:20261010", "DTEND;VALUE=DATE:20261013"))).toEqual(["2026-10-10T00:00:00.000Z", "2026-10-13T00:00:00.000Z"]);
  });

  it("ends with the last occurrence of a series that ends", () => {
    expect(bounds(one(...WEEKLY, "RRULE:FREQ=WEEKLY;COUNT=3"))).toEqual(["2026-10-13T07:00:00.000Z", "2026-10-27T08:30:00.000Z"]);
    expect(bounds(one(...WEEKLY, "RRULE:FREQ=WEEKLY;UNTIL=20261027T080000Z"))).toEqual(["2026-10-13T07:00:00.000Z", "2026-10-27T08:30:00.000Z"]);
    // An override moved past the end still counts.
    const late = cal(...event(...WEEKLY, "RRULE:FREQ=WEEKLY;COUNT=2"), ...event("UID:standup@example.com", "RECURRENCE-ID:20261020T070000Z", "DTSTART:20261201T100000Z", "DTEND:20261201T110000Z"));
    expect(bounds(late)).toEqual(["2026-10-13T07:00:00.000Z", "2026-12-01T11:00:00.000Z"]);
  });

  it("has no end for a series without one", () => {
    expect(bounds(one(...WEEKLY, "RRULE:FREQ=WEEKLY"))).toEqual(["2026-10-13T07:00:00.000Z", null]);
  });
});

describe("buildObject", () => {
  const NOW = new Date("2026-10-01T12:00:00Z");

  it("writes a timed event in its zone, and reads back the same", () => {
    const { uid, ics } = buildObject(draft(), { now: NOW });
    expect(uid).toMatch(/^[0-9a-f-]{36}$/);
    expect(lines(ics)).toEqual(expect.arrayContaining(["PRODID:-//Kolbaba//Calendar//EN", `UID:${uid}`, "DTSTAMP:20261001T120000Z", "SEQUENCE:0", "DTSTART;TZID=Europe/Prague:20261006T090000", "DTEND;TZID=Europe/Prague:20261006T100000"]));
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    const [e] = expand(ics);
    expect(e).toMatchObject({ providerId: KEY, uid, title: "Planning", location: "Room 2", description: "Bring the numbers.", allDay: false, timeZone: "Europe/Prague", recurrence: null, organizer: null, attendees: [], canEdit: true });
    expect([e.start.toISOString(), e.end.toISOString()]).toEqual(["2026-10-06T07:00:00.000Z", "2026-10-06T08:00:00.000Z"]);
  });

  it("describes the zone for calendars that don't know its name", () => {
    const { ics } = buildObject(draft(), { now: NOW });
    const zone = ics.slice(ics.indexOf("BEGIN:VTIMEZONE"), ics.indexOf("END:VTIMEZONE"));
    expect(ics.indexOf("BEGIN:VTIMEZONE")).toBeLessThan(ics.indexOf("BEGIN:VEVENT"));
    expect(lines(zone)).toEqual([
      "BEGIN:VTIMEZONE",
      "TZID:Europe/Prague",
      "BEGIN:DAYLIGHT",
      "DTSTART:20250330T020000",
      "TZOFFSETFROM:+0100",
      "TZOFFSETTO:+0200",
      "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU",
      "END:DAYLIGHT",
      "BEGIN:STANDARD",
      "DTSTART:20251026T030000",
      "TZOFFSETFROM:+0200",
      "TZOFFSETTO:+0100",
      "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU",
      "END:STANDARD",
      "",
    ]);
    const newYork = buildObject(draft({ timeZone: "America/New_York" }), { now: NOW }).ics;
    expect(newYork).toContain("RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU");
    expect(newYork).toContain("RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU");
    expect(newYork).toContain("DTSTART;TZID=America/New_York:20261006T030000");
    // A zone whose clocks never change, and UTC itself.
    expect(buildObject(draft({ timeZone: "Asia/Tokyo" }), { now: NOW }).ics).toContain("TZOFFSETTO:+0900");
    const utc = buildObject(draft({ timeZone: "UTC" }), { now: NOW }).ics;
    expect(utc).toContain("DTSTART:20261006T070000Z");
    expect(utc).not.toContain("VTIMEZONE");
  });

  it("writes all-day events as dates", () => {
    const { ics } = buildObject(draft({ allDay: true, start: new Date("2026-10-10T00:00:00Z"), end: new Date("2026-10-13T00:00:00Z") }), { uid: "trip-1", now: NOW });
    expect(lines(ics)).toEqual(expect.arrayContaining(["UID:trip-1", "DTSTART;VALUE=DATE:20261010", "DTEND;VALUE=DATE:20261013"]));
    expect(ics).not.toContain("VTIMEZONE");
    const [e] = expand(ics);
    expect(e).toMatchObject({ allDay: true, timeZone: null, uid: "trip-1" });
    expect([e.start.toISOString(), e.end.toISOString()]).toEqual(["2026-10-10T00:00:00.000Z", "2026-10-13T00:00:00.000Z"]);
  });

  it("writes a weekly rule that keeps its hour, with UNTIL the way the standard wants it", () => {
    const { ics } = buildObject(draft({ start: new Date("2026-10-13T07:00:00Z"), end: new Date("2026-10-13T07:30:00Z"), recurrence: "FREQ=WEEKLY;BYDAY=TU;UNTIL=20261103" }), { now: NOW });
    expect(ics).toContain("RRULE:FREQ=WEEKLY;BYDAY=TU;UNTIL=20261103T225959Z");
    const events = expand(ics);
    expect(events.map((e) => e.start.toISOString())).toEqual(["2026-10-13T07:00:00.000Z", "2026-10-20T07:00:00.000Z", "2026-10-27T08:00:00.000Z", "2026-11-03T08:00:00.000Z"]);
    expect(events[0]).toMatchObject({ recurrence: "FREQ=WEEKLY;BYDAY=TU;UNTIL=20261103T225959Z", seriesId: KEY });
    expect(buildObject(draft({ recurrence: "RRULE:FREQ=DAILY;COUNT=2" }), { now: NOW }).ics).toContain("\r\nRRULE:FREQ=DAILY;COUNT=2\r\n");
  });

  it("invites guests in the organizer's name and keeps the server from emailing them", () => {
    const guests = [
      { name: "Novak, Jan", email: "Jan@Example.com" },
      { name: "", email: "eva@example.com" },
    ];
    const { ics } = buildObject(draft({ attendees: guests }), { organizer: { name: "Me Myself", email: "me@example.com" }, clientSchedules: true, now: NOW });
    const unfolded = ics.replace(/\r\n /g, "");
    expect(unfolded).toContain("ORGANIZER;CN=Me Myself:mailto:me@example.com");
    expect(unfolded).toContain('ATTENDEE;CN="Novak, Jan";ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE;SCHEDULE-AGENT=CLIENT:mailto:jan@example.com');
    expect(unfolded).toContain("ATTENDEE;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE;SCHEDULE-AGENT=CLIENT:mailto:eva@example.com");
    expect(lines(ics).every((l) => Buffer.byteLength(l) <= 75)).toBe(true);
    const [e] = expand(ics);
    expect(e).toMatchObject({ organizer: { name: "Me Myself", email: "me@example.com" }, myStatus: null, canEdit: true });
    expect(e.attendees).toEqual([
      { name: "Novak, Jan", email: "jan@example.com", status: "needsAction" },
      { name: "", email: "eva@example.com", status: "needsAction" },
    ]);
    // Without the option the server does the inviting.
    expect(buildObject(draft({ attendees: guests }), { organizer: { name: "", email: "me@example.com" } }).ics).not.toContain("SCHEDULE-AGENT");
    // No guests, no organizer.
    expect(buildObject(draft(), { organizer: { name: "", email: "me@example.com" } }).ics).not.toContain("ORGANIZER");
  });
});

describe("updateObject", () => {
  const NOW = new Date("2026-10-02T12:00:00Z");
  const SINGLE = one(
    "UID:plan@example.com",
    "SEQUENCE:3",
    "DTSTART;TZID=Europe/Prague:20261006T090000",
    "DTEND;TZID=Europe/Prague:20261006T100000",
    "SUMMARY:Old title",
    "LOCATION:Old room",
    "CATEGORIES:WORK",
    "X-CUSTOM-FLAG:keep me",
    "ORGANIZER:mailto:me@example.com",
    "ATTENDEE;PARTSTAT=ACCEPTED;CN=Eva:mailto:eva@example.com",
    "ATTENDEE;PARTSTAT=DECLINED:mailto:gone@example.com",
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    "TRIGGER:-PT10M",
    "END:VALARM",
  );
  const SERIES = cal(
    ...event(...WEEKLY, "SEQUENCE:1", "RRULE:FREQ=WEEKLY;BYDAY=TU;UNTIL=20261103T080000Z", "EXDATE;TZID=Europe/Prague:20261103T090000", "BEGIN:VALARM", "ACTION:DISPLAY", "TRIGGER:-PT5M", "END:VALARM"),
    ...event("UID:standup@example.com", "RECURRENCE-ID;TZID=Europe/Prague:20261020T090000", "DTSTART;TZID=Europe/Prague:20261021T140000", "DTEND;TZID=Europe/Prague:20261021T143000", "SUMMARY:Stand-up (moved)"),
  );
  /** The draft the editor would send for the 27 October occurrence, unchanged. */
  const occurrence = (over: Partial<EventDraft> = {}) =>
    draft({ title: "Stand-up", location: "", description: "", start: new Date("2026-10-27T08:00:00Z"), end: new Date("2026-10-27T08:30:00Z"), recurrence: "FREQ=WEEKLY;BYDAY=TU;UNTIL=20261103T080000Z", ...over });
  const RID = "20261027T080000Z";

  it("changes a single event and keeps what it doesn't know", () => {
    const next = draft({ start: new Date("2026-10-07T12:00:00Z"), end: new Date("2026-10-07T13:30:00Z"), location: "", attendees: [{ name: "Eva", email: "eva@example.com" }, { name: "New Guest", email: "new@example.com" }] });
    const ics = updateObject(SINGLE, next, "this", null, { clientSchedules: true, now: NOW });
    expect(lines(ics.replace(/\r\n /g, ""))).toEqual(
      expect.arrayContaining([
        "SEQUENCE:4",
        "DTSTAMP:20261002T120000Z",
        "LAST-MODIFIED:20261002T120000Z",
        "DTSTART;TZID=Europe/Prague:20261007T140000",
        "DTEND;TZID=Europe/Prague:20261007T153000",
        "SUMMARY:Planning",
        "DESCRIPTION:Bring the numbers.",
        "CATEGORIES:WORK",
        "X-CUSTOM-FLAG:keep me",
        "TRIGGER:-PT10M",
        "ORGANIZER:mailto:me@example.com",
        // Eva keeps her answer; the new guest is asked.
        "ATTENDEE;PARTSTAT=ACCEPTED;CN=Eva:mailto:eva@example.com",
        "ATTENDEE;CN=New Guest;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE;SCHEDULE-AGENT=CLIENT:mailto:new@example.com",
      ]),
    );
    expect(ics).not.toContain("LOCATION");
    expect(ics).not.toContain("gone@example.com");
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(1);
  });

  it("makes a single event repeat, in another zone or all day", () => {
    const repeating = updateObject(SINGLE, draft({ recurrence: "FREQ=DAILY;COUNT=3" }), "all", null, { now: NOW });
    expect(starts(repeating)).toEqual(["2026-10-06T07:00:00.000Z", "2026-10-07T07:00:00.000Z", "2026-10-08T07:00:00.000Z"]);
    const london = updateObject(SINGLE, draft({ timeZone: "Europe/London" }), "all", null, { now: NOW });
    expect(london).toContain("DTSTART;TZID=Europe/London:20261006T080000");
    expect(london).toContain("TZID:Europe/London");
    const allDay = updateObject(SINGLE, draft({ allDay: true, start: new Date("2026-10-06T00:00:00Z"), end: new Date("2026-10-07T00:00:00Z") }), "all", null, { now: NOW });
    expect(lines(allDay)).toEqual(expect.arrayContaining(["DTSTART;VALUE=DATE:20261006", "DTEND;VALUE=DATE:20261007"]));
    expect(updateObject(SINGLE, draft({ attendees: [] }), "all", null, { now: NOW })).not.toContain("ORGANIZER");
  });

  it("leaves a description it only showed in part or as text", () => {
    const html = one("UID:h", "DTSTART:20261006T070000Z", "X-ALT-DESC;FMTTYPE=text/html:<p>Hello <b>all</b></p>");
    expect(updateObject(html, draft({ description: "Hello all" }), "all", null, { now: NOW })).toContain("X-ALT-DESC");
    const changed = updateObject(html, draft({ description: "Hello everyone" }), "all", null, { now: NOW });
    expect(changed).toContain("DESCRIPTION:Hello everyone");
    expect(changed).not.toContain("X-ALT-DESC");
    const long = one("UID:l", "DTSTART:20261006T070000Z", `DESCRIPTION:${"x".repeat(9000)}`);
    const shown = expand(long)[0].description;
    expect(updateObject(long, draft({ description: shown }), "all", null, { now: NOW }).replace(/\r\n /g, "")).toContain("x".repeat(9000));
  });

  it("scope all, only text changed: the master gets it, overrides and EXDATEs stay", () => {
    const ics = updateObject(SERIES, occurrence({ title: "Daily sync", location: "Room 5" }), "all", RID, { now: NOW });
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    expect(lines(ics)).toEqual(expect.arrayContaining(["SUMMARY:Daily sync", "LOCATION:Room 5", "SUMMARY:Stand-up (moved)", "SEQUENCE:2", "DTSTART;TZID=Europe/Prague:20261013T090000", "EXDATE;TZID=Europe/Prague:20261103T090000", "TRIGGER:-PT5M"]));
    expect(expand(ics).map((e) => [e.start.toISOString(), e.title])).toEqual([
      ["2026-10-13T07:00:00.000Z", "Daily sync"],
      ["2026-10-21T12:00:00.000Z", "Stand-up (moved)"],
      ["2026-10-27T08:00:00.000Z", "Daily sync"],
    ]);
    // Opened from the moved occurrence and saved for all, with nothing but the title changed: the same.
    const fromOverride = occurrence({ title: "Daily sync", start: new Date("2026-10-21T12:00:00Z"), end: new Date("2026-10-21T12:30:00Z") });
    expect(starts(updateObject(SERIES, fromOverride, "all", "20261020T070000Z", { now: NOW }))).toEqual(["2026-10-13T07:00:00.000Z", "2026-10-21T12:00:00.000Z", "2026-10-27T08:00:00.000Z"]);
  });

  it("scope all, only the length changed: overrides and EXDATEs stay too", () => {
    const ics = updateObject(SERIES, occurrence({ end: new Date("2026-10-27T09:00:00Z") }), "all", RID, { now: NOW });
    expect(lines(ics)).toEqual(expect.arrayContaining(["DTSTART;TZID=Europe/Prague:20261013T090000", "DTEND;TZID=Europe/Prague:20261013T100000", "EXDATE;TZID=Europe/Prague:20261103T090000"]));
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2);
  });

  it("scope all, moved an hour later: the whole series moves on the wall clock and starts clean", () => {
    // The 27 October occurrence (winter time) goes from 09:00 to 10:30; the series starts in summer time.
    const ics = updateObject(SERIES, occurrence({ start: new Date("2026-10-27T09:30:00Z"), end: new Date("2026-10-27T10:30:00Z") }), "all", RID, { now: NOW });
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(1);
    expect(ics).not.toContain("EXDATE");
    expect(lines(ics)).toEqual(expect.arrayContaining(["DTSTART;TZID=Europe/Prague:20261013T103000", "DTEND;TZID=Europe/Prague:20261013T113000", "SEQUENCE:2", "TRIGGER:-PT5M"]));
    // The last occurrence is still there: UNTIL moved along.
    expect(starts(ics)).toEqual(["2026-10-13T08:30:00.000Z", "2026-10-20T08:30:00.000Z", "2026-10-27T09:30:00.000Z", "2026-11-03T09:30:00.000Z"]);
  });

  it("scope all, moved to another day: a weekly rule left alone follows", () => {
    const ics = updateObject(SERIES, occurrence({ start: new Date("2026-10-28T08:00:00Z"), end: new Date("2026-10-28T08:30:00Z") }), "all", RID, { now: NOW });
    expect(ics).toContain("DTSTART;TZID=Europe/Prague:20261014T090000");
    expect(starts(ics)).toEqual(["2026-10-14T07:00:00.000Z", "2026-10-21T07:00:00.000Z", "2026-10-28T08:00:00.000Z", "2026-11-04T08:00:00.000Z"]);
    expect(expand(ics)[0].recurrence).toBe("FREQ=WEEKLY;BYDAY=WE;UNTIL=20261104T225959Z");
  });

  it("scope all, rule changed: the new rule, without the old exceptions", () => {
    const ics = updateObject(SERIES, occurrence({ recurrence: "FREQ=WEEKLY;BYDAY=TU,TH;COUNT=4" }), "all", RID, { now: NOW });
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(1);
    expect(ics).not.toContain("EXDATE");
    expect(ics.match(/RRULE/g)).toHaveLength(1);
    expect(starts(ics)).toEqual(["2026-10-13T07:00:00.000Z", "2026-10-15T07:00:00.000Z", "2026-10-20T07:00:00.000Z", "2026-10-22T07:00:00.000Z"]);
  });

  it("scope all, rule taken away: one event at the draft's time", () => {
    const ics = updateObject(SERIES, occurrence({ recurrence: null }), "all", RID, { now: NOW });
    expect(eventsOf(ics)).not.toMatch(/RRULE|EXDATE|RECURRENCE-ID/);
    const events = expand(ics);
    expect(events.map((e) => [e.providerId, e.start.toISOString(), e.seriesId])).toEqual([[KEY, "2026-10-27T08:00:00.000Z", null]]);
  });

  it("scope all on an all-day series moves it by days", () => {
    const series = one("UID:d", "DTSTART;VALUE=DATE:20261005", "DTEND;VALUE=DATE:20261006", "RRULE:FREQ=WEEKLY;COUNT=3", "SUMMARY:Review");
    const next = draft({ title: "Review", allDay: true, start: new Date("2026-10-14T00:00:00Z"), end: new Date("2026-10-16T00:00:00Z"), recurrence: "FREQ=WEEKLY;COUNT=3" });
    const ics = updateObject(series, next, "all", "20261012", { now: NOW });
    expect(lines(ics)).toEqual(expect.arrayContaining(["DTSTART;VALUE=DATE:20261007", "DTEND;VALUE=DATE:20261009"]));
  });

  it("scope this: adds an override for that occurrence, with the draft's fields and no rule", () => {
    const next = occurrence({ title: "Stand-up, later", start: new Date("2026-10-27T10:00:00Z"), end: new Date("2026-10-27T10:30:00Z"), attendees: [{ name: "", email: "eva@example.com" }] });
    const ics = updateObject(SERIES, next, "this", RID, { organizer: { name: "", email: "me@example.com" }, now: NOW });
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(3);
    const added = ics.slice(ics.lastIndexOf("BEGIN:VEVENT"));
    expect(lines(added)).toEqual(
      expect.arrayContaining(["UID:standup@example.com", "RECURRENCE-ID;TZID=Europe/Prague:20261027T090000", "DTSTART;TZID=Europe/Prague:20261027T110000", "DTEND;TZID=Europe/Prague:20261027T113000", "SUMMARY:Stand-up, later".replace(",", "\\,"), "SEQUENCE:2", "TRIGGER:-PT5M", "ORGANIZER:mailto:me@example.com"]),
    );
    expect(added).not.toMatch(/RRULE|EXDATE/);
    // The master is as it was.
    expect(ics).toContain("RRULE:FREQ=WEEKLY;BYDAY=TU;UNTIL=20261103T080000Z");
    expect(ics).toContain("SEQUENCE:1");
    const events = expand(ics);
    expect(events.map((e) => [e.providerId, e.start.toISOString(), e.title])).toEqual([
      [`${KEY}#20261013T070000Z`, "2026-10-13T07:00:00.000Z", "Stand-up"],
      [`${KEY}#20261020T070000Z`, "2026-10-21T12:00:00.000Z", "Stand-up (moved)"],
      [`${KEY}#${RID}`, "2026-10-27T10:00:00.000Z", "Stand-up, later"],
    ]);
  });

  it("scope this: replaces the override that is already there", () => {
    const next = occurrence({ title: "Back on Tuesday", start: new Date("2026-10-20T07:00:00Z"), end: new Date("2026-10-20T07:30:00Z") });
    const ics = updateObject(SERIES, next, "this", "20261020T070000Z", { now: NOW });
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    expect(ics.match(/RECURRENCE-ID/g)).toHaveLength(1);
    expect(expand(ics).map((e) => [e.start.toISOString(), e.title])).toEqual([
      ["2026-10-13T07:00:00.000Z", "Stand-up"],
      ["2026-10-20T07:00:00.000Z", "Back on Tuesday"],
      ["2026-10-27T08:00:00.000Z", "Stand-up"],
    ]);
  });
});

describe("removeOccurrence", () => {
  const NOW = new Date("2026-10-02T12:00:00Z");

  it("adds an EXDATE the way the master writes its times", () => {
    const zoned = removeOccurrence(one(...WEEKLY, "RRULE:FREQ=WEEKLY;COUNT=4"), "20261027T080000Z", { now: NOW });
    expect(lines(zoned)).toEqual(expect.arrayContaining(["EXDATE;TZID=Europe/Prague:20261027T090000", "SEQUENCE:1", "LAST-MODIFIED:20261002T120000Z"]));
    expect(starts(zoned)).toEqual(["2026-10-13T07:00:00.000Z", "2026-10-20T07:00:00.000Z", "2026-11-03T08:00:00.000Z"]);
    expect(removeOccurrence(one("UID:u", "DTSTART:20261013T070000Z", "RRULE:FREQ=WEEKLY"), "20261020T070000Z")).toContain("EXDATE:20261020T070000Z");
    expect(removeOccurrence(one("UID:d", "DTSTART;VALUE=DATE:20261013", "RRULE:FREQ=WEEKLY"), "20261020")).toContain("EXDATE;VALUE=DATE:20261020");
    expect(removeOccurrence(one("UID:f", "DTSTART:20261013T090000", "RRULE:FREQ=WEEKLY"), "20261020T090000")).toContain("EXDATE:20261020T090000\r\n");
  });

  it("drops the occurrence's override with it", () => {
    const series = cal(...event(...WEEKLY, "RRULE:FREQ=WEEKLY;COUNT=3"), ...event("UID:standup@example.com", "RECURRENCE-ID;TZID=Europe/Prague:20261020T090000", "DTSTART;TZID=Europe/Prague:20261021T140000", "SUMMARY:Moved"));
    const ics = removeOccurrence(series, "20261020T070000Z", { now: NOW });
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(1);
    expect(ics).not.toContain("RECURRENCE-ID");
    expect(starts(ics)).toEqual(["2026-10-13T07:00:00.000Z", "2026-10-27T08:00:00.000Z"]);
  });
});

describe("itipMessage", () => {
  const NOW = new Date("2026-10-02T12:00:00Z");
  const INVITING = cal(
    ...event(
      ...WEEKLY,
      "SEQUENCE:2",
      "RRULE:FREQ=WEEKLY;COUNT=3",
      "ORGANIZER;CN=Me Myself:mailto:me@example.com",
      "ATTENDEE;PARTSTAT=ACCEPTED:mailto:me@example.com",
      "ATTENDEE;CN=Eva;PARTSTAT=NEEDS-ACTION;SCHEDULE-AGENT=CLIENT;SCHEDULE-STATUS=1.1:mailto:eva@example.com",
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      "TRIGGER:-PT5M",
      "END:VALARM",
    ),
    ...event("UID:standup@example.com", "SEQUENCE:3", "RECURRENCE-ID;TZID=Europe/Prague:20261020T090000", "DTSTART;TZID=Europe/Prague:20261021T140000", "SUMMARY:Moved", "ORGANIZER:mailto:me@example.com", "ATTENDEE;SCHEDULE-AGENT=CLIENT:mailto:eva@example.com"),
  );

  it("REQUEST: the whole event, ready for the guests' calendars", () => {
    const ics = itipMessage(INVITING, "REQUEST", { now: NOW });
    const unfolded = lines(ics.replace(/\r\n /g, ""));
    expect(unfolded.slice(0, 5)).toEqual(["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Kolbaba//Calendar//EN", "CALSCALE:GREGORIAN", "METHOD:REQUEST"]);
    expect(ics).not.toMatch(/SCHEDULE-|VALARM|TRIGGER/);
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    expect(unfolded).toEqual(
      expect.arrayContaining([
        "TZID:Europe/Prague",
        "DTSTAMP:20261002T120000Z",
        "SEQUENCE:2",
        "RRULE:FREQ=WEEKLY;COUNT=3",
        "ORGANIZER;CN=Me Myself:mailto:me@example.com",
        "ATTENDEE;PARTSTAT=ACCEPTED:mailto:me@example.com",
        "ATTENDEE;CN=Eva;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:eva@example.com",
        "ATTENDEE;RSVP=TRUE:mailto:eva@example.com",
      ]),
    );
    expect(ics).not.toContain("STATUS:CANCELLED");
    // The stored object is not touched.
    expect(INVITING).toContain("SCHEDULE-AGENT=CLIENT");
  });

  it("REQUEST for one occurrence: its override, or the master narrowed to it", () => {
    const moved = itipMessage(INVITING, "REQUEST", { rid: "20261020T070000Z", now: NOW });
    expect(moved.match(/BEGIN:VEVENT/g)).toHaveLength(1);
    expect(lines(moved)).toEqual(expect.arrayContaining(["RECURRENCE-ID;TZID=Europe/Prague:20261020T090000", "SUMMARY:Moved", "SEQUENCE:3"]));
    const plain = itipMessage(INVITING, "REQUEST", { rid: "20261027T080000Z", now: NOW });
    expect(plain.match(/BEGIN:VEVENT/g)).toHaveLength(1);
    expect(eventsOf(plain)).not.toContain("RRULE");
    expect(lines(plain)).toEqual(expect.arrayContaining(["RECURRENCE-ID;TZID=Europe/Prague:20261027T090000", "DTSTART;TZID=Europe/Prague:20261027T090000", "DTEND;TZID=Europe/Prague:20261027T093000", "SUMMARY:Stand-up"]));
  });

  it("CANCEL: cancelled, with the next sequence number", () => {
    const all = itipMessage(INVITING, "CANCEL", { now: NOW });
    expect(all.match(/BEGIN:VEVENT/g)).toHaveLength(1);
    expect(lines(all)).toEqual(expect.arrayContaining(["METHOD:CANCEL", "STATUS:CANCELLED", "SEQUENCE:3", "UID:standup@example.com", "RRULE:FREQ=WEEKLY;COUNT=3"]));
    expect(all).not.toMatch(/SCHEDULE-|VALARM|RSVP/);
    const oneOnly = itipMessage(INVITING, "CANCEL", { rid: "20261027T080000Z", now: NOW });
    expect(lines(oneOnly)).toEqual(expect.arrayContaining(["METHOD:CANCEL", "STATUS:CANCELLED", "RECURRENCE-ID;TZID=Europe/Prague:20261027T090000", "SEQUENCE:3"]));
    expect(eventsOf(oneOnly)).not.toContain("RRULE");
  });

  it("describes the zone when the stored event doesn't", () => {
    const ics = itipMessage(one("UID:a", "DTSTART;TZID=Europe/Prague:20261006T090000", "ORGANIZER:mailto:me@example.com", "ATTENDEE:mailto:eva@example.com"), "REQUEST", { now: NOW });
    expect(ics).toContain("BEGIN:VTIMEZONE\r\nTZID:Europe/Prague");
    expect(ics).toContain("SEQUENCE:0");
  });
});

describe("setPartstat", () => {
  const INVITED = cal(
    ...event(...WEEKLY, "RRULE:FREQ=WEEKLY;COUNT=3", "ORGANIZER:mailto:dana@example.com", "ATTENDEE;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:Me@Example.com", "ATTENDEE;PARTSTAT=ACCEPTED:mailto:dana@example.com"),
    ...event("UID:standup@example.com", "RECURRENCE-ID;TZID=Europe/Prague:20261020T090000", "DTSTART;TZID=Europe/Prague:20261021T140000", "ORGANIZER:mailto:dana@example.com", "ATTENDEE;PARTSTAT=NEEDS-ACTION:mailto:me@example.com"),
  );
  const statuses = (ics: string) => expand(ics).map((e) => e.myStatus);

  it("answers for the whole series, overrides included", () => {
    const ics = setPartstat(INVITED, ["me@example.com"], "ACCEPTED", "all", null);
    expect(statuses(ics)).toEqual(["accepted", "accepted", "accepted"]);
    expect(ics).toContain("ATTENDEE;PARTSTAT=ACCEPTED:mailto:dana@example.com");
    expect(statuses(setPartstat(INVITED, ["other@example.com", "ME@example.com"], "DECLINED", "all", "20261027T080000Z"))).toEqual(["declined", "declined", "declined"]);
  });

  it("answers for one occurrence: in its override, made when there is none", () => {
    expect(statuses(setPartstat(INVITED, ["me@example.com"], "TENTATIVE", "this", "20261020T070000Z"))).toEqual(["needsAction", "tentative", "needsAction"]);
    const ics = setPartstat(INVITED, ["me@example.com"], "DECLINED", "this", "20261027T080000Z");
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(3);
    expect(ics).toContain("RECURRENCE-ID;TZID=Europe/Prague:20261027T090000");
    expect(statuses(ics)).toEqual(["needsAction", "needsAction", "declined"]);
  });

  it("answers a single event whatever the scope says", () => {
    const single = one("UID:s", "DTSTART:20261006T090000Z", "ORGANIZER:mailto:dana@example.com", "ATTENDEE:mailto:me@example.com");
    expect(statuses(setPartstat(single, ["me@example.com"], "ACCEPTED", "this", null))).toEqual(["accepted"]);
  });

  it("returns the object as it was when the owner isn't a guest", () => {
    expect(setPartstat(INVITED, ["stranger@example.com"], "ACCEPTED", "all", null)).toBe(INVITED);
    expect(setPartstat(INVITED, ["stranger@example.com"], "ACCEPTED", "this", "20261027T080000Z")).toBe(INVITED);
    expect(setPartstat(INVITED, [], "ACCEPTED", "all", null)).toBe(INVITED);
  });
});

describe("itipReply", () => {
  const NOW = new Date("2026-10-02T08:00:00Z");
  const INVITED = cal(
    ...event(
      "UID:sync@example.com",
      "SEQUENCE:3",
      "DTSTART;TZID=Europe/Prague:20261013T090000",
      "DTEND;TZID=Europe/Prague:20261013T093000",
      "RRULE:FREQ=WEEKLY;COUNT=4",
      "SUMMARY:Weekly sync",
      "DESCRIPTION:Long notes nobody needs back.",
      "ORGANIZER;CN=Eva Example:mailto:eva@example.com",
      "ATTENDEE;PARTSTAT=NEEDS-ACTION;RSVP=TRUE;CN=Me:mailto:me@example.com",
      "ATTENDEE;PARTSTAT=ACCEPTED:mailto:tom@example.com",
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      "TRIGGER:-PT10M",
      "END:VALARM",
    ),
  );
  const flat = (ics: string) => ics.replace(/\r\n /g, "");

  it("answers for the whole event with only the answering guest on it", () => {
    const reply = itipReply(INVITED, ["me@example.com"], "ACCEPTED", { now: NOW })!;
    expect(reply.organizer).toEqual({ name: "Eva Example", email: "eva@example.com" });
    expect(reply.attendee).toBe("me@example.com");
    expect(reply.serverReplies).toBe(false);
    const text = flat(reply.content);
    expect(text).toContain("METHOD:REPLY");
    expect(text).toContain("UID:sync@example.com");
    expect(text).toContain("SEQUENCE:3");
    expect(text).toContain("DTSTAMP:20261002T080000Z");
    expect(text).toContain("RRULE:FREQ=WEEKLY;COUNT=4");
    expect(text).toMatch(/ATTENDEE;[^\r\n]*PARTSTAT=ACCEPTED[^\r\n]*:mailto:me@example\.com/);
    expect(text).not.toContain("RSVP");
    expect(text).not.toContain("tom@example.com");
    expect(text).not.toContain("VALARM");
    expect(text).not.toContain("Long notes");
    expect(text).toMatch(/ORGANIZER;CN=Eva Example:mailto:eva@example\.com/);
  });

  it("answers for one occurrence with its RECURRENCE-ID", () => {
    const text = flat(itipReply(INVITED, ["me@example.com"], "DECLINED", { rid: "20261020T070000Z", now: NOW })!.content);
    expect(text).toMatch(/RECURRENCE-ID[^\r\n]*:20261020T090000/);
    expect(text).not.toContain("RRULE:FREQ=WEEKLY;COUNT=4");
    expect(text).toMatch(/PARTSTAT=DECLINED/);
  });

  it("has nobody to tell when the owner is the organizer or isn't invited", () => {
    expect(itipReply(INVITED, ["eva@example.com"], "ACCEPTED")).toBeNull();
    expect(itipReply(INVITED, ["someone@example.com"], "ACCEPTED")).toBeNull();
    expect(itipReply(one("UID:a", "DTSTART:20261013T090000Z", "SUMMARY:Alone"), ["me@example.com"], "ACCEPTED")).toBeNull();
  });

  it("knows when the calendar's server sends the answer itself", () => {
    const scheduled = INVITED.replace("ORGANIZER;CN=Eva Example", "ORGANIZER;SCHEDULE-STATUS=1.2;CN=Eva Example");
    const reply = itipReply(scheduled, ["me@example.com"], "TENTATIVE", { now: NOW })!;
    expect(reply.serverReplies).toBe(true);
    expect(reply.content).not.toContain("SCHEDULE-STATUS");
    const byClient = INVITED.replace("ORGANIZER;CN=Eva Example", "ORGANIZER;SCHEDULE-AGENT=CLIENT;SCHEDULE-STATUS=1.2;CN=Eva Example");
    expect(itipReply(byClient, ["me@example.com"], "TENTATIVE")!.serverReplies).toBe(false);
  });
});
