import type { CalendarCredentials } from "../db/schema";
import { decodeEntities } from "../mail/gmail/parse";
import { zoneOffset } from "../mail/ics";
import { MailAuthError } from "../mail/types";
import { CalendarAuthError, CalendarConflictError } from "./types";

/**
 * What the two calendar providers that sign in with OAuth (Google, Microsoft) share: keeping the access
 * token fresh, sending requests, and the arithmetic of changing a whole repeating event.
 */

export type OAuthCredentials = Extract<CalendarCredentials, { kind: "oauth" }>;

export interface ProviderOptions {
  credentials: OAuthCredentials;
  /** Called when tokens change (a refreshed access token, a rotated refresh token), with the full new credentials. */
  save: (credentials: OAuthCredentials) => Promise<void>;
}

export interface ProviderDeps {
  fetch?: typeof fetch;
  /** Waits before the one retry of a busy server; tests pass their own. */
  sleep?: (ms: number) => Promise<void>;
}

/** What connecting a calendar account gives. */
export interface CalendarGrant {
  refreshToken: string;
  accessToken: string;
  expiresAt: number;
  scope: string;
  email: string;
}

interface FreshToken {
  accessToken: string;
  expiresAt: number;
  refreshToken?: string;
  scope?: string;
}

interface ApiConfig {
  /** For error messages: "Google Calendar". */
  name: string;
  refresh: (refreshToken: string) => Promise<FreshToken>;
  /** A refusal other than 401 that means the sign-in doesn't cover calendars. */
  authRefusal?: (status: number, body: unknown) => boolean;
}

interface RequestOptions {
  body?: unknown;
  headers?: Record<string, string>;
  /** Error statuses that are fine here (404 when deleting what's already gone). */
  allow?: number[];
}

export interface Api {
  /** A request whose JSON answer is needed. */
  json<T>(method: string, url: string, options?: RequestOptions): Promise<T>;
  /** A request sent for what it does. */
  send(method: string, url: string, options?: RequestOptions): Promise<void>;
}

const TIMEOUT_MS = 20_000;
/** An access token this close to its end is replaced first: a request may take a while. */
const FRESH_MS = 60_000;
const RETRY_MS = 1000;
const MAX_RETRY_MS = 5000;

/** How long a busy server asked us to wait (Retry-After in seconds), at most five seconds. */
function retryDelay(res: Response) {
  const seconds = Number(res.headers.get("retry-after") ?? "");
  return res.headers.has("retry-after") && Number.isFinite(seconds) ? Math.min(Math.max(seconds, 0) * 1000, MAX_RETRY_MS) : RETRY_MS;
}

/** Google and Graph both answer errors as { error: { message } }. */
function errorMessage(body: unknown) {
  const message = (body as { error?: { message?: unknown } } | null)?.error?.message;
  return typeof message === "string" ? message.slice(0, 200) : "";
}

