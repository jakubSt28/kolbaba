import { describe, expect, it } from "vitest";
import { buildEvent, buildReply, parseInvite } from "./ics";

const GOOGLE = [
  "BEGIN:VCALENDAR",
  "PRODID:-//Google Inc//Google Calendar 70.9054//EN",
  "VERSION:2.0",
  "METHOD:REQUEST",
  "BEGIN:VTIMEZONE",
  "TZID:Europe/Prague",
  "END:VTIMEZONE",
  "BEGIN:VEVENT",
  "DTSTART;TZID=Europe/Prague:20261015T100000",
  "DTEND;TZID=Europe/Prague:20261015T110000",
  "DTSTAMP:20261012T080000Z",
  'ORGANIZER;CN="Jana Dvořáková":mailto:jana@example.cz',
  "UID:abc123@google.com",
  "ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;CN=me@sez",
  " nam.cz;X-NUM-GUESTS=0:mailto:me@seznam.cz",
  "ATTENDEE;PARTSTAT=ACCEPTED;CN=Jana Dvořáková:mailto:jana@example.cz",
  "SEQUENCE:2",
  "SUMMARY:Schůzka\\, plánování Q4",
  "LOCATION:Kancelář\\, Praha 7",
  "BEGIN:VALARM",
  "ACTION:DISPLAY",
  "TRIGGER:-P0DT0H10M0S",
  "END:VALARM",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

describe("parseInvite", () => {
  it("reads a Google Calendar invitation", () => {
    const i = parseInvite(GOOGLE)!;
    expect(i.method).toBe("REQUEST");
    expect(i.uid).toBe("abc123@google.com");
    expect(i.sequence).toBe(2);
    expect(i.summary).toBe("Schůzka, plánování Q4");
    expect(i.location).toBe("Kancelář, Praha 7");
    // 10:00 in Prague in October is 08:00 UTC (summer time).
    expect(i.start).toBe("2026-10-15T08:00:00.000Z");
    expect(i.end).toBe("2026-10-15T09:00:00.000Z");
    expect(i.organizer).toEqual({ name: "Jana Dvořáková", email: "jana@example.cz" });
    expect(i.attendees).toEqual([
      { name: "me@seznam.cz", email: "me@seznam.cz", status: "NEEDS-ACTION" },
      { name: "Jana Dvořáková", email: "jana@example.cz", status: "ACCEPTED" },
    ]);
  });

  it("knows Outlook's Windows zone names, all-day events and UTC times", () => {
    const outlook = parseInvite(
      ["BEGIN:VCALENDAR", "METHOD:REQUEST", "BEGIN:VEVENT", "UID:o1", "DTSTART;TZID=Central Europe Standard Time:20261215T090000", "END:VEVENT", "END:VCALENDAR"].join("\n"),
    )!;
    expect(outlook.start).toBe("2026-12-15T08:00:00.000Z"); // winter time: UTC+1
    const allDay = parseInvite(["BEGIN:VEVENT", "UID:a", "DTSTART;VALUE=DATE:20261224", "DTEND;VALUE=DATE:20261225", "END:VEVENT"].join("\n"))!;
    expect(allDay).toMatchObject({ allDay: true, start: "2026-12-24", method: "PUBLISH" });
    expect(parseInvite(["BEGIN:VEVENT", "UID:z", "DTSTART:20261015T080000Z", "END:VEVENT"].join("\n"))!.start).toBe("2026-10-15T08:00:00.000Z");
    expect(parseInvite("BEGIN:VEVENT\nSUMMARY:no uid\nEND:VEVENT")).toBeNull();
  });
});

/** A Teams invitation as Exchange sends it (names and ids made up), with its join link twice. */
const TEAMS = [
  "BEGIN:VCALENDAR",
  "METHOD:REQUEST",
  "PRODID:Microsoft Exchange Server 2010",
  "VERSION:2.0",
  "BEGIN:VTIMEZONE",
  "TZID:Central Europe Standard Time",
  "BEGIN:STANDARD",
  "DTSTART:16010101T030000",
  "TZOFFSETFROM:+0200",
  "TZOFFSETTO:+0100",
  "RRULE:FREQ=YEARLY;INTERVAL=1;BYDAY=-1SU;BYMONTH=10",
  "END:STANDARD",
  "END:VTIMEZONE",
  "BEGIN:VEVENT",
  "ORGANIZER;CN=NOVÁKOVÁ Eva:mailto:enovakova@bank.example",
  "ATTENDEE;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE;CN=me@sezn",
  " am.cz:mailto:me@seznam.cz",
  "DESCRIPTION;LANGUAGE=cs-CZ:\\n____________\\nSchůzka v Microsoft Teams\\nPřipojit ",
  " se: https://teams.microsoft.com/meet/123456789012345?p=AbCdEf\\nPotřebujete po",
  " moc?<https://aka.ms/JoinTeamsMeeting?omkt=cs-CZ>",
  "UID:040000008200E00074C5B7101A82E008000000000000000000000000000000000000000000",
  "SUMMARY;LANGUAGE=cs-CZ:SCHŮZKA ",
  "DTSTART;TZID=Central Europe Standard Time:20260930T100000",
  "DTEND;TZID=Central Europe Standard Time:20260930T103000",
  "LOCATION;LANGUAGE=cs-CZ:Schůzka Microsoft Teams",
  "X-MICROSOFT-SKYPETEAMSMEETINGURL:https://teams.microsoft.com/l/meetup-join/",
  " 19%3ameeting_Yzc1MjNk%40thread.v2/0?context=%7b%22Tid%22%3a%2264af%22%7d",
  "BEGIN:VALARM",
  "DESCRIPTION:REMINDER",
  "TRIGGER;RELATED=START:-PT15M",
  "ACTION:DISPLAY",
  "END:VALARM",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

const event = (...lines: string[]) => parseInvite(["BEGIN:VEVENT", "UID:x", "DTSTART:20261015T080000Z", ...lines, "END:VEVENT"].join("\n"))!;

describe("joinUrl", () => {
  it("reads a Teams invitation from Exchange: the time in Prague and the link to join", () => {
    const i = parseInvite(TEAMS)!;
    expect(i.summary).toBe("SCHŮZKA");
    // 10:00 in Prague on 30 September is 08:00 UTC (summer time).
    expect(i.start).toBe("2026-09-30T08:00:00.000Z");
    expect(i.end).toBe("2026-09-30T08:30:00.000Z");
    expect(i.location).toBe("Schůzka Microsoft Teams");
    expect(i.joinUrl).toBe("https://teams.microsoft.com/l/meetup-join/19%3ameeting_Yzc1MjNk%40thread.v2/0?context=%7b%22Tid%22%3a%2264af%22%7d");
  });

  it("finds Teams' link in the text when the property is missing", () => {
    const i = parseInvite(TEAMS.replace(/X-MICROSOFT-SKYPETEAMSMEETINGURL[^]*?\r\nBEGIN:VALARM/, "BEGIN:VALARM"))!;
    expect(i.joinUrl).toBe("https://teams.microsoft.com/meet/123456789012345?p=AbCdEf");
  });

  it("reads Google Meet, CONFERENCE, Zoom in the location and Safe Links", () => {
    expect(event("X-GOOGLE-CONFERENCE:https://meet.google.com/abc-defg-hij").joinUrl).toBe("https://meet.google.com/abc-defg-hij");
    expect(event("CONFERENCE;VALUE=URI;FEATURE=VIDEO:https://whereby.com/team").joinUrl).toBe("https://whereby.com/team");
    expect(event("LOCATION:https://us02web.zoom.us/j/8123456789?pwd=abc").joinUrl).toBe("https://us02web.zoom.us/j/8123456789?pwd=abc");
    const wrapped = `https://eur01.safelinks.protection.outlook.com/?url=${encodeURIComponent("https://teams.microsoft.com/l/meetup-join/19%3ameeting_x")}&data=05`;
    expect(event(`DESCRIPTION:Join here<${wrapped}>`).joinUrl).toBe("https://teams.microsoft.com/l/meetup-join/19%3ameeting_x");
  });

  it("leaves out what isn't a call: places, other links, insecure ones", () => {
    expect(event("LOCATION:https://maps.app.goo.gl/xyz").joinUrl).toBeNull();
    expect(event("LOCATION:https://www.google.com/maps/place/Praha").joinUrl).toBeNull();
    expect(event("LOCATION:Kancelář\\, Praha 7", "DESCRIPTION:Agenda: https://example.com/agenda").joinUrl).toBeNull();
    expect(event("X-GOOGLE-CONFERENCE:javascript:alert(1)").joinUrl).toBeNull();
    expect(event("LOCATION:http://zoom.us/j/1").joinUrl).toBeNull();
  });
});

describe("buildReply", () => {
  it("answers for one attendee, pointing at the same event", () => {
    const reply = buildReply(parseInvite(GOOGLE)!, { name: "Daniel", email: "me@seznam.cz" }, "ACCEPTED", new Date("2026-10-12T09:00:00Z"));
    expect(reply).toContain("METHOD:REPLY");
    expect(reply).toContain("UID:abc123@google.com");
    expect(reply).toContain("SEQUENCE:2");
    expect(reply).toContain("DTSTART;TZID=Europe/Prague:20261015T100000");
    expect(reply).toContain('ATTENDEE;PARTSTAT=ACCEPTED;CN="Daniel":mailto:me@seznam.cz');
    expect(reply).toContain("DTSTAMP:20261012T090000Z");
    expect(reply).toContain("SUMMARY:Schůzka\\, plánování Q4");
    expect(reply.split("\r\n").every((l) => Buffer.byteLength(l) <= 75)).toBe(true);
    // Only our own answer: other attendees aren't repeated.
    expect(reply).not.toContain("jana@example.cz;");
  });
});

describe("buildEvent", () => {
  it("is the event alone, in UTC, for the user's own calendar", () => {
    const ics = buildEvent(parseInvite(GOOGLE)!, new Date("2026-10-12T09:00:00Z"))!;
    expect(ics).toContain("METHOD:PUBLISH");
    expect(ics).toContain("UID:abc123@google.com");
    expect(ics).toContain("DTSTART:20261015T080000Z");
    expect(ics).toContain("DTEND:20261015T090000Z");
    expect(ics).toContain("LOCATION:Kancelář\\, Praha 7");
    expect(ics).not.toContain("ATTENDEE");
    expect(ics).not.toContain("ORGANIZER");
  });

  it("keeps all-day events as dates", () => {
    const ics = buildEvent(parseInvite(["BEGIN:VEVENT", "UID:a", "DTSTART;VALUE=DATE:20261224", "DTEND;VALUE=DATE:20261225", "END:VEVENT"].join("\n"))!)!;
    expect(ics).toContain("DTSTART;VALUE=DATE:20261224");
    expect(ics).toContain("DTEND;VALUE=DATE:20261225");
  });
});
