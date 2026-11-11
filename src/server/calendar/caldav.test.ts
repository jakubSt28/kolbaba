import { describe, expect, it } from "vitest";
import { type CalDavDns, createCalDavProvider, discoverCalDav } from "./caldav";
import type { SafeFetchInit, SafeResponse } from "./net";
import { CalendarAuthError, CalendarConflictError, type EventDraft, type EventRef } from "./types";

type Call = { method: string; url: string; headers: Record<string, string>; body?: string };
type Answer = { status: number; text?: string; headers?: Record<string, string>; url?: string };
type Route = Answer | ((call: Call) => Answer);

/** A CalDAV server made of a table: "METHOD address" → what it answers. Anything else gets `otherwise` (a 404). */
function server(routes: Record<string, Route>, otherwise: Answer = { status: 404 }) {
  const calls: Call[] = [];
  const http = async (url: string, init: SafeFetchInit = {}): Promise<SafeResponse> => {
    const call = { method: init.method ?? "GET", url, headers: init.headers ?? {}, body: init.body };
    calls.push(call);
    const route = routes[`${call.method} ${url}`];
    const answer = typeof route === "function" ? route(call) : (route ?? otherwise);
    return { status: answer.status, text: answer.text ?? "", headers: new Headers(answer.headers), url: answer.url ?? url };
  };
  return { http, calls };
}

const noDns: CalDavDns = { resolveSrv: async () => [], resolveTxt: async () => [] };
const login = { username: "jan@example.com", password: "s3cret" };
const BASIC = `Basic ${Buffer.from("jan@example.com:s3cret").toString("base64")}`;

/** A multistatus the way most servers write it, with D: and C: prefixes. */
const prefixed = (...responses: string[]) => `<?xml version="1.0" encoding="UTF-8"?>\n<D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">\n${responses.join("\n")}\n</D:multistatus>`;
const principalAnswer = (href: string) => prefixed(`<D:response><D:href>/</D:href><D:propstat><D:prop><D:current-user-principal><D:href>${href}</D:href></D:current-user-principal></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>`);
const homeAnswer = (self: string, home: string) =>
  prefixed(`<D:response><D:href>${self}</D:href><D:propstat><D:prop><C:calendar-home-set><D:href>${home}</D:href></C:calendar-home-set></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>`);