export function createApi(opts: ProviderOptions, config: ApiConfig, deps: ProviderDeps = {}): Api {
  const fetchFn = deps.fetch ?? fetch;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let credentials = opts.credentials;
  let refreshing: Promise<string> | null = null;

  async function refresh() {
    let token: FreshToken;
    try {
      token = await config.refresh(credentials.refreshToken);
    } catch (err) {
      if (err instanceof MailAuthError) throw new CalendarAuthError(err.message);
      throw err;
    }
    credentials = {
      ...credentials,
      accessToken: token.accessToken,
      expiresAt: token.expiresAt,
      ...(token.refreshToken && { refreshToken: token.refreshToken }),
      ...(token.scope && { scope: token.scope }),
    };
    await opts.save(credentials);
    return token.accessToken;
  }

  /** The cached token while it lasts. `refused` is a token the provider just said no to: anything but that one. */
  function accessToken(refused?: string): Promise<string> {
    const cached = credentials.accessToken;
    if (cached && cached !== refused && (credentials.expiresAt ?? 0) - Date.now() > FRESH_MS) return Promise.resolve(cached);
    // Requests running side by side share one refresh: Microsoft's refresh token changes with each.
    refreshing ??= refresh().finally(() => {
      refreshing = null;
    });
    return refreshing;
  }

  async function call(method: string, url: string, options: RequestOptions): Promise<Response | null> {
    let token = await accessToken();
    let refreshed = false;
    let retried = false;
    for (;;) {
      const res = await fetchFn(url, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          ...(options.body !== undefined && { "content-type": "application/json" }),
          ...options.headers,
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (res.ok) return res;
      if (options.allow?.includes(res.status)) return null;
      if (res.status === 401 && !refreshed) {
        refreshed = true;
        token = await accessToken(token);
        continue;
      }
      if ((res.status === 429 || res.status >= 500) && !retried) {
        retried = true;
        await sleep(retryDelay(res));
        continue;
      }
      const body: unknown = await res.json().catch(() => null);
      if (res.status === 401 || config.authRefusal?.(res.status, body)) throw new CalendarAuthError(`${config.name} refused the sign-in`);
      if (res.status === 412) throw new CalendarConflictError(`${config.name}: the event changed in the meantime`);
      throw new Error(`${config.name}: HTTP ${res.status} ${errorMessage(body)}`.trim());
    }
  }

  return {
    async json<T>(method: string, url: string, options: RequestOptions = {}) {
      const res = await call(method, url, options);
      const data: unknown = res && res.status !== 204 ? await res.json().catch(() => null) : null;
      if (data === null || typeof data !== "object") throw new Error(`${config.name}: no answer to ${method}`);
      return data as T;
    },
    async send(method: string, url: string, options: RequestOptions = {}) {
      await call(method, url, options);
    },
  };
}

/* ---------------------------------- Time ---------------------------------- */

export const DAY_MS = 86_400_000;

/** What the clocks in `zone` show at an instant, written as if it were UTC ("wall time", in ms). */
export function toWall(utc: number, zone: string) {
  return utc + zoneOffset(utc, zone) * 60_000;
}

/** The instant the clocks in `zone` show a wall time (two passes settle the hours around a clock change). */
export function fromWall(wall: number, zone: string) {
  const utc = wall - zoneOffset(wall, zone) * 60_000;
  return wall - zoneOffset(utc, zone) * 60_000;
}

/** "2026-11-12" of a wall time or of an all-day event's midnight-UTC date. */
export const isoDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** When an event happens, as ProviderEvent and EventDraft say it. */
export interface Span {
  start: Date;
  end: Date;
  allDay: boolean;
}

export const sameSpan = (a: Span, b: Span) => a.allDay === b.allDay && a.start.getTime() === b.start.getTime() && a.end.getTime() === b.end.getTime();

const dayOf = (wall: number) => Math.floor(wall / DAY_MS) * DAY_MS;

/**
 * Where the first event of a series goes when the user moved one of its occurrences from `was` to
 * `draft` and meant all of them. The series moves by as much as the occurrence did on the clocks of
 * its own zone (so an hour later stays an hour later across a clock change) and takes the
 * occurrence's new length. Null when the occurrence's time didn't change: then the series' times are
 * left alone.
 */
export function shiftSeries(master: Span & { timeZone: string | null }, was: Span, draft: Span & { timeZone: string }): (Span & { timeZone: string }) | null {
  if (sameSpan(was, draft)) return null;
  const zone = (!master.allDay && master.timeZone) || draft.timeZone;
  const wall = (date: Date, allDay: boolean) => (allDay ? date.getTime() : toWall(date.getTime(), zone));
  const from = wall(was.start, was.allDay);
  const to = wall(draft.start, draft.allDay);
  const first = wall(master.start, master.allDay);
  const days = dayOf(to) - dayOf(from);
  if (draft.allDay) {
    const start = dayOf(first) + days;
    const length = Math.max(1, Math.round((draft.end.getTime() - draft.start.getTime()) / DAY_MS)) * DAY_MS;
    return { start: new Date(start), end: new Date(start + length), allDay: true, timeZone: zone };
  }
  // A series that was all-day takes the hour the user picked; a timed one moves by as much as the occurrence.
  const moved = master.allDay || was.allDay ? dayOf(first) + days + (to - dayOf(to)) : first + (to - from);
  const start = fromWall(moved, zone);
  return { start: new Date(start), end: new Date(start + (draft.end.getTime() - draft.start.getTime())), allDay: false, timeZone: zone };
}

/* ------------------------------ Event details ------------------------------ */

/** Descriptions are cut here: an invitation may carry a whole email thread. */
export const MAX_DESCRIPTION = 8000;

/** A description as plain text: Google sends HTML when it was written in its editor. */
export function plainText(text: string) {
  // Line breaks typed into the text count too: Google's own page shows them next to the tags.
  const plain = text
    .replace(/\r\n?/g, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li)\s*>/gi, "\n")
    .replace(/<\/?[a-z][^>]*>/gi, "");
  return decodeEntities(plain)
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_DESCRIPTION);
}

/**
 * The guest list to send when the user changed who is invited, or null when they didn't (then it isn't
 * sent at all, and nobody's answer is touched). Guests who stay keep the entry the provider has for
 * them, with their answer. `hidden` entries are the ones the editor never shows (rooms, the owner):
 * they always stay.
 */
export function mergeGuests<T>(
  before: T[],
  guests: { name: string; email: string }[],
  on: { email: (entry: T) => string; hidden: (entry: T) => boolean; make: (guest: { name: string; email: string }) => T },
): T[] | null {
  const key = (email: string) => email.trim().toLowerCase();
  const kept = before.filter(on.hidden);
  const keptEmails = new Set(kept.map((entry) => key(on.email(entry))));
  const had = new Map(before.filter((entry) => !on.hidden(entry)).map((entry) => [key(on.email(entry)), entry]));
  const wanted = new Map(guests.filter((guest) => !keptEmails.has(key(guest.email))).map((guest) => [key(guest.email), guest]));
  if (wanted.size === had.size && [...wanted.keys()].every((email) => had.has(email))) return null;
  return [...kept, ...[...wanted].map(([email, guest]) => had.get(email) ?? on.make(guest))];
}
