import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { refreshAccessToken } from "../google";
import { mockFetch, tokenResponse } from "../mail/gmail/test-fixtures";
import { MailAuthError } from "../mail/types";
import { createGoogleProvider, exchangeGoogleCalendarCode, GOOGLE_CALENDAR_SCOPES, googleCalendarAuthUrl } from "./google";
import type { OAuthCredentials } from "./oauth";
import { CalendarAuthError, CalendarConflictError, type EventDraft, type EventRef } from "./types";

vi.mock("../google", async (original) => ({ ...(await original<typeof import("../google")>()), refreshAccessToken: vi.fn() }));

const refresh = vi.mocked(refreshAccessToken);

const EVENTS_SCOPE = "https://www.googleapis.com/auth/calendar.events";
const LIST_SCOPE = "https://www.googleapis.com/auth/calendar.calendarlist.readonly";
const API = "https://www.googleapis.com/calendar/v3";

const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", ...headers } });

interface Call {
  method: string;
  url: URL;
  /** Path under the API's base, without the query. */
  path: string;
  headers: Headers;
  body: unknown;
}

/** A fetch that answers from `handler` (404 when it returns nothing) and remembers what was asked. */
function fakeFetch(handler: (call: Call) => Response | undefined) {
  const calls: Call[] = [];
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const call: Call = {
      method: init?.method ?? "GET",
      url,
      path: decodeURIComponent(url.pathname.replace("/calendar/v3", "")),
      headers: new Headers(init?.headers),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    };
    calls.push(call);
    return handler(call) ?? json({ error: { code: 404, message: "Not Found" } }, 404);
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

const credentials = (extra: Partial<OAuthCredentials> = {}): OAuthCredentials => ({
  kind: "oauth",
  issuer: "google",
  refreshToken: "refresh-1",
  accessToken: "access-1",
  expiresAt: Date.now() + 3_600_000,
  ...extra,
});

function provider(handler: (call: Call) => Response | undefined, creds = credentials()) {
  const { fetch, calls } = fakeFetch(handler);
  const save = vi.fn(async () => {});
  const sleep = vi.fn(async () => {});
  return { google: createGoogleProvider({ credentials: creds, save }, { fetch, sleep }), calls, save, sleep };
}

const draft = (extra: Partial<EventDraft> = {}): EventDraft => ({
  title: "Roadmap review",
  location: "Room Birch",
  description: "Bring the numbers.",
  start: new Date("2026-11-12T09:00:00Z"),
  end: new Date("2026-11-12T10:00:00Z"),
  allDay: false,
  timeZone: "Europe/Prague",
  recurrence: null,
  attendees: [],
  ...extra,
});

const ref = (extra: Partial<EventRef> = {}): EventRef => ({
  providerId: "ev-1",
  seriesId: null,
  uid: "uid-1@calendar.example",
  etag: '"etag-1"',
  start: new Date("2026-11-12T09:00:00Z"),
  allDay: false,
  ...extra,
});

/** Unsigned JWT; the code only decodes the payload. */
const idToken = (claims: object) => ["{}", JSON.stringify(claims), "sig"].map((p) => Buffer.from(p).toString("base64url")).join(".");

beforeEach(() => {
  process.env.GOOGLE_CLIENT_ID = "client-id";
  process.env.GOOGLE_CLIENT_SECRET = "client-secret";
  refresh.mockReset();
  refresh.mockResolvedValue({ accessToken: "access-2", expiresAt: Date.now() + 3_600_000 });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("connecting", () => {
  it("asks for calendar access only, offline and with consent", () => {
    const verifier = "verifier-0123456789-0123456789-0123456789-0123";
    const url = googleCalendarAuthUrl({ state: "st", codeVerifier: verifier, loginHint: "nora@example.com" });
    const p = url.searchParams;
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(p.get("client_id")).toBe("client-id");
    expect(p.get("redirect_uri")).toBe("http://localhost:3000/api/accounts/google/callback");
    expect(p.get("scope")).toBe(`openid email ${EVENTS_SCOPE} ${LIST_SCOPE}`);
    expect(GOOGLE_CALENDAR_SCOPES).toEqual(["openid", "email", EVENTS_SCOPE, LIST_SCOPE]);
    expect(p.get("access_type")).toBe("offline");
    expect(p.get("prompt")).toBe("consent");
    expect(p.has("include_granted_scopes")).toBe(false);
    expect(p.get("login_hint")).toBe("nora@example.com");
    expect(p.get("state")).toBe("st");
    expect(p.get("code_challenge_method")).toBe("S256");
    expect(p.get("code_challenge")).toBe(createHash("sha256").update(verifier).digest("base64url"));
  });

  it("trades the code for tokens and the account's address", async () => {
    const calls = mockFetch(() =>
      tokenResponse("access-1", { refresh_token: "refresh-1", scope: `openid ${EVENTS_SCOPE} ${LIST_SCOPE}`, id_token: idToken({ email: "Nora@Example.com" }) }),
    );
    const grant = await exchangeGoogleCalendarCode("code-1", "verifier");
    expect(grant).toMatchObject({ refreshToken: "refresh-1", accessToken: "access-1", email: "nora@example.com" });
    expect(grant.scope).toContain(EVENTS_SCOPE);
    expect(grant.expiresAt).toBeGreaterThan(Date.now() + 3_500_000);
    const form = new URLSearchParams(calls[0].body);
    expect(form.get("code")).toBe("code-1");
    expect(form.get("code_verifier")).toBe("verifier");
    expect(form.get("redirect_uri")).toBe("http://localhost:3000/api/accounts/google/callback");
  });

  it("refuses a grant with the calendar checkbox unticked", async () => {
    mockFetch(() => tokenResponse("a", { refresh_token: "r", scope: `openid email ${LIST_SCOPE}`, id_token: idToken({ email: "nora@example.com" }) }));
    await expect(exchangeGoogleCalendarCode("c", "v")).rejects.toBeInstanceOf(CalendarAuthError);
  });
});

describe("access tokens", () => {
  const empty = () => json({ items: [] });

  it("reuses the stored token while it lasts", async () => {
    const { google, calls, save } = provider(empty);
    await google.listCalendars();
    expect(calls[0].headers.get("authorization")).toBe("Bearer access-1");
    expect(refresh).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it("refreshes a token that ends within a minute, and saves the new credentials", async () => {
    const creds = credentials({ expiresAt: Date.now() + 30_000, scope: EVENTS_SCOPE });
    const expiresAt = Date.now() + 3_600_000;
    refresh.mockResolvedValue({ accessToken: "access-2", expiresAt, refreshToken: undefined, scope: undefined });
    const { google, calls, save } = provider(empty, creds);
    await google.listCalendars();
    await google.listCalendars();
    expect(refresh).toHaveBeenCalledExactlyOnceWith("refresh-1");
    expect(save).toHaveBeenCalledExactlyOnceWith({ kind: "oauth", issuer: "google", refreshToken: "refresh-1", accessToken: "access-2", expiresAt, scope: EVENTS_SCOPE });
    expect(calls.map((c) => c.headers.get("authorization"))).toEqual(["Bearer access-2", "Bearer access-2"]);
  });

  it("refreshes when no token is stored, once for requests running side by side", async () => {
    const { google, save } = provider(empty, { kind: "oauth", issuer: "google", refreshToken: "refresh-1" });
    await Promise.all([google.listCalendars(), google.listCalendars()]);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("gets a new token when Google refuses the stored one, and asks again", async () => {
    const { google, calls } = provider((call) => (call.headers.get("authorization") === "Bearer access-1" ? json({ error: { message: "Invalid Credentials" } }, 401) : empty()));
    await expect(google.listCalendars()).resolves.toEqual([]);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(calls.map((c) => c.headers.get("authorization"))).toEqual(["Bearer access-1", "Bearer access-2"]);
  });

  it("gives up with CalendarAuthError when the fresh token is refused too", async () => {
    const { google, calls } = provider(() => json({ error: { message: "Invalid Credentials" } }, 401));
    await expect(google.listCalendars()).rejects.toBeInstanceOf(CalendarAuthError);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(2);
  });

  it("turns a revoked grant into CalendarAuthError", async () => {
    refresh.mockRejectedValue(new MailAuthError("Google access was revoked; reconnect the account", "oauth_revoked"));
    const { google, calls } = provider(empty, credentials({ expiresAt: 0 }));
    await expect(google.listCalendars()).rejects.toBeInstanceOf(CalendarAuthError);
    expect(calls).toHaveLength(0);
  });

  it("reads a 403 for missing permission as a sign-in problem, other 403s as plain errors", async () => {
    const denied = provider(() => json({ error: { code: 403, message: "Insufficient Permission", errors: [{ reason: "insufficientPermissions" }] } }, 403));
    await expect(denied.google.listCalendars()).rejects.toBeInstanceOf(CalendarAuthError);
    const narrowed = provider(() => json({ error: { code: 403, status: "PERMISSION_DENIED", details: [{ reason: "ACCESS_TOKEN_SCOPE_INSUFFICIENT" }] } }, 403));
    await expect(narrowed.google.listCalendars()).rejects.toBeInstanceOf(CalendarAuthError);
    const forbidden = provider(() => json({ error: { code: 403, message: "Forbidden", errors: [{ reason: "forbidden" }] } }, 403));
    const error = await forbidden.google.listCalendars().catch((e: unknown) => e);
    expect(error).not.toBeInstanceOf(CalendarAuthError);
    expect((error as Error).message).toBe("Google Calendar: HTTP 403 Forbidden");
  });

  it("tries a busy server once more, after the wait it asked for (five seconds at most)", async () => {
    let n = 0;
    const busy = provider(() => (n++ === 0 ? json({}, 429, { "retry-after": "2" }) : empty()));
    await expect(busy.google.listCalendars()).resolves.toEqual([]);
    expect(busy.sleep).toHaveBeenCalledExactlyOnceWith(2000);

    n = 0;
    const patient = provider(() => (n++ === 0 ? json({}, 503, { "retry-after": "120" }) : empty()));
    await patient.google.listCalendars();
    expect(patient.sleep).toHaveBeenCalledExactlyOnceWith(5000);

    const down = provider(() => json({ error: { message: "Backend Error" } }, 500));
    await expect(down.google.listCalendars()).rejects.toThrow("Google Calendar: HTTP 500 Backend Error");
    expect(down.calls).toHaveLength(2);
    expect(down.sleep).toHaveBeenCalledExactlyOnceWith(1000);
  });

  it("sets a time limit on every request", async () => {
    const { fetch } = fakeFetch(empty);
    const spy = vi.fn(fetch);
    await createGoogleProvider({ credentials: credentials(), save: async () => {} }, { fetch: spy }).listCalendars();
    expect(spy.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
  });
});

describe("listCalendars", () => {
  it("maps the list, page by page, without deleted calendars", async () => {
    const { google, calls } = provider((call) =>
      call.url.searchParams.get("pageToken") === "page-2"
        ? json({
            items: [
              { id: "team@group.calendar.google.com", summary: "Team", backgroundColor: "#0b8043", accessRole: "reader", selected: false },
              { id: "gone", summary: "Old", deleted: true },
              { id: "holidays", summary: "Holidays", accessRole: "freeBusyReader" },
            ],
          })
        : json({
            items: [{ id: "nora@example.com", summary: "nora@example.com", summaryOverride: "Mine", backgroundColor: "#9a9cff", accessRole: "owner", primary: true }],
            nextPageToken: "page-2",
          }),
    );
    expect(await google.listCalendars()).toEqual([
      { providerId: "nora@example.com", name: "Mine", color: "#9a9cff", readOnly: false, primary: true, shown: true },
      { providerId: "team@group.calendar.google.com", name: "Team", color: "#0b8043", readOnly: true, primary: false, shown: false },
      { providerId: "holidays", name: "Holidays", color: null, readOnly: true, primary: false, shown: false },
    ]);
    expect(calls.map((c) => c.path)).toEqual(["/users/me/calendarList", "/users/me/calendarList"]);
  });
});

describe("listEvents", () => {
  const owner = { email: "nora@example.com", self: true };
  const prague = (dateTime: string) => ({ dateTime, timeZone: "Europe/Prague" });
  const events = [
    {
      id: "timed",
      status: "confirmed",
      etag: '"e-timed"',
      iCalUID: "timed@calendar.example",
      htmlLink: "https://calendar.example/event?eid=timed",
      summary: "Roadmap review",
      location: "Room Birch",
      description: "Bring the numbers.",
      start: prague("2026-11-12T10:00:00+01:00"),
      end: prague("2026-11-12T11:00:00+01:00"),
      organizer: owner,
    },
    { id: "allday", summary: "Offsite", start: { date: "2026-11-13" }, end: { date: "2026-11-15" }, organizer: owner },
    {
      id: "standup_20261116T080000Z",
      recurringEventId: "standup",
      summary: "Standup",
      hangoutLink: "https://meet.google.com/abc-defg-hij",
      start: prague("2026-11-16T09:00:00+01:00"),
      end: prague("2026-11-16T09:15:00+01:00"),
      organizer: owner,
    },
    { id: "standup_20261117T080000Z", recurringEventId: "standup", status: "cancelled" },
    { id: "office", eventType: "workingLocation", start: { date: "2026-11-16" }, end: { date: "2026-11-17" } },
    {
      id: "invited",
      summary: "Supplier call",
      location: "https://meet.example.com/room/42",
      description: '<p>Agenda:</p><ul><li>Prices &amp; terms</li><li>Dates</li></ul>See <a href="https://docs.example.com/a?x=1&amp;y=2">the notes</a><br>Bye&nbsp;now',
      start: { dateTime: "2026-11-18T14:00:00Z" },
      end: { dateTime: "2026-11-18T15:00:00Z" },
      organizer: { email: "ivo@example.com", displayName: "Ivo Marek" },
      attendees: [
        { email: "ivo@example.com", displayName: "Ivo Marek", organizer: true, responseStatus: "accepted" },
        { email: "nora@example.com", self: true, responseStatus: "tentative" },
        { email: "room-birch@resource.calendar.example", resource: true, responseStatus: "accepted" },
        { email: "lea@example.com", responseStatus: "declined" },
        { email: "new@example.com", responseStatus: "needsAction" },
      ],
    },
    {
      id: "shared",
      summary: "Team lunch",
      description: "Join: https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc/0 or come in person",
      start: { dateTime: "2026-11-19T12:00:00+01:00" },
      end: { dateTime: "2026-11-19T13:00:00+01:00" },
      organizer: { email: "team123@group.calendar.google.com", displayName: "Team", self: true },
      conferenceData: { entryPoints: [{ entryPointType: "phone", uri: "tel:+420000000000" }] },
    },
    {
      id: "guests-can-edit",
      summary: "Planning",
      start: { dateTime: "2026-11-19T15:00:00Z" },
      end: { dateTime: "2026-11-19T16:00:00Z" },
      organizer: { email: "ivo@example.com" },
      guestsCanModify: true,
      conferenceData: { entryPoints: [{ entryPointType: "phone", uri: "tel:+420000000000" }, { entryPointType: "video", uri: "https://video.example.com/j/77" }] },
    },
    { id: "birthday", eventType: "birthday", summary: "Lea's birthday", start: { date: "2026-11-20" }, end: { date: "2026-11-21" } },
  ];

  it("maps what Google lists and gives each occurrence its series' rule", async () => {
    const { google, calls } = provider((call) => {
      if (call.path !== "/calendars/nora@example.com/events") return undefined;
      if (call.url.searchParams.get("singleEvents") === "false") {
        return json({ items: [{ id: "timed" }, { id: "standup", recurrence: ["EXDATE;TZID=Europe/Prague:20261118T090000", "RRULE:FREQ=WEEKLY;BYDAY=MO,TU"] }] });
      }
      return call.url.searchParams.get("pageToken") ? json({ items: events.slice(3) }) : json({ items: events.slice(0, 3), nextPageToken: "next" });
    });
    const from = new Date("2026-11-09T00:00:00Z");
    const to = new Date("2026-11-23T00:00:00Z");
    const listed = await google.listEvents("nora@example.com", from, to);

    const occurrences = calls.find((c) => c.url.searchParams.get("singleEvents") === "true")!.url.searchParams;
    expect(Object.fromEntries(occurrences)).toEqual({ singleEvents: "true", timeMin: "2026-11-09T00:00:00.000Z", timeMax: "2026-11-23T00:00:00.000Z", maxResults: "2500", showDeleted: "false" });
    const series = calls.find((c) => c.url.searchParams.get("singleEvents") === "false")!.url.searchParams;
    expect(series.get("fields")).toBe("items(id,recurrence),nextPageToken");
    expect(series.get("timeMin")).toBe("2026-11-09T00:00:00.000Z");
    expect(calls).toHaveLength(3);

    expect(listed.map((e) => e.providerId)).toEqual(["timed", "allday", "standup_20261116T080000Z", "invited", "shared", "guests-can-edit", "birthday"]);
    const [timed, allDay, standup, invited, shared, guests, birthday] = listed;
    expect(timed).toEqual({
      providerId: "timed",
      seriesId: null,
      uid: "timed@calendar.example",
      etag: '"e-timed"',
      title: "Roadmap review",
      location: "Room Birch",
      description: "Bring the numbers.",
      start: new Date("2026-11-12T09:00:00Z"),
      end: new Date("2026-11-12T10:00:00Z"),
      allDay: false,
      timeZone: "Europe/Prague",
      recurrence: null,
      organizer: { name: "", email: "nora@example.com" },
      attendees: [],
      myStatus: null,
      joinUrl: null,
      url: "https://calendar.example/event?eid=timed",
      canEdit: true,
    });
    expect(allDay).toMatchObject({ start: new Date("2026-11-13T00:00:00Z"), end: new Date("2026-11-15T00:00:00Z"), allDay: true, timeZone: null, uid: null, etag: null, url: null });
    expect(standup).toMatchObject({ seriesId: "standup", recurrence: "FREQ=WEEKLY;BYDAY=MO,TU", joinUrl: "https://meet.google.com/abc-defg-hij", canEdit: true });

    expect(invited.description).toBe("Agenda:\nPrices & terms\nDates\nSee the notes\nBye now");
    expect(invited.organizer).toEqual({ name: "Ivo Marek", email: "ivo@example.com" });
    expect(invited.attendees).toEqual([
      { name: "Ivo Marek", email: "ivo@example.com", status: "accepted" },
      { name: "", email: "nora@example.com", status: "tentative" },
      { name: "", email: "lea@example.com", status: "declined" },
      { name: "", email: "new@example.com", status: "needsAction" },
    ]);
    expect(invited).toMatchObject({ myStatus: "tentative", canEdit: false, joinUrl: "https://meet.example.com/room/42" });

    // Made in a shared calendar: nobody organizes it, and the link is found in the text.
    expect(shared).toMatchObject({ organizer: null, myStatus: null, canEdit: true, joinUrl: "https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc/0" });
    expect(guests).toMatchObject({ canEdit: true, joinUrl: "https://video.example.com/j/77" });
    expect(birthday.canEdit).toBe(false);
  });

  it("cuts a very long description", async () => {
    const { google } = provider(() => json({ items: [{ id: "long", description: "x".repeat(9000), start: { date: "2026-11-13" }, end: { date: "2026-11-14" } }] }));
    const [event] = await google.listEvents("primary", new Date("2026-11-09T00:00:00Z"), new Date("2026-11-23T00:00:00Z"));
    expect(event.description).toHaveLength(8000);
  });
});

describe("createEvent", () => {
  const created = () => json({ id: "new" });

  it("posts a timed event, telling nobody when nobody is invited", async () => {
    const { google, calls } = provider(created);
    await google.createEvent("nora@example.com", draft());
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("POST");
    expect(calls[0].url.href).toBe(`${API}/calendars/nora%40example.com/events?sendUpdates=none`);
    expect(calls[0].headers.get("content-type")).toBe("application/json");
    expect(calls[0].body).toEqual({
      summary: "Roadmap review",
      location: "Room Birch",
      description: "Bring the numbers.",
      start: { dateTime: "2026-11-12T09:00:00.000Z", timeZone: "Europe/Prague" },
      end: { dateTime: "2026-11-12T10:00:00.000Z", timeZone: "Europe/Prague" },
    });
  });

  it("posts an all-day event with dates", async () => {
    const { google, calls } = provider(created);
    await google.createEvent("primary", draft({ allDay: true, start: new Date("2026-11-13T00:00:00Z"), end: new Date("2026-11-15T00:00:00Z") }));
    expect(calls[0].body).toMatchObject({ start: { date: "2026-11-13" }, end: { date: "2026-11-15" } });
  });

  it("posts a repeating event with its rule, and lets Google invite the guests", async () => {
    const { google, calls } = provider(created);
    await google.createEvent("primary", draft({ recurrence: "FREQ=WEEKLY;BYDAY=TH", attendees: [{ name: "Ivo Marek", email: "ivo@example.com" }, { name: "", email: "lea@example.com" }] }));
    expect(calls[0].url.searchParams.get("sendUpdates")).toBe("all");
    expect(calls[0].body).toMatchObject({
      recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=TH"],
      attendees: [{ email: "ivo@example.com", displayName: "Ivo Marek" }, { email: "lea@example.com" }],
    });
  });
});

describe("updateEvent", () => {
  const prague = (dateTime: string) => ({ dateTime, timeZone: "Europe/Prague" });
  /** A weekly series first held on Tuesday 6 January 2026 at 10:00 in Prague, half an hour long. */
  const master = { id: "weekly", summary: "Sync", start: prague("2026-01-06T10:00:00+01:00"), end: prague("2026-01-06T10:30:00+01:00"), recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=TU"] };
  /** Its occurrence on 24 March, the last one before the clocks change. */
  const occurrence = { id: "weekly_20260324T090000Z", recurringEventId: "weekly", summary: "Sync", start: prague("2026-03-24T10:00:00+01:00"), end: prague("2026-03-24T10:30:00+01:00") };
  const occurrenceRef = ref({ providerId: occurrence.id, seriesId: "weekly", start: new Date("2026-03-24T09:00:00Z") });
  const series = (extra: object = {}) => (call: Call) => {
    if (call.method === "PATCH") return json({});
    if (call.path.endsWith("/weekly")) return json({ ...master, ...extra });
    if (call.path.endsWith(`/${occurrence.id}`)) return json(occurrence);
    return undefined;
  };
  const patchOf = (calls: Call[]) => calls.find((c) => c.method === "PATCH")!;

  it("changes a single event in place, only if it's still as we read it", async () => {
    const stored = { id: "ev-1", summary: "Old title", description: "Bring the numbers.", start: prague("2026-11-12T10:00:00+01:00"), end: prague("2026-11-12T11:00:00+01:00") };
    const { google, calls } = provider((call) => (call.method === "GET" ? json(stored) : json({})));
    await google.updateEvent("primary", ref(), draft({ start: new Date("2026-11-12T13:00:00Z"), end: new Date("2026-11-12T14:00:00Z"), recurrence: "FREQ=DAILY;COUNT=3" }), "all");
    const patch = patchOf(calls);
    expect(patch.url.href).toBe(`${API}/calendars/primary/events/ev-1?sendUpdates=none`);
    expect(patch.headers.get("if-match")).toBe('"etag-1"');
    expect(patch.body).toEqual({
      summary: "Roadmap review",
      location: "Room Birch",
      start: { dateTime: "2026-11-12T13:00:00.000Z", timeZone: "Europe/Prague", date: null },
      end: { dateTime: "2026-11-12T14:00:00.000Z", timeZone: "Europe/Prague", date: null },
      recurrence: ["RRULE:FREQ=DAILY;COUNT=3"],
    });
  });

  it("leaves alone what the user didn't change: times, a formatted description", async () => {
    const stored = { id: "ev-1", description: "<b>Bring</b> the numbers.", start: prague("2026-11-12T10:00:00+01:00"), end: prague("2026-11-12T11:00:00+01:00") };
    const { google, calls } = provider((call) => (call.method === "GET" ? json(stored) : json({})));
    await google.updateEvent("primary", ref(), draft({ title: "New title" }), "this");
    expect(patchOf(calls).body).toEqual({ summary: "New title", location: "Room Birch" });
  });

  it("turns a timed event into an all-day one", async () => {
    const stored = { id: "ev-1", start: prague("2026-11-12T10:00:00+01:00"), end: prague("2026-11-12T11:00:00+01:00") };
    const { google, calls } = provider((call) => (call.method === "GET" ? json(stored) : json({})));
    await google.updateEvent("primary", ref(), draft({ allDay: true, start: new Date("2026-11-12T00:00:00Z"), end: new Date("2026-11-13T00:00:00Z") }), "this");
    expect(patchOf(calls).body).toMatchObject({ start: { date: "2026-11-12", dateTime: null, timeZone: null }, end: { date: "2026-11-13", dateTime: null, timeZone: null } });
  });

  it("reports an event that changed in the meantime", async () => {
    const { google } = provider((call) => (call.method === "GET" ? json({ id: "ev-1" }) : json({ error: { message: "Precondition Failed" } }, 412)));
    await expect(google.updateEvent("primary", ref(), draft(), "this")).rejects.toBeInstanceOf(CalendarConflictError);
  });

  it("changes one occurrence by its own id, without the series' rule", async () => {
    const { google, calls } = provider(series());
    const moved = draft({ title: "Sync", start: new Date("2026-03-24T13:00:00Z"), end: new Date("2026-03-24T13:30:00Z"), recurrence: "FREQ=WEEKLY;BYDAY=TU" });
    await google.updateEvent("primary", occurrenceRef, moved, "this");
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([`GET /calendars/primary/events/${occurrence.id}`, `PATCH /calendars/primary/events/${occurrence.id}`]);
    const patch = patchOf(calls);
    expect(patch.headers.has("if-match")).toBe(false);
    expect(patch.body).toMatchObject({ start: { dateTime: "2026-03-24T13:00:00.000Z" }, end: { dateTime: "2026-03-24T13:30:00.000Z" } });
    expect(patch.body).not.toHaveProperty("recurrence");
  });

  it("moves the whole series by as much as the occurrence moved, on the clocks of its zone", async () => {
    const { google, calls } = provider(series());
    // 24 March 10:00 → 31 March 11:00 Prague time (summer time by then), an hour long.
    const moved = draft({ title: "Sync", start: new Date("2026-03-31T09:00:00Z"), end: new Date("2026-03-31T10:00:00Z"), recurrence: "FREQ=WEEKLY;BYDAY=TU" });
    await google.updateEvent("primary", occurrenceRef, moved, "all");
    const patch = patchOf(calls);
    expect(patch.url.href).toBe(`${API}/calendars/primary/events/weekly?sendUpdates=none`);
    expect(patch.headers.has("if-match")).toBe(false);
    // A week and an hour later than 6 January 10:00, which is still winter time.
    expect(patch.body).toEqual({
      summary: "Sync",
      location: "Room Birch",
      description: "Bring the numbers.",
      start: { dateTime: "2026-01-13T10:00:00.000Z", timeZone: "Europe/Prague", date: null },
      end: { dateTime: "2026-01-13T11:00:00.000Z", timeZone: "Europe/Prague", date: null },
    });
  });

  it("keeps the series' own day when only the hour changed", async () => {
    const { google, calls } = provider(series());
    await google.updateEvent("primary", occurrenceRef, draft({ start: new Date("2026-03-24T14:00:00Z"), end: new Date("2026-03-24T14:30:00Z") }), "all");
    expect(patchOf(calls).body).toMatchObject({ start: { dateTime: "2026-01-06T14:00:00.000Z" }, end: { dateTime: "2026-01-06T14:30:00.000Z" } });
  });

  it("doesn't touch the series' times when the occurrence stayed where it was", async () => {
    const { google, calls } = provider(series());
    const same = draft({ title: "Weekly sync", start: new Date("2026-03-24T09:00:00Z"), end: new Date("2026-03-24T09:30:00Z"), recurrence: "FREQ=WEEKLY;BYDAY=TU" });
    await google.updateEvent("primary", occurrenceRef, same, "all");
    expect(patchOf(calls).body).toEqual({ summary: "Weekly sync", location: "Room Birch", description: "Bring the numbers." });
  });

  it("sends a changed rule, keeping the series' other lines, and reads no rule as no change", async () => {
    const withExdate = series({ recurrence: ["EXDATE;TZID=Europe/Prague:20260210T100000", "RRULE:FREQ=WEEKLY;BYDAY=TU"] });
    const changed = provider(withExdate);
    const same = { start: new Date("2026-03-24T09:00:00Z"), end: new Date("2026-03-24T09:30:00Z") };
    await changed.google.updateEvent("primary", occurrenceRef, draft({ ...same, recurrence: "FREQ=WEEKLY;INTERVAL=2;BYDAY=TU" }), "all");
    expect(patchOf(changed.calls).body).toMatchObject({ recurrence: ["EXDATE;TZID=Europe/Prague:20260210T100000", "RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=TU"] });

    const unknown = provider(withExdate);
    await unknown.google.updateEvent("primary", occurrenceRef, draft({ ...same, recurrence: null }), "all");
    expect(patchOf(unknown.calls).body).not.toHaveProperty("recurrence");
  });

  it("moves an all-day series by whole days", async () => {
    const allDayMaster = { id: "weekly", start: { date: "2026-01-06" }, end: { date: "2026-01-07" }, recurrence: ["RRULE:FREQ=WEEKLY"] };
    const allDayOccurrence = { id: "weekly_20260324", recurringEventId: "weekly", start: { date: "2026-03-24" }, end: { date: "2026-03-25" } };
    const { google, calls } = provider((call) => (call.method === "PATCH" ? json({}) : json(call.path.endsWith("/weekly") ? allDayMaster : allDayOccurrence)));
    const moved = draft({ allDay: true, start: new Date("2026-03-26T00:00:00Z"), end: new Date("2026-03-28T00:00:00Z") });
    await google.updateEvent("primary", ref({ providerId: "weekly_20260324", seriesId: "weekly", allDay: true, start: new Date("2026-03-24T00:00:00Z") }), moved, "all");
    expect(patchOf(calls).body).toMatchObject({ start: { date: "2026-01-08", dateTime: null, timeZone: null }, end: { date: "2026-01-10", dateTime: null, timeZone: null } });
  });

  it("tells the guests, and sends the guest list only when it changed, with the answers kept", async () => {
    const attendees = [
      { email: "nora@example.com", self: true, organizer: true, responseStatus: "accepted" },
      { email: "ivo@example.com", displayName: "Ivo Marek", responseStatus: "accepted", comment: "See you" },
      { email: "lea@example.com", responseStatus: "declined" },
      { email: "room-birch@resource.calendar.example", resource: true, responseStatus: "accepted" },
    ];
    const stored = { id: "ev-1", description: "Bring the numbers.", start: prague("2026-11-12T10:00:00+01:00"), end: prague("2026-11-12T11:00:00+01:00"), attendees };
    const handler = (call: Call) => (call.method === "GET" ? json(stored) : json({}));

    const untouched = provider(handler);
    await untouched.google.updateEvent("primary", ref(), draft({ attendees: [{ name: "Lea", email: "LEA@example.com" }, { name: "Ivo Marek", email: "ivo@example.com" }] }), "this");
    expect(patchOf(untouched.calls).url.searchParams.get("sendUpdates")).toBe("all");
    expect(patchOf(untouched.calls).body).not.toHaveProperty("attendees");

    const changed = provider(handler);
    await changed.google.updateEvent("primary", ref(), draft({ attendees: [{ name: "Ivo Marek", email: "ivo@example.com" }, { name: "Otto Novak", email: "otto@example.com" }] }), "this");
    expect(patchOf(changed.calls).body).toMatchObject({
      attendees: [attendees[0], attendees[3], attendees[1], { email: "otto@example.com", displayName: "Otto Novak" }],
    });

    // The last guest taken off still hears that the event changed for them.
    const emptied = provider(handler);
    await emptied.google.updateEvent("primary", ref(), draft(), "this");
    expect(patchOf(emptied.calls).url.searchParams.get("sendUpdates")).toBe("all");
    expect(patchOf(emptied.calls).body).toMatchObject({ attendees: [attendees[0], attendees[3]] });
  });
});

describe("deleteEvent", () => {
  it("deletes one occurrence or the whole series, telling the guests", async () => {
    const { google, calls } = provider(() => new Response(null, { status: 204 }));
    const occurrence = ref({ providerId: "weekly_20260324T090000Z", seriesId: "weekly" });
    await google.deleteEvent("primary", occurrence, "this");
    await google.deleteEvent("primary", occurrence, "all");
    await google.deleteEvent("primary", ref(), "all");
    expect(calls.map((c) => `${c.method} ${c.url.href}`)).toEqual([
      `DELETE ${API}/calendars/primary/events/weekly_20260324T090000Z?sendUpdates=all`,
      `DELETE ${API}/calendars/primary/events/weekly?sendUpdates=all`,
      `DELETE ${API}/calendars/primary/events/ev-1?sendUpdates=all`,
    ]);
  });

  it("is content when the event is already gone", async () => {
    for (const status of [404, 410]) {
      const { google } = provider(() => json({ error: { message: "Gone" } }, status));
      await expect(google.deleteEvent("primary", ref(), "this")).resolves.toBeUndefined();
    }
    const { google } = provider(() => json({ error: { message: "Forbidden" } }, 403));
    await expect(google.deleteEvent("primary", ref(), "this")).rejects.toThrow("HTTP 403");
  });
});

describe("respond", () => {
  const attendees = [
    { email: "ivo@example.com", organizer: true, responseStatus: "accepted" },
    { email: "nora@example.com", self: true, responseStatus: "needsAction" },
  ];

  it("writes the answer onto the owner's own entry and lets Google tell the organizer", async () => {
    const { google, calls } = provider((call) => (call.method === "GET" ? json({ id: "x", attendees }) : json({})));
    const occurrence = ref({ providerId: "weekly_20260324T090000Z", seriesId: "weekly" });
    await google.respond!("primary", occurrence, "accepted", "this");
    await google.respond!("primary", occurrence, "declined", "all");
    expect(calls.map((c) => `${c.method} ${c.path}${c.url.search}`)).toEqual([
      "GET /calendars/primary/events/weekly_20260324T090000Z",
      "PATCH /calendars/primary/events/weekly_20260324T090000Z?sendUpdates=all",
      "GET /calendars/primary/events/weekly",
      "PATCH /calendars/primary/events/weekly?sendUpdates=all",
    ]);
    expect(calls[1].body).toEqual({ attendees: [attendees[0], { ...attendees[1], responseStatus: "accepted" }] });
    expect(calls[3].body).toEqual({ attendees: [attendees[0], { ...attendees[1], responseStatus: "declined" }] });
  });

  it("refuses when the owner isn't among the guests", async () => {
    const { google, calls } = provider(() => json({ id: "x", attendees: [attendees[0]] }));
    await expect(google.respond!("primary", ref(), "accepted", "this")).rejects.toThrow("isn't invited");
    expect(calls).toHaveLength(1);
  });
});

it("emails the guests itself", () => {
  expect(provider(() => undefined).google.sendsInvitations).toBe(true);
});