describe("discoverCalDav", () => {
  it("knows where the big providers keep their calendars", async () => {
    const { http, calls } = server({
      "PROPFIND https://caldav.seznam.cz": { status: 207, text: principalAnswer("/principals/users/jan/") },
      "PROPFIND https://caldav.seznam.cz/principals/users/jan/": { status: 207, text: homeAnswer("/principals/users/jan/", "/calendars/jan/") },
    });
    const found = await discoverCalDav({ email: "Me@Seznam.cz", login }, { http, dns: noDns });
    expect(found).toEqual({ homeUrl: "https://caldav.seznam.cz/calendars/jan/" });
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual(["PROPFIND https://caldav.seznam.cz", "PROPFIND https://caldav.seznam.cz/principals/users/jan/"]);
    expect(calls[0].headers).toMatchObject({ Authorization: BASIC, Depth: "0", "Content-Type": "application/xml; charset=utf-8", Prefer: "return-minimal" });
    expect(calls[0].body).toContain("current-user-principal");
    expect(calls[0].body).toContain("calendar-home-set");
  });

  it("accepts a home on another host than the one it asked (iCloud)", async () => {
    const { http } = server({
      "PROPFIND https://caldav.icloud.com": { status: 207, text: principalAnswer("/123456/principal/") },
      "PROPFIND https://caldav.icloud.com/123456/principal/": { status: 207, text: homeAnswer("/123456/principal/", "https://p42-caldav.icloud.com:443/123456/calendars/") },
    });
    expect(await discoverCalDav({ email: "me@icloud.com", login }, { http, dns: noDns })).toEqual({ homeUrl: "https://p42-caldav.icloud.com/123456/calendars/" });
  });

  it("follows the domain's well-known address to wherever it redirects", async () => {
    const { http, calls } = server({
      // safeFetch followed the redirect to another host, and so left the password behind.
      "PROPFIND https://example.org/.well-known/caldav": (call) => ({ status: call.headers.Authorization ? 401 : 500, url: "https://dav.example.net/dav/" }),
      "PROPFIND https://dav.example.net/dav/": { status: 207, text: principalAnswer("/dav/principals/jan/") },
      "PROPFIND https://dav.example.net/dav/principals/jan/": { status: 207, text: homeAnswer("/dav/principals/jan/", "/dav/calendars/jan/") },
    });
    expect(await discoverCalDav({ email: "jan@example.org", login }, { http, dns: noDns })).toEqual({ homeUrl: "https://dav.example.net/dav/calendars/jan/" });
    expect(calls.map((c) => c.url)).toEqual(["https://example.org/.well-known/caldav", "https://dav.example.net/dav/", "https://dav.example.net/dav/principals/jan/"]);
  });

  it("asks DNS where the domain's CalDAV server is, path included", async () => {
    const dns: CalDavDns = {
      resolveSrv: async (name) =>
        name === "_caldavs._tcp.example.org"
          ? [
              { name: "backup.example.net", port: 443, priority: 20, weight: 0 },
              { name: "dav.example.net.", port: 8443, priority: 10, weight: 0 },
            ]
          : [],
      resolveTxt: async () => [["v=1"], ["path=/ca", "ldav/"]],
    };
    const { http, calls } = server({ "PROPFIND https://dav.example.net:8443/caldav/": { status: 207, text: homeAnswer("/caldav/", "/caldav/jan/") } });
    expect(await discoverCalDav({ email: "jan@example.org", login }, { http, dns })).toEqual({ homeUrl: "https://dav.example.net:8443/caldav/jan/" });
    expect(calls).toHaveLength(1);
    // A record that says "not offered" is no server.
    const off: CalDavDns = { resolveSrv: async () => [{ name: ".", port: 0, priority: 0, weight: 0 }], resolveTxt: async () => [] };
    expect(await discoverCalDav({ email: "jan@example.org", login }, { http: server({}).http, dns: off })).toBeNull();
  });

  it("takes an address the user typed: a server, a principal, or the calendars' own folder", async () => {
    // A default namespace instead of prefixes, as some servers write it.
    const plain = `<?xml version="1.0"?><multistatus xmlns="DAV:"><response><href>/remote.php/dav/calendars/jan/</href><propstat><prop><resourcetype><collection/></resourcetype></prop><status>HTTP/1.1 200 OK</status></propstat><propstat><prop><current-user-principal/></prop><status>HTTP/1.1 404 Not Found</status></propstat></response></multistatus>`;
    const { http, calls } = server({
      "PROPFIND https://cloud.example.org/remote.php/dav/calendars/jan/": { status: 207, text: plain },
      "PROPFIND https://dav.example.org/": { status: 404 },
      "PROPFIND https://dav.example.org/.well-known/caldav": { status: 207, text: homeAnswer("/", "/cal/jan/"), url: "https://dav.example.org/cal/" },
    });
    expect(await discoverCalDav({ email: "jan@example.com", login, url: " https://cloud.example.org/remote.php/dav/calendars/jan/ " }, { http, dns: noDns })).toEqual({
      homeUrl: "https://cloud.example.org/remote.php/dav/calendars/jan/",
    });
    expect(calls).toHaveLength(1);
    // Just a host name: https is assumed, and its well-known address tried when the root says nothing.
    expect(await discoverCalDav({ email: "jan@example.com", login, url: "dav.example.org" }, { http, dns: noDns })).toEqual({ homeUrl: "https://dav.example.org/cal/jan/" });
  });

  it("goes one level up from a typed calendar address", async () => {
    const calendar = prefixed("<D:response><D:href>/dav/jan/work/</D:href><D:propstat><D:prop><D:resourcetype><D:collection/><C:calendar/></D:resourcetype></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>");
    const { http } = server({ "PROPFIND https://dav.example.org/dav/jan/work": { status: 207, text: calendar } });
    expect(await discoverCalDav({ email: "jan@example.com", login, url: "https://dav.example.org/dav/jan/work" }, { http, dns: noDns })).toEqual({ homeUrl: "https://dav.example.org/dav/jan/" });
  });

  it("throws CalendarAuthError when the server refuses the login, and offers the password to nobody else", async () => {
    const refusing = server({ "PROPFIND https://caldav.fastmail.com/dav/": { status: 401 } });
    await expect(discoverCalDav({ email: "me@fastmail.com", login }, { http: refusing.http, dns: noDns })).rejects.toBeInstanceOf(CalendarAuthError);
    expect(refusing.calls).toHaveLength(1);
    const forbidden = server({ "PROPFIND https://dav.example.org/": { status: 403 } });
    await expect(discoverCalDav({ email: "jan@example.com", login, url: "https://dav.example.org/" }, { http: forbidden.http, dns: noDns })).rejects.toBeInstanceOf(CalendarAuthError);
    const principal = server({
      "PROPFIND https://dav.example.org/": { status: 207, text: principalAnswer("/p/jan/") },
      "PROPFIND https://dav.example.org/p/jan/": { status: 401 },
    });
    await expect(discoverCalDav({ email: "jan@example.com", login, url: "https://dav.example.org/" }, { http: principal.http, dns: noDns })).rejects.toBeInstanceOf(CalendarAuthError);
  });

  it("returns null when nothing answers like a CalDAV server", async () => {
    const { http, calls } = server({
      // A website that forbids the path, or answers with a page, has no calendars.
      "PROPFIND https://example.org/.well-known/caldav": { status: 403 },
      "PROPFIND https://example.net/.well-known/caldav": { status: 200, text: "<html>Welcome</html>" },
    });
    expect(await discoverCalDav({ email: "jan@example.org", login }, { http, dns: noDns })).toBeNull();
    expect(await discoverCalDav({ email: "jan@example.net", login }, { http, dns: noDns })).toBeNull();
    expect(calls.map((c) => c.url)).toEqual(["https://example.org/.well-known/caldav", "https://example.net/.well-known/caldav"]);
    const unreachable = async () => {
      throw new Error("Could not reach example.org");
    };
    expect(await discoverCalDav({ email: "jan@example.org", login }, { http: unreachable, dns: noDns })).toBeNull();
  });
});

