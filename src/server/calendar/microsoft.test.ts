import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MailAuthError } from "../mail/types";
import { refreshMicrosoftToken } from "../microsoft";
import { createMicrosoftProvider, exchangeMicrosoftCalendarCode, GRAPH_CALENDAR_SCOPE, microsoftCalendarAuthUrl, recurrenceToRrule, rruleToRecurrence } from "./microsoft";
import type { OAuthCredentials } from "./oauth";
import { CalendarAuthError, type EventDraft, type EventRef } from "./types";

vi.mock("../microsoft", async (original) => ({ ...(await original<typeof import("../microsoft")>()), refreshMicrosoftToken: vi.fn() }));

const refresh = vi.mocked(refreshMicrosoftToken);

const GRAPH = "https://graph.microsoft.com/v1.0";

const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", ...headers } });

interface Call {
  method: string;
  url: URL;
  /** Path under /v1.0, without the query. */
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
      path: decodeURIComponent(url.pathname.replace("/v1.0", "")),
      headers: new Headers(init?.headers),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    };
    calls.push(call);
    return handler(call) ?? json({ error: { code: "ErrorItemNotFound", message: "Not found" } }, 404);
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

const credentials = (extra: Partial<OAuthCredentials> = {}): OAuthCredentials => ({
  kind: "oauth",
  issuer: "microsoft",
  refreshToken: "refresh-1",
  accessToken: "access-1",
  expiresAt: Date.now() + 3_600_000,
  ...extra,
});

function provider(handler: (call: Call) => Response | undefined, creds = credentials()) {
  const { fetch, calls } = fakeFetch(handler);
  const save = vi.fn(async () => {});
  const sleep = vi.fn(async () => {});
  return { outlook: createMicrosoftProvider({ credentials: creds, save }, { fetch, sleep }), calls, save, sleep };
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
  uid: "uid-1",
  etag: 'W/"etag-1"',
  start: new Date("2026-11-12T09:00:00Z"),
  allDay: false,
  ...extra,
});

/** A time as Graph writes it when asked for UTC. */
const utc = (dateTime: string) => ({ dateTime: `${dateTime}.0000000`, timeZone: "UTC" });

/** Unsigned JWT; the code only decodes the payload. */
const idToken = (claims: object) => ["{}", JSON.stringify(claims), "sig"].map((p) => Buffer.from(p).toString("base64url")).join(".");

beforeEach(() => {
  process.env.MICROSOFT_CLIENT_ID = "ms-client-id";
  process.env.MICROSOFT_CLIENT_SECRET = "ms-client-secret";
  refresh.mockReset();
  refresh.mockResolvedValue({ accessToken: "access-2", expiresAt: Date.now() + 3_600_000, refreshToken: "refresh-2" });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("connecting", () => {
  it("asks for the calendar on the redirect address mailboxes already use", () => {
    const verifier = "verifier-0123456789-0123456789-0123456789-0123";
    const url = microsoftCalendarAuthUrl({ state: "st", codeVerifier: verifier, loginHint: "nora@example.com" });
    const p = url.searchParams;
    expect(url.origin + url.pathname).toBe("https://login.microsoftonline.com/common/oauth2/v2.0/authorize");
    expect(p.get("client_id")).toBe("ms-client-id");
    expect(p.get("response_type")).toBe("code");
    expect(p.get("redirect_uri")).toBe("http://localhost:3000/api/accounts/microsoft/callback");
    expect(p.get("scope")).toBe(`openid email profile offline_access ${GRAPH_CALENDAR_SCOPE}`);
    expect(p.get("state")).toBe("st");
    expect(p.get("code_challenge_method")).toBe("S256");
    expect(p.get("code_challenge")).toBe(createHash("sha256").update(verifier).digest("base64url"));
    expect(p.get("prompt")).toBe("select_account");
    expect(p.get("login_hint")).toBe("nora@example.com");
  });

  it("trades the code for tokens and the account's address", async () => {
    const tokenFetch = vi.fn<typeof fetch>(async () =>
      json({ access_token: "access-1", refresh_token: "refresh-1", expires_in: 3600, scope: `openid profile email ${GRAPH_CALENDAR_SCOPE}`, id_token: idToken({ preferred_username: "Nora@Example.com" }) }),
    );
    vi.stubGlobal("fetch", tokenFetch);
    const grant = await exchangeMicrosoftCalendarCode("code-1", "verifier");
    expect(grant).toMatchObject({ refreshToken: "refresh-1", accessToken: "access-1", email: "nora@example.com", scope: `openid profile email ${GRAPH_CALENDAR_SCOPE}` });
    expect(grant.expiresAt).toBeGreaterThan(Date.now() + 3_500_000);
    const [url, init] = tokenFetch.mock.calls[0];
    expect(String(url)).toBe("https://login.microsoftonline.com/common/oauth2/v2.0/token");
    const form = new URLSearchParams(String(init?.body));
    expect(form.get("grant_type")).toBe("authorization_code");
    expect(form.get("code")).toBe("code-1");
    expect(form.get("code_verifier")).toBe("verifier");
    expect(form.get("redirect_uri")).toBe("http://localhost:3000/api/accounts/microsoft/callback");
    expect(form.get("scope")).toContain(GRAPH_CALENDAR_SCOPE);
  });

  it("refuses a grant without calendar access", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ access_token: "a", refresh_token: "r", expires_in: 3600, scope: "openid profile email", id_token: idToken({ email: "nora@example.com" }) })));
    await expect(exchangeMicrosoftCalendarCode("c", "v")).rejects.toBeInstanceOf(CalendarAuthError);
  });
});