const HOME = "https://dav.example.com/dav/jan/";
const WORK = "https://dav.example.com/dav/jan/work/";
const provider = (routes: Record<string, Route>, otherwise?: Answer) => {
  const fake = server(routes, otherwise);
  return { ...fake, caldav: createCalDavProvider({ homeUrl: HOME, login, me: ["jan@example.com"], tz: "Europe/Prague" }, { http: fake.http }) };
};

const ics = (...lines: string[]) => ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Example//Server//EN", ...lines, "END:VCALENDAR"].join("\r\n") + "\r\n";
const LUNCH = ics("BEGIN:VEVENT", "UID:lunch@example.com", "DTSTART;TZID=Europe/Prague:20261007T120000", "DTEND;TZID=Europe/Prague:20261007T130000", "SUMMARY:Lunch & <talk>", "END:VEVENT");
const STANDUP = ics(
  "BEGIN:VEVENT",
  "UID:standup@example.com",
  "DTSTART;TZID=Europe/Prague:20261013T090000",
  "DTEND;TZID=Europe/Prague:20261013T093000",
  "RRULE:FREQ=WEEKLY;COUNT=3",
  "SUMMARY:Stand-up",
  "ORGANIZER:mailto:dana@example.com",
  "ATTENDEE;PARTSTAT=NEEDS-ACTION:mailto:jan@example.com",
  "END:VEVENT",
);
const escaped = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const draft = (over: Partial<EventDraft> = {}): EventDraft => ({
  title: "Planning",
  location: "",
  description: "",
  start: new Date("2026-10-06T07:00:00Z"),
  end: new Date("2026-10-06T08:00:00Z"),
  allDay: false,
  timeZone: "Europe/Prague",
  recurrence: null,
  attendees: [],
  ...over,
});
const ref = (providerId: string, over: Partial<EventRef> = {}): EventRef => ({ providerId, seriesId: null, uid: null, etag: null, start: new Date("2026-10-07T10:00:00Z"), allDay: false, ...over });

describe("CalDAV provider: listing", () => {
  it("lists the calendars of the home: colour, read-only, and nothing that isn't a calendar of events", async () => {
    const answer = prefixed(
      "<D:response><D:href>/dav/jan/</D:href><D:propstat><D:prop><D:resourcetype><D:collection/></D:resourcetype><D:displayname>Jan</D:displayname></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>",
      `<D:response><D:href>/dav/jan/work/</D:href><D:propstat><D:prop><D:resourcetype><D:collection/><C:calendar/></D:resourcetype><D:displayname>Work &amp; travel</D:displayname>
        <A:calendar-color xmlns:A="http://apple.com/ns/ical/">#FF2968FF</A:calendar-color>
        <C:supported-calendar-component-set><C:comp name="VEVENT"/><C:comp name="VTODO"/></C:supported-calendar-component-set>
        <D:current-user-privilege-set><D:privilege><D:read/></D:privilege><D:privilege><D:write/></D:privilege></D:current-user-privilege-set></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>`,
      `<D:response><D:href>/dav/jan/team%20holidays/</D:href><D:propstat><D:prop><D:resourcetype><D:collection/><C:calendar/></D:resourcetype>
        <D:current-user-privilege-set><D:privilege><D:read/></D:privilege><D:privilege><D:read-current-user-privilege-set/></D:privilege></D:current-user-privilege-set></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat>
        <D:propstat><D:prop><D:displayname/><A:calendar-color xmlns:A="http://apple.com/ns/ical/"/></D:prop><D:status>HTTP/1.1 404 Not Found</D:status></D:propstat></D:response>`,
      '<D:response><D:href>/dav/jan/tasks/</D:href><D:propstat><D:prop><D:resourcetype><D:collection/><C:calendar/></D:resourcetype><D:displayname>Tasks</D:displayname><C:supported-calendar-component-set><C:comp name="VTODO"/></C:supported-calendar-component-set></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>',
      "<D:response><D:href>/dav/jan/inbox/</D:href><D:propstat><D:prop><D:resourcetype><D:collection/><C:schedule-inbox/></D:resourcetype></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>",
      "<D:response><D:href>/dav/jan/contacts/</D:href><D:propstat><D:prop><D:resourcetype><D:collection/><CARD:addressbook xmlns:CARD=\"urn:ietf:params:xml:ns:carddav\"/></D:resourcetype></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>",
    );
    const { caldav, calls } = provider({ [`PROPFIND ${HOME}`]: { status: 207, text: answer } });
    expect(await caldav.listCalendars()).toEqual([
      { providerId: WORK, name: "Work & travel", color: "#ff2968", readOnly: false, primary: false, shown: true },
      { providerId: "https://dav.example.com/dav/jan/team%20holidays/", name: "team holidays", color: null, readOnly: true, primary: false, shown: true },
    ]);
    expect(calls[0].headers).toMatchObject({ Authorization: BASIC, Depth: "1", "Content-Type": "application/xml; charset=utf-8" });
    for (const asked of ["resourcetype", "displayname", "calendar-color", "supported-calendar-component-set", "current-user-privilege-set"]) expect(calls[0].body).toContain(asked);
    expect(caldav.sendsInvitations).toBe(false);
  });

  it("reads a home written without prefixes, with absolute addresses", async () => {
    const answer = `<multistatus xmlns="DAV:" xmlns:cal="urn:ietf:params:xml:ns:caldav"><response><href>https://dav.example.com/dav/jan/home/</href><propstat><prop><resourcetype><collection/><cal:calendar/></resourcetype><displayname><![CDATA[Home <3]]></displayname><calendar-color xmlns="http://apple.com/ns/ical/">#0e61b9</calendar-color></prop><status>HTTP/1.1 200 OK</status></propstat></response></multistatus>`;
    const { caldav } = provider({ [`PROPFIND ${HOME}`]: { status: 207, text: answer } });
    expect(await caldav.listCalendars()).toEqual([{ providerId: "https://dav.example.com/dav/jan/home/", name: "Home <3", color: "#0e61b9", readOnly: false, primary: false, shown: true }]);
  });

  it("lists the events of a window, each occurrence of a repeating one", async () => {
    const answer = prefixed(
      `<D:response><D:href>/dav/jan/work/lunch.ics</D:href><D:propstat><D:prop><D:getetag>"etag-lunch"</D:getetag><C:calendar-data>${escaped(LUNCH)}</C:calendar-data></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>`,
      `<D:response><D:href>/dav/jan/work/standup.ics</D:href><D:propstat><D:prop><D:getetag>&quot;etag-standup&quot;</D:getetag><C:calendar-data><![CDATA[${STANDUP}]]></C:calendar-data></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>`,
      '<D:response><D:href>/dav/jan/work/broken.ics</D:href><D:propstat><D:prop><D:getetag>"x"</D:getetag><C:calendar-data>this is not a calendar</C:calendar-data></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>',
    );
    const { caldav, calls } = provider({ [`REPORT ${WORK}`]: { status: 207, text: answer } });
    const events = await caldav.listEvents(WORK, new Date("2026-10-01T00:00:00Z"), new Date("2026-11-01T00:00:00Z"));
    expect(events.map((e) => [e.providerId, e.start.toISOString(), e.etag, e.title])).toEqual([
      [`${WORK}lunch.ics`, "2026-10-07T10:00:00.000Z", '"etag-lunch"', "Lunch & <talk>"],
      [`${WORK}standup.ics#20261013T070000Z`, "2026-10-13T07:00:00.000Z", '"etag-standup"', "Stand-up"],
      [`${WORK}standup.ics#20261020T070000Z`, "2026-10-20T07:00:00.000Z", '"etag-standup"', "Stand-up"],
      [`${WORK}standup.ics#20261027T080000Z`, "2026-10-27T08:00:00.000Z", '"etag-standup"', "Stand-up"],
    ]);
    expect(events[0]).toMatchObject({ seriesId: null, uid: "lunch@example.com", canEdit: true, myStatus: null });
    // The owner's addresses and zone reach the events.
    expect(events[1]).toMatchObject({ seriesId: `${WORK}standup.ics`, canEdit: false, myStatus: "needsAction", recurrence: "FREQ=WEEKLY;COUNT=3" });
    expect(calls).toHaveLength(1);
    expect(calls[0].headers).toMatchObject({ Depth: "1", Authorization: BASIC });
    expect(calls[0].body).toContain('<c:time-range start="20261001T000000Z" end="20261101T000000Z"/>');
    expect(calls[0].body).toContain("<c:calendar-data/>");
  });

  it("asks for the events themselves when the server answers with addresses only", async () => {
    const hrefsOnly = `<multistatus xmlns="DAV:"><response><href>/dav/jan/work/</href><propstat><prop><getetag>"dir"</getetag></prop><status>HTTP/1.1 200 OK</status></propstat></response>
      <response><href>/dav/jan/work/lunch%20%26%20talk.ics</href><propstat><prop><getetag>"etag-lunch"</getetag></prop><status>HTTP/1.1 200 OK</status></propstat></response></multistatus>`;
    const full = `<multistatus xmlns="DAV:"><response><href>/dav/jan/work/lunch%20%26%20talk.ics</href><propstat><prop><getetag>"etag-lunch"</getetag><calendar-data xmlns="urn:ietf:params:xml:ns:caldav">${escaped(LUNCH)}</calendar-data></prop><status>HTTP/1.1 200 OK</status></propstat></response></multistatus>`;
    const { caldav, calls } = provider({ [`REPORT ${WORK}`]: (call) => ({ status: 207, text: call.body?.includes("calendar-multiget") ? full : hrefsOnly }) });
    const events = await caldav.listEvents(WORK, new Date("2026-10-01T00:00:00Z"), new Date("2026-11-01T00:00:00Z"));
    expect(events.map((e) => [e.providerId, e.etag])).toEqual([[`${WORK}lunch%20%26%20talk.ics`, '"etag-lunch"']]);
    expect(calls).toHaveLength(2);
    expect(calls[1].body).toContain("<d:href>/dav/jan/work/lunch%20%26%20talk.ics</d:href>");
    expect(calls[1].body).not.toContain("<d:href>/dav/jan/work/</d:href>");
  });

  it("says who refused and what failed", async () => {
    const refused = provider({ [`PROPFIND ${HOME}`]: { status: 401 }, [`REPORT ${WORK}`]: { status: 401 } });
    await expect(refused.caldav.listCalendars()).rejects.toBeInstanceOf(CalendarAuthError);
    await expect(refused.caldav.listEvents(WORK, new Date(0), new Date(1))).rejects.toBeInstanceOf(CalendarAuthError);
    const down = provider({ [`PROPFIND ${HOME}`]: { status: 503 } });
    await expect(down.caldav.listCalendars()).rejects.toThrow("CalDAV PROPFIND failed (503)");
    await expect(down.caldav.listEvents(WORK, new Date(0), new Date(1))).rejects.toThrow("CalDAV REPORT failed (404)");
  });
});