describe("access tokens", () => {
  const empty = () => json({ value: [] });

  it("reuses the stored token while it lasts", async () => {
    const { outlook, calls, save } = provider(empty);
    await outlook.listCalendars();
    expect(calls[0].headers.get("authorization")).toBe("Bearer access-1");
    expect(refresh).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it("refreshes for Graph's calendar scope and saves the refresh token Microsoft rotated", async () => {
    const expiresAt = Date.now() + 3_600_000;
    refresh.mockResolvedValue({ accessToken: "access-2", expiresAt, refreshToken: "refresh-2" });
    const { outlook, calls, save } = provider(empty, credentials({ expiresAt: Date.now() + 30_000 }));
    await outlook.listCalendars();
    expect(refresh).toHaveBeenCalledExactlyOnceWith("refresh-1", [GRAPH_CALENDAR_SCOPE, "offline_access"]);
    expect(save).toHaveBeenCalledExactlyOnceWith({ kind: "oauth", issuer: "microsoft", refreshToken: "refresh-2", accessToken: "access-2", expiresAt });
    expect(calls[0].headers.get("authorization")).toBe("Bearer access-2");

    // The next refresh uses the rotated token.
    refresh.mockResolvedValue({ accessToken: "access-3", expiresAt: Date.now() - 1, refreshToken: "refresh-3" });
    const again = provider(empty, credentials({ expiresAt: 0 }));
    await again.outlook.listCalendars();
    await again.outlook.listCalendars();
    expect(refresh.mock.calls.map((c) => c[0])).toEqual(["refresh-1", "refresh-1", "refresh-3"]);
  });

  it("gets a new token on a 401, and gives up with CalendarAuthError on a second one", async () => {
    const once = provider((call) => (call.headers.get("authorization") === "Bearer access-1" ? json({ error: { code: "InvalidAuthenticationToken" } }, 401) : empty()));
    await expect(once.outlook.listCalendars()).resolves.toEqual([]);
    expect(refresh).toHaveBeenCalledTimes(1);

    const twice = provider(() => json({ error: { code: "InvalidAuthenticationToken" } }, 401));
    await expect(twice.outlook.listCalendars()).rejects.toBeInstanceOf(CalendarAuthError);
    expect(twice.calls).toHaveLength(2);
  });

  it("turns a revoked grant into CalendarAuthError", async () => {
    refresh.mockRejectedValue(new MailAuthError("Microsoft access was revoked; reconnect the account", "oauth_revoked"));
    const { outlook } = provider(empty, credentials({ expiresAt: 0 }));
    await expect(outlook.listCalendars()).rejects.toBeInstanceOf(CalendarAuthError);
  });

  it("tries a throttled request once more", async () => {
    let n = 0;
    const { outlook, sleep } = provider(() => (n++ === 0 ? json({ error: { code: "TooManyRequests" } }, 429, { "retry-after": "3" }) : empty()));
    await expect(outlook.listCalendars()).resolves.toEqual([]);
    expect(sleep).toHaveBeenCalledExactlyOnceWith(3000);
  });
});

describe("listCalendars", () => {
  it("maps the list, following Graph's next links", async () => {
    const { outlook, calls } = provider((call) =>
      call.url.searchParams.has("$skip")
        ? json({ value: [{ id: "cal-2", name: "Holidays", hexColor: "", canEdit: false, isDefaultCalendar: false }] })
        : json({ value: [{ id: "cal-1", name: "Calendar", hexColor: "#0078D4", canEdit: true, isDefaultCalendar: true }], "@odata.nextLink": `${GRAPH}/me/calendars?$top=100&$skip=100` }),
    );
    expect(await outlook.listCalendars()).toEqual([
      { providerId: "cal-1", name: "Calendar", color: "#0078D4", readOnly: false, primary: true, shown: true },
      { providerId: "cal-2", name: "Holidays", color: null, readOnly: true, primary: false, shown: true },
    ]);
    expect(calls.map((c) => c.url.href)).toEqual([`${GRAPH}/me/calendars?$top=100`, `${GRAPH}/me/calendars?$top=100&$skip=100`]);
  });

  it("never follows a next link that leaves Graph", async () => {
    const { outlook, calls } = provider(() => json({ value: [], "@odata.nextLink": "https://elsewhere.example/me/calendars" }));
    await outlook.listCalendars();
    expect(calls).toHaveLength(1);
  });
});

describe("listEvents", () => {
  const nora = { emailAddress: { name: "Nora Lind", address: "nora@example.com" } };
  const ivo = { emailAddress: { name: "Ivo Marek", address: "ivo@example.com" } };
  const events = [
    {
      id: "timed",
      "@odata.etag": 'W/"e-timed"',
      iCalUId: "040000008200E00074C5B7101A82E008",
      webLink: "https://outlook.example/calendar/item/timed",
      subject: "Roadmap review",
      body: { contentType: "text", content: "Bring the numbers.\r\n\r\n" },
      location: { displayName: "Room Birch" },
      start: utc("2026-11-12T09:00:00"),
      end: utc("2026-11-12T10:00:00"),
      isAllDay: false,
      isOrganizer: true,
      originalStartTimeZone: "Central Europe Standard Time",
      organizer: nora,
      responseStatus: { response: "organizer" },
      attendees: [],
    },
    { id: "allday", subject: "Offsite", start: utc("2026-11-13T00:00:00"), end: utc("2026-11-15T00:00:00"), isAllDay: true, isOrganizer: true, originalStartTimeZone: "Europe/Prague" },
    {
      id: "standup-occurrence",
      seriesMasterId: "standup/master+1",
      subject: "Standup",
      start: utc("2026-11-16T08:00:00"),
      end: utc("2026-11-16T08:15:00"),
      isOrganizer: true,
      originalStartTimeZone: "Somewhere Standard Time",
      onlineMeeting: { joinUrl: "https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc/0" },
    },
    { id: "cancelled", seriesMasterId: "standup/master+1", subject: "Canceled: Standup", isCancelled: true, start: utc("2026-11-17T08:00:00"), end: utc("2026-11-17T08:15:00") },
    {
      id: "invited",
      seriesMasterId: "monthly",
      subject: "Supplier call",
      body: { contentType: "text", content: "Dial in: https://example.zoom.us/j/123456789 <ivo@example.com>" },
      location: { displayName: "" },
      start: utc("2026-11-18T14:00:00"),
      end: utc("2026-11-18T15:00:00"),
      isOrganizer: false,
      organizer: ivo,
      responseStatus: { response: "tentativelyAccepted" },
      attendees: [
        { type: "required", ...nora, status: { response: "tentativelyAccepted" } },
        { type: "optional", emailAddress: { address: "lea@example.com" }, status: { response: "declined" } },
        { type: "required", emailAddress: { name: "Otto Novak", address: "otto@example.com" }, status: { response: "accepted" } },
        { type: "required", emailAddress: { name: "Pia", address: "pia@example.com" }, status: { response: "notResponded" } },
        { type: "required", emailAddress: { name: "Rob", address: "rob@example.com" }, status: { response: "none" } },
        { type: "resource", emailAddress: { name: "Room Birch", address: "room-birch@example.com" }, status: { response: "accepted" } },
      ],
    },
  ];

  it("maps what Graph lists and asks for the series' rules in one batch", async () => {
    const { outlook, calls } = provider((call) => {
      if (call.path === "/$batch") {
        const requests = (call.body as { requests: { id: string; url: string }[] }).requests;
        return json({
          responses: requests.map((r) =>
            r.url.includes("monthly")
              ? { id: r.id, status: 404, body: { error: { code: "ErrorItemNotFound" } } }
              : { id: r.id, status: 200, body: { id: "standup/master+1", recurrence: { pattern: { type: "weekly", interval: 1, daysOfWeek: ["monday", "tuesday"], firstDayOfWeek: "sunday" }, range: { type: "noEnd", startDate: "2026-01-05", endDate: "0001-01-01" } } } },
          ),
        });
      }
      if (call.path !== "/me/calendars/cal/1/calendarView") return undefined;
      return call.url.searchParams.has("$skip") ? json({ value: events.slice(2) }) : json({ value: events.slice(0, 2), "@odata.nextLink": `${call.url.href}&$skip=250` });
    });
    const listed = await outlook.listEvents("cal/1", new Date("2026-11-09T00:00:00Z"), new Date("2026-11-23T00:00:00Z"));

    expect(calls[0].url.href).toBe(`${GRAPH}/me/calendars/cal%2F1/calendarView?startDateTime=2026-11-09T00%3A00%3A00.000Z&endDateTime=2026-11-23T00%3A00%3A00.000Z&$top=250`);
    expect(calls[0].headers.get("prefer")).toBe('outlook.timezone="UTC", outlook.body-content-type="text"');
    expect(calls[1].headers.get("prefer")).toBe(calls[0].headers.get("prefer"));
    expect(calls).toHaveLength(3);
    expect(calls[2].method).toBe("POST");
    expect(calls[2].body).toEqual({
      requests: [
        { id: "0", method: "GET", url: "/me/events/standup%2Fmaster%2B1?$select=id,recurrence" },
        { id: "1", method: "GET", url: "/me/events/monthly?$select=id,recurrence" },
      ],
    });

    expect(listed.map((e) => e.providerId)).toEqual(["timed", "allday", "standup-occurrence", "invited"]);
    const [timed, allDay, standup, invited] = listed;
    expect(timed).toEqual({
      providerId: "timed",
      seriesId: null,
      uid: "040000008200E00074C5B7101A82E008",
      etag: 'W/"e-timed"',
      title: "Roadmap review",
      location: "Room Birch",
      description: "Bring the numbers.",
      start: new Date("2026-11-12T09:00:00Z"),
      end: new Date("2026-11-12T10:00:00Z"),
      allDay: false,
      timeZone: "Europe/Prague",
      recurrence: null,
      organizer: { name: "Nora Lind", email: "nora@example.com" },
      attendees: [],
      myStatus: null,
      joinUrl: null,
      url: "https://outlook.example/calendar/item/timed",
      canEdit: true,
    });
    expect(allDay).toMatchObject({ start: new Date("2026-11-13T00:00:00Z"), end: new Date("2026-11-15T00:00:00Z"), allDay: true, timeZone: "Europe/Prague", organizer: null, etag: null });
    expect(standup).toMatchObject({ seriesId: "standup/master+1", recurrence: "FREQ=WEEKLY;BYDAY=MO,TU", timeZone: null, joinUrl: "https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc/0" });
    expect(invited).toMatchObject({
      seriesId: "monthly",
      recurrence: null,
      description: "Dial in: https://example.zoom.us/j/123456789 <ivo@example.com>",
      organizer: { name: "Ivo Marek", email: "ivo@example.com" },
      myStatus: "tentative",
      canEdit: false,
      joinUrl: "https://example.zoom.us/j/123456789",
    });
    expect(invited.attendees).toEqual([
      { name: "Nora Lind", email: "nora@example.com", status: "tentative" },
      { name: "", email: "lea@example.com", status: "declined" },
      { name: "Otto Novak", email: "otto@example.com", status: "accepted" },
      { name: "Pia", email: "pia@example.com", status: "needsAction" },
      { name: "Rob", email: "rob@example.com", status: "needsAction" },
    ]);
  });

  it("asks for at most twenty series per batch", async () => {
    const many = Array.from({ length: 45 }, (_, i) => ({ id: `occurrence-${i}`, seriesMasterId: `series-${i}`, start: utc("2026-11-16T08:00:00"), end: utc("2026-11-16T09:00:00") }));
    const { outlook, calls } = provider((call) => {
      if (call.path !== "/$batch") return json({ value: many });
      const requests = (call.body as { requests: { id: string }[] }).requests;
      return json({ responses: requests.map((r) => ({ id: r.id, status: 200, body: { recurrence: { pattern: { type: "daily", interval: 1 }, range: { type: "noEnd" } } } })) });
    });
    const listed = await outlook.listEvents("cal", new Date("2026-11-09T00:00:00Z"), new Date("2026-11-23T00:00:00Z"));
    const batches = calls.filter((c) => c.path === "/$batch").map((c) => (c.body as { requests: unknown[] }).requests.length);
    expect(batches).toEqual([20, 20, 5]);
    expect(listed.every((e) => e.recurrence === "FREQ=DAILY")).toBe(true);
  });

  it("still lists the events when the batch fails, without their rules", async () => {
    const { outlook, calls } = provider((call) => (call.path === "/$batch" ? json({ error: { code: "ServiceUnavailable", message: "Busy" } }, 503) : json({ value: events })));
    const listed = await outlook.listEvents("cal", new Date("2026-11-09T00:00:00Z"), new Date("2026-11-23T00:00:00Z"));
    expect(listed).toHaveLength(4);
    expect(listed.map((e) => e.recurrence)).toEqual([null, null, null, null]);
    expect(listed[2].seriesId).toBe("standup/master+1");
    expect(calls.filter((c) => c.path === "/$batch")).toHaveLength(2);
  });

  it("reads an all-day event given as midnight somewhere else as the same day", async () => {
    // Midnight in Prague is 23:00 the evening before in UTC.
    const shifted = { id: "shifted", isAllDay: true, start: utc("2026-11-12T23:00:00"), end: utc("2026-11-13T23:00:00") };
    const { outlook } = provider(() => json({ value: [shifted] }));
    const [event] = await outlook.listEvents("cal", new Date("2026-11-09T00:00:00Z"), new Date("2026-11-23T00:00:00Z"));
    expect(event).toMatchObject({ start: new Date("2026-11-13T00:00:00Z"), end: new Date("2026-11-14T00:00:00Z"), allDay: true });
  });
});

describe("repeating: Graph's pattern and iCalendar's rule", () => {
  const range = { type: "noEnd", startDate: "2026-11-12", recurrenceTimeZone: "Europe/Prague" };
  /** Thursday 12 November 2026. */
  const convert = (rule: string) => rruleToRecurrence(rule, "2026-11-12", "Europe/Prague");

  it.each([
    ["FREQ=DAILY", { type: "daily", interval: 1 }],
    ["FREQ=DAILY;INTERVAL=3", { type: "daily", interval: 3 }],
    ["FREQ=WEEKLY;BYDAY=MO,WE,FR", { type: "weekly", interval: 1, daysOfWeek: ["monday", "wednesday", "friday"], firstDayOfWeek: "monday" }],
    ["FREQ=WEEKLY;INTERVAL=2;BYDAY=TU", { type: "weekly", interval: 2, daysOfWeek: ["tuesday"], firstDayOfWeek: "monday" }],
    ["FREQ=MONTHLY;BYMONTHDAY=15", { type: "absoluteMonthly", interval: 1, dayOfMonth: 15 }],
    ["FREQ=MONTHLY;BYDAY=2TU", { type: "relativeMonthly", interval: 1, daysOfWeek: ["tuesday"], index: "second" }],
    ["FREQ=MONTHLY;INTERVAL=3;BYDAY=-1FR", { type: "relativeMonthly", interval: 3, daysOfWeek: ["friday"], index: "last" }],
    ["FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1", { type: "relativeMonthly", interval: 1, daysOfWeek: ["monday", "tuesday", "wednesday", "thursday", "friday"], index: "last" }],
    ["FREQ=YEARLY;BYMONTH=3;BYMONTHDAY=15", { type: "absoluteYearly", interval: 1, dayOfMonth: 15, month: 3 }],
    ["FREQ=YEARLY;BYMONTH=11;BYDAY=4TH", { type: "relativeYearly", interval: 1, daysOfWeek: ["thursday"], index: "fourth", month: 11 }],
  ])("%s goes there and back", (rule, pattern) => {
    expect(convert(rule)).toEqual({ pattern, range });
    expect(recurrenceToRrule({ pattern, range })).toBe(rule);
  });

  it("fills in from the first day what the rule leaves out", () => {
    expect(convert("FREQ=WEEKLY").pattern).toMatchObject({ type: "weekly", daysOfWeek: ["thursday"] });
    expect(convert("FREQ=MONTHLY").pattern).toEqual({ type: "absoluteMonthly", interval: 1, dayOfMonth: 12 });
    expect(convert("FREQ=YEARLY").pattern).toEqual({ type: "absoluteYearly", interval: 1, dayOfMonth: 12, month: 11 });
    expect(convert("RRULE:FREQ=WEEKLY;WKST=SU;BYDAY=TU").pattern).toMatchObject({ daysOfWeek: ["tuesday"], firstDayOfWeek: "sunday" });
  });

  it("converts how long the series lasts", () => {
    expect(convert("FREQ=DAILY;COUNT=10").range).toEqual({ ...range, type: "numbered", numberOfOccurrences: 10 });
    expect(convert("FREQ=DAILY;UNTIL=20261231").range).toEqual({ ...range, type: "endDate", endDate: "2026-12-31" });
    // The last day counts on the clocks of the event's zone: 23:30 UTC on the 30th is already the 31st in Prague.
    expect(convert("FREQ=DAILY;UNTIL=20261230T233000Z").range).toEqual({ ...range, type: "endDate", endDate: "2026-12-31" });
    expect(recurrenceToRrule({ pattern: { type: "daily", interval: 2 }, range: { type: "endDate", startDate: "2026-11-12", endDate: "2026-12-31" } })).toBe("FREQ=DAILY;INTERVAL=2;UNTIL=20261231");
    expect(recurrenceToRrule({ pattern: { type: "weekly", interval: 1, daysOfWeek: ["tuesday"] }, range: { type: "numbered", startDate: "2026-11-12", numberOfOccurrences: 8 } })).toBe("FREQ=WEEKLY;BYDAY=TU;COUNT=8");
    expect(recurrenceToRrule({ pattern: { type: "daily", interval: 1 }, range: { type: "noEnd", startDate: "2026-11-12", endDate: "0001-01-01" } })).toBe("FREQ=DAILY");
  });

  it("has no rule for what it doesn't know", () => {
    expect(recurrenceToRrule(null)).toBeNull();
    expect(recurrenceToRrule({ pattern: { type: "lunar" } })).toBeNull();
    expect(recurrenceToRrule({ pattern: { type: "absoluteMonthly" } })).toBeNull();
  });

  it.each([
    "FREQ=HOURLY",
    "INTERVAL=2",
    "FREQ=DAILY;BYHOUR=9",
    "FREQ=DAILY;BYDAY=MO,TU",
    "FREQ=WEEKLY;BYDAY=2TU",
    "FREQ=MONTHLY;BYMONTHDAY=1,15",
    "FREQ=MONTHLY;BYMONTHDAY=-1",
    "FREQ=MONTHLY;BYDAY=TU",
    "FREQ=MONTHLY;BYDAY=5TU",
    "FREQ=MONTHLY;BYDAY=MO,TU",
    "FREQ=MONTHLY;BYDAY=1MO;BYMONTHDAY=3",
    "FREQ=MONTHLY;BYSETPOS=1",
    "FREQ=YEARLY;BYMONTH=1,7",
    "FREQ=YEARLY;BYYEARDAY=100",
    "FREQ=DAILY;COUNT=5;UNTIL=20261231",
    "FREQ=DAILY;UNTIL=tomorrow",
    "FREQ=DAILY;INTERVAL=0",
  ])("refuses %s", (rule) => {
    expect(() => convert(rule)).toThrow("unsupported recurrence");
  });
});

describe("createEvent", () => {
  const created = () => json({ id: "new" }, 201);

  it("posts a timed event as the clocks in its zone show it", async () => {
    const { outlook, calls } = provider(created);
    await outlook.createEvent("cal/1", draft({ attendees: [{ name: "Ivo Marek", email: "ivo@example.com" }] }));
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("POST");
    expect(calls[0].url.href).toBe(`${GRAPH}/me/calendars/cal%2F1/events`);
    expect(calls[0].body).toEqual({
      subject: "Roadmap review",
      body: { contentType: "text", content: "Bring the numbers." },
      location: { displayName: "Room Birch" },
      start: { dateTime: "2026-11-12T10:00:00", timeZone: "Europe/Prague" },
      end: { dateTime: "2026-11-12T11:00:00", timeZone: "Europe/Prague" },
      isAllDay: false,
      attendees: [{ emailAddress: { address: "ivo@example.com", name: "Ivo Marek" }, type: "required" }],
    });
  });

  it("posts an all-day event from midnight to midnight", async () => {
    const { outlook, calls } = provider(created);
    await outlook.createEvent("cal", draft({ allDay: true, start: new Date("2026-11-13T00:00:00Z"), end: new Date("2026-11-15T00:00:00Z") }));
    expect(calls[0].body).toMatchObject({
      start: { dateTime: "2026-11-13T00:00:00", timeZone: "UTC" },
      end: { dateTime: "2026-11-15T00:00:00", timeZone: "UTC" },
      isAllDay: true,
      attendees: [],
    });
  });

  it("posts a repeating event starting on its day in its own zone", async () => {
    const { outlook, calls } = provider(created);
    // 23:30 UTC on the 12th is half past midnight on the 13th in Prague.
    await outlook.createEvent("cal", draft({ start: new Date("2026-11-12T23:30:00Z"), end: new Date("2026-11-13T00:30:00Z"), recurrence: "FREQ=WEEKLY;COUNT=6" }));
    expect(calls[0].body).toMatchObject({
      start: { dateTime: "2026-11-13T00:30:00", timeZone: "Europe/Prague" },
      recurrence: {
        pattern: { type: "weekly", interval: 1, daysOfWeek: ["friday"], firstDayOfWeek: "monday" },
        range: { type: "numbered", startDate: "2026-11-13", numberOfOccurrences: 6, recurrenceTimeZone: "Europe/Prague" },
      },
    });
  });

  it("sends nothing when the rule is one Graph can't say", async () => {
    const { outlook, calls } = provider(created);
    await expect(outlook.createEvent("cal", draft({ recurrence: "FREQ=HOURLY" }))).rejects.toThrow("unsupported recurrence");
    expect(calls).toHaveLength(0);
  });
});

describe("updateEvent", () => {
  const stored = {
    id: "ev-1",
    subject: "Old title",
    body: { contentType: "text", content: "Bring the numbers.\r\n" },
    location: { displayName: "Room Birch", address: { city: "Brno" } },
    start: utc("2026-11-12T09:00:00"),
    end: utc("2026-11-12T10:00:00"),
    isAllDay: false,
    originalStartTimeZone: "Central Europe Standard Time",
    organizer: { emailAddress: { address: "nora@example.com" } },
    attendees: [
      { type: "required", emailAddress: { name: "Nora Lind", address: "Nora@example.com" }, status: { response: "organizer" } },
      { type: "optional", emailAddress: { name: "Ivo Marek", address: "ivo@example.com" }, status: { response: "accepted" } },
      { type: "resource", emailAddress: { name: "Room Birch", address: "room-birch@example.com" }, status: { response: "accepted" } },
    ],
  };
  /** A weekly series first held on Tuesday 6 January 2026 at 10:00 in Prague, half an hour long. */
  const master = {
    id: "weekly",
    subject: "Sync",
    body: { contentType: "text", content: "Bring the numbers." },
    location: { displayName: "Room Birch" },
    start: utc("2026-01-06T09:00:00"),
    end: utc("2026-01-06T09:30:00"),
    isAllDay: false,
    originalStartTimeZone: "Central Europe Standard Time",
    recurrence: {
      pattern: { type: "weekly", interval: 1, daysOfWeek: ["tuesday"], firstDayOfWeek: "sunday" },
      range: { type: "noEnd", startDate: "2026-01-06", endDate: "0001-01-01", recurrenceTimeZone: "Central Europe Standard Time" },
    },
  };
  /** Its occurrence on 24 March, the last one before the clocks change. */
  const occurrence = { id: "weekly-0324", start: utc("2026-03-24T09:00:00"), end: utc("2026-03-24T09:30:00"), isAllDay: false };
  const occurrenceRef = ref({ providerId: "weekly-0324", seriesId: "weekly", start: new Date("2026-03-24T09:00:00Z") });
  const series = (call: Call) => {
    if (call.method === "PATCH") return json({});
    if (call.path === "/me/events/weekly") return json(master);
    if (call.path === "/me/events/weekly-0324") return json(occurrence);
    return undefined;
  };
  const single = (call: Call) => (call.method === "GET" ? json(stored) : json({}));
  const patchOf = (calls: Call[]) => calls.find((c) => c.method === "PATCH")!;

  it("sends only what changed on a single event", async () => {
    const guests = [{ name: "Ivo Marek", email: "ivo@example.com" }];
    const { outlook, calls } = provider(single);
    await outlook.updateEvent("cal", ref(), draft({ title: "New title", attendees: guests }), "this");
    expect(calls.map((c) => `${c.method} ${c.url.href}`)).toEqual([`GET ${GRAPH}/me/events/ev-1`, `PATCH ${GRAPH}/me/events/ev-1`]);
    expect(calls[0].headers.get("prefer")).toContain('outlook.timezone="UTC"');
    expect(patchOf(calls).body).toEqual({ subject: "New title" });
  });

  it("sends new times, place, text, rule and guests", async () => {
    const { outlook, calls } = provider(single);
    const changed = draft({
      location: "Room Oak",
      description: "Bring the charts.",
      start: new Date("2026-11-12T13:00:00Z"),
      end: new Date("2026-11-12T14:00:00Z"),
      recurrence: "FREQ=DAILY;COUNT=3",
      attendees: [{ name: "Ivo", email: "IVO@example.com" }, { name: "Otto Novak", email: "otto@example.com" }],
    });
    await outlook.updateEvent("cal", ref(), changed, "all");
    expect(patchOf(calls).body).toEqual({
      subject: "Roadmap review",
      location: { displayName: "Room Oak" },
      body: { contentType: "text", content: "Bring the charts." },
      start: { dateTime: "2026-11-12T14:00:00", timeZone: "Europe/Prague" },
      end: { dateTime: "2026-11-12T15:00:00", timeZone: "Europe/Prague" },
      isAllDay: false,
      recurrence: { pattern: { type: "daily", interval: 1 }, range: { type: "numbered", startDate: "2026-11-12", numberOfOccurrences: 3, recurrenceTimeZone: "Europe/Prague" } },
      // The owner and the room stay, Ivo keeps the entry Graph has for him, Otto is new.
      attendees: [stored.attendees[0], stored.attendees[2], stored.attendees[1], { emailAddress: { address: "otto@example.com", name: "Otto Novak" }, type: "required" }],
    });
  });

  it("changes one occurrence by its own id, without the series' rule", async () => {
    const { outlook, calls } = provider(series);
    const moved = draft({ start: new Date("2026-03-24T13:00:00Z"), end: new Date("2026-03-24T13:30:00Z"), recurrence: "FREQ=WEEKLY;BYDAY=TU" });
    await outlook.updateEvent("cal", occurrenceRef, moved, "this");
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(["GET /me/events/weekly-0324", "PATCH /me/events/weekly-0324"]);
    expect(patchOf(calls).body).toMatchObject({ start: { dateTime: "2026-03-24T14:00:00", timeZone: "Europe/Prague" }, end: { dateTime: "2026-03-24T14:30:00", timeZone: "Europe/Prague" } });
    expect(patchOf(calls).body).not.toHaveProperty("recurrence");
  });

  it("moves the whole series by as much as the occurrence moved, and the day its range starts on", async () => {
    const { outlook, calls } = provider(series);
    // 24 March 10:00 → 31 March 11:00 Prague time (summer time by then), an hour long.
    const moved = draft({ title: "Sync", start: new Date("2026-03-31T09:00:00Z"), end: new Date("2026-03-31T10:00:00Z"), recurrence: "FREQ=WEEKLY;BYDAY=TU" });
    await outlook.updateEvent("cal", occurrenceRef, moved, "all");
    expect(calls.filter((c) => c.method === "GET").map((c) => c.path + c.url.search).sort()).toEqual(["/me/events/weekly", "/me/events/weekly-0324?$select=start,end,isAllDay"]);
    const patch = patchOf(calls);
    expect(patch.url.href).toBe(`${GRAPH}/me/events/weekly`);
    expect(patch.body).toEqual({
      subject: "Sync",
      start: { dateTime: "2026-01-13T11:00:00", timeZone: "Europe/Prague" },
      end: { dateTime: "2026-01-13T12:00:00", timeZone: "Europe/Prague" },
      isAllDay: false,
      recurrence: { pattern: master.recurrence.pattern, range: { ...master.recurrence.range, startDate: "2026-01-13" } },
    });
  });

  it("keeps the series' own day when only the hour changed", async () => {
    const { outlook, calls } = provider(series);
    await outlook.updateEvent("cal", occurrenceRef, draft({ title: "Sync", start: new Date("2026-03-24T14:00:00Z"), end: new Date("2026-03-24T14:30:00Z") }), "all");
    expect(patchOf(calls).body).toEqual({
      subject: "Sync",
      start: { dateTime: "2026-01-06T15:00:00", timeZone: "Europe/Prague" },
      end: { dateTime: "2026-01-06T15:30:00", timeZone: "Europe/Prague" },
      isAllDay: false,
    });
  });

  it("leaves the series' times alone when the occurrence stayed, and sends a changed rule", async () => {
    const same = { title: "Sync", start: new Date("2026-03-24T09:00:00Z"), end: new Date("2026-03-24T09:30:00Z") };
    const untouched = provider(series);
    await untouched.outlook.updateEvent("cal", occurrenceRef, draft({ ...same, recurrence: "BYDAY=TU;FREQ=WEEKLY" }), "all");
    expect(patchOf(untouched.calls).body).toEqual({ subject: "Sync" });

    const unknown = provider(series);
    await unknown.outlook.updateEvent("cal", occurrenceRef, draft({ ...same, recurrence: null }), "all");
    expect(patchOf(unknown.calls).body).toEqual({ subject: "Sync" });

    const changed = provider(series);
    await changed.outlook.updateEvent("cal", occurrenceRef, draft({ ...same, recurrence: "FREQ=WEEKLY;INTERVAL=2;BYDAY=TU;UNTIL=20260630" }), "all");
    expect(patchOf(changed.calls).body).toEqual({
      subject: "Sync",
      recurrence: {
        pattern: { type: "weekly", interval: 2, daysOfWeek: ["tuesday"], firstDayOfWeek: "monday" },
        range: { type: "endDate", startDate: "2026-01-06", endDate: "2026-06-30", recurrenceTimeZone: "Europe/Prague" },
      },
    });
  });
});

describe("deleteEvent", () => {
  it("deletes one occurrence or the whole series", async () => {
    const { outlook, calls } = provider(() => new Response(null, { status: 204 }));
    const occurrence = ref({ providerId: "occ/1", seriesId: "weekly" });
    await outlook.deleteEvent("cal", occurrence, "this");
    await outlook.deleteEvent("cal", occurrence, "all");
    await outlook.deleteEvent("cal", ref(), "all");
    expect(calls.map((c) => `${c.method} ${c.url.href}`)).toEqual([`DELETE ${GRAPH}/me/events/occ%2F1`, `DELETE ${GRAPH}/me/events/weekly`, `DELETE ${GRAPH}/me/events/ev-1`]);
  });

  it("is content when the event is already gone", async () => {
    const gone = provider(() => undefined);
    await expect(gone.outlook.deleteEvent("cal", ref(), "this")).resolves.toBeUndefined();
    const refused = provider(() => json({ error: { code: "ErrorAccessDenied", message: "Access is denied." } }, 403));
    await expect(refused.outlook.deleteEvent("cal", ref(), "this")).rejects.toThrow("Microsoft Graph: HTTP 403 Access is denied.");
  });
});

describe("respond", () => {
  it("answers through Graph, which tells the organizer", async () => {
    const { outlook, calls } = provider(() => new Response(null, { status: 202 }));
    const occurrence = ref({ providerId: "occ-1", seriesId: "weekly" });
    await outlook.respond!("cal", occurrence, "accepted", "this");
    await outlook.respond!("cal", occurrence, "tentative", "all");
    await outlook.respond!("cal", ref(), "declined", "all");
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(["POST /me/events/occ-1/accept", "POST /me/events/weekly/tentativelyAccept", "POST /me/events/ev-1/decline"]);
    expect(calls.map((c) => c.body)).toEqual([{ sendResponse: true }, { sendResponse: true }, { sendResponse: true }]);
  });
});

it("emails the guests itself", () => {
  expect(provider(() => undefined).outlook.sendsInvitations).toBe(true);
});