describe("CalDAV provider: changes", () => {
  it("creates an event as a new resource named after its UID", async () => {
    const { caldav, calls } = provider({}, { status: 201 });
    await caldav.createEvent("https://dav.example.com/dav/jan/work", draft({ attendees: [{ name: "Eva", email: "eva@example.com" }] }));
    const [put] = calls;
    const uid = /\r\nUID:([^\r]+)\r\n/.exec(put.body ?? "")?.[1];
    expect(uid).toMatch(/^[0-9a-f-]{36}$/);
    expect(put).toMatchObject({ method: "PUT", url: `${WORK}${uid}.ics`, headers: { Authorization: BASIC, "If-None-Match": "*", "Content-Type": "text/calendar; charset=utf-8" } });
    expect(put.headers).not.toHaveProperty("Prefer");
    const body = (put.body ?? "").replace(/\r\n /g, "");
    expect(body).toContain("DTSTART;TZID=Europe/Prague:20261006T090000");
    expect(body).toContain("SUMMARY:Planning");
    // The owner invites, and the server is told not to send the invitation itself.
    expect(body).toContain("ORGANIZER:mailto:jan@example.com");
    expect(body).toContain("ATTENDEE;CN=Eva;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE;SCHEDULE-AGENT=CLIENT:mailto:eva@example.com");
    // Nobody invited: no organizer either.
    await caldav.createEvent(WORK, draft());
    expect(calls[1].body).not.toContain("ORGANIZER");
    // The UID is taken, or the server says no.
    await expect(provider({}, { status: 412 }).caldav.createEvent(WORK, draft())).rejects.toBeInstanceOf(CalendarConflictError);
    await expect(provider({}, { status: 403 }).caldav.createEvent(WORK, draft())).rejects.toThrow("CalDAV PUT failed (403)");
  });

  it("updates an event: reads it, changes it, writes it back if nobody else did meanwhile", async () => {
    const { caldav, calls } = provider({
      [`GET ${WORK}lunch.ics`]: { status: 200, text: LUNCH, headers: { ETag: '"etag-2"' } },
      [`PUT ${WORK}lunch.ics`]: { status: 204 },
    });
    await caldav.updateEvent(WORK, ref(`${WORK}lunch.ics`, { etag: '"etag-1"' }), draft({ title: "Long lunch", start: new Date("2026-10-07T10:00:00Z"), end: new Date("2026-10-07T12:00:00Z") }), "this");
    expect(calls.map((c) => c.method)).toEqual(["GET", "PUT"]);
    expect(calls[1].headers).toMatchObject({ "If-Match": '"etag-2"', "Content-Type": "text/calendar; charset=utf-8", Authorization: BASIC });
    expect(calls[1].body).toContain("SUMMARY:Long lunch");
    expect(calls[1].body).toContain("DTEND;TZID=Europe/Prague:20261007T140000");
    expect(calls[1].body).toContain("UID:lunch@example.com");
  });

  it("throws CalendarConflictError when the event changed or went away meanwhile", async () => {
    const changed = provider({
      [`GET ${WORK}lunch.ics`]: { status: 200, text: LUNCH, headers: { etag: '"etag-2"' } },
      [`PUT ${WORK}lunch.ics`]: { status: 412 },
    });
    await expect(changed.caldav.updateEvent(WORK, ref(`${WORK}lunch.ics`), draft(), "all")).rejects.toBeInstanceOf(CalendarConflictError);
    const gone = provider({});
    await expect(gone.caldav.updateEvent(WORK, ref(`${WORK}lunch.ics`), draft(), "all")).rejects.toBeInstanceOf(CalendarConflictError);
    expect(gone.calls.map((c) => c.method)).toEqual(["GET"]);
    const refused = provider({ [`GET ${WORK}lunch.ics`]: { status: 401 } });
    await expect(refused.caldav.updateEvent(WORK, ref(`${WORK}lunch.ics`), draft(), "all")).rejects.toBeInstanceOf(CalendarAuthError);
  });

  it("changes one occurrence of a series inside its resource", async () => {
    const { caldav, calls } = provider({
      [`GET ${WORK}standup.ics`]: { status: 200, text: STANDUP, headers: { etag: '"s1"' } },
      [`PUT ${WORK}standup.ics`]: { status: 204 },
    });
    const occurrence = ref(`${WORK}standup.ics#20261020T070000Z`, { seriesId: `${WORK}standup.ics`, start: new Date("2026-10-20T07:00:00Z") });
    await caldav.updateEvent(WORK, occurrence, draft({ title: "Stand-up", start: new Date("2026-10-20T12:00:00Z"), end: new Date("2026-10-20T12:30:00Z"), recurrence: "FREQ=WEEKLY;COUNT=3" }), "this");
    const body = calls[1].body ?? "";
    expect(body.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    expect(body).toContain("RECURRENCE-ID;TZID=Europe/Prague:20261020T090000");
    expect(body).toContain("DTSTART;TZID=Europe/Prague:20261020T140000");
  });

  it("deletes a whole event with DELETE, and one occurrence by writing the series without it", async () => {
    const { caldav, calls } = provider({
      [`GET ${WORK}standup.ics`]: { status: 200, text: STANDUP, headers: { etag: '"s1"' } },
      [`PUT ${WORK}standup.ics`]: { status: 204 },
      [`DELETE ${WORK}standup.ics`]: { status: 204 },
    });
    const occurrence = ref(`${WORK}standup.ics#20261020T070000Z`, { seriesId: `${WORK}standup.ics` });

    await caldav.deleteEvent(WORK, occurrence, "this");
    expect(calls.map((c) => c.method)).toEqual(["GET", "PUT"]);
    expect(calls[1].headers).toMatchObject({ "If-Match": '"s1"' });
    expect(calls[1].body).toContain("EXDATE;TZID=Europe/Prague:20261020T090000");
    expect(calls[1].body).toContain("RRULE:FREQ=WEEKLY;COUNT=3");

    calls.length = 0;
    await caldav.deleteEvent(WORK, occurrence, "all");
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([`DELETE ${WORK}standup.ics`]);

    // A single event has no occurrences to pick from, and one that is already gone is deleted.
    calls.length = 0;
    await caldav.deleteEvent(WORK, ref(`${WORK}lunch.ics`), "this");
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([`DELETE ${WORK}lunch.ics`]);
    const failing = provider({ [`DELETE ${WORK}lunch.ics`]: { status: 403 } });
    await expect(failing.caldav.deleteEvent(WORK, ref(`${WORK}lunch.ics`), "all")).rejects.toThrow("CalDAV DELETE failed (403)");
  });

  it("throws CalendarConflictError when the series changed while one occurrence was being deleted", async () => {
    const { caldav } = provider({
      [`GET ${WORK}standup.ics`]: { status: 200, text: STANDUP, headers: { etag: '"s1"' } },
      [`PUT ${WORK}standup.ics`]: { status: 412 },
    });
    await expect(caldav.deleteEvent(WORK, ref(`${WORK}standup.ics#20261020T070000Z`), "this")).rejects.toBeInstanceOf(CalendarConflictError);
  });

  it("answers an invitation in the owner's own line", async () => {
    const { caldav, calls } = provider({
      [`GET ${WORK}standup.ics`]: { status: 200, text: STANDUP, headers: { etag: '"s1"' } },
      [`PUT ${WORK}standup.ics`]: { status: 204 },
      [`GET ${WORK}lunch.ics`]: { status: 200, text: LUNCH, headers: { etag: '"l1"' } },
    });
    await caldav.respond?.(WORK, ref(`${WORK}standup.ics#20261020T070000Z`), "accepted", "all");
    expect(calls[1]).toMatchObject({ method: "PUT", headers: { "If-Match": '"s1"' } });
    expect(calls[1].body).toContain("ATTENDEE;PARTSTAT=ACCEPTED:mailto:jan@example.com");
    expect(calls[1].body?.match(/BEGIN:VEVENT/g)).toHaveLength(1);

    calls.length = 0;
    await caldav.respond?.(WORK, ref(`${WORK}standup.ics#20261020T070000Z`), "declined", "this");
    expect(calls[1].body?.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    expect(calls[1].body).toContain("ATTENDEE;PARTSTAT=DECLINED:mailto:jan@example.com");

    // Not a guest there: nothing to write.
    calls.length = 0;
    await caldav.respond?.(WORK, ref(`${WORK}lunch.ics`), "accepted", "all");
    expect(calls.map((c) => c.method)).toEqual(["GET"]);
  });

  it("keeps the password on the calendar's own server", async () => {
    const { caldav, calls } = provider({});
    await expect(caldav.deleteEvent(WORK, ref("https://elsewhere.example.net/steal.ics"), "all")).rejects.toThrow("doesn't belong to this calendar");
    await expect(caldav.updateEvent(WORK, ref("not-an-address"), draft(), "all")).rejects.toThrow("doesn't belong to this calendar");
    expect(calls).toEqual([]);
  });
});
