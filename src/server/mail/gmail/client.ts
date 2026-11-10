import { tk } from "@/lib/i18n";
import type { MailboxCredentials } from "../../db/schema";
import { refreshAccessToken } from "../../google";
import { MailAuthError, type AdapterAccount } from "../types";

/**
 * Thin Gmail REST client: OAuth token caching/refresh, retries and a per-mailbox quota budget.
 *
 * Gmail meters every call in "quota units" (messages.get = 20, batchModify = 50, send = 100, …) with a
 * limit of 6,000 units per minute per user and project (the prices and the limit changed on 1 May 2026).
 * We stay just under it client-side so a big import doesn't spend its time in back-offs, and still back
 * off (honouring Retry-After) when Google says so. Importing is therefore ~4.5 messages a second.
 */

export const API_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";
export const UPLOAD_BASE = "https://gmail.googleapis.com/upload/gmail/v1/users/me";

/** https://developers.google.com/workspace/gmail/api/reference/quota (prices since 1 May 2026) */
export const UNITS = {
  getProfile: 1,
  historyList: 2,
  messagesList: 5,
  messagesGet: 20,
  attachmentsGet: 20,
  trash: 20,
  batchModify: 50,
  send: 100,
  draftsCreate: 10,
  draftsUpdate: 15,
  draftsDelete: 10,
  draftsList: 5,
  draftsGet: 20,
  labelsList: 1,
  labelsCreate: 5,
  labelsPatch: 5,
  labelsDelete: 5,
  watch: 100,
  stop: 50,
  sendAsList: 1,
} as const;

/** 5,400 units a minute: under Google's 6,000 per user, with room for a quick action from the app. */
const UNITS_PER_SECOND = 90;
/**
 * After a per-minute quota error the client slows down (to this floor) instead of hitting it again,
 * and speeds up again a little after each quiet minute, so it settles at what Google allows.
 */
const MIN_UNITS_PER_SECOND = 10;
const SPEED_UP_AFTER_MS = 60_000;
const MAX_RETRIES = 5;
/** Google's rate-limit errors come as 429, or as 403 with one of these in the body. */
const RATE_LIMIT_TEXT = /rateLimitExceeded|userRateLimitExceeded|RATE_LIMIT_EXCEEDED|RESOURCE_EXHAUSTED|Quota exceeded/i;
/** Refresh a little before expiry so a token can't lapse mid-request. */
const EXPIRY_MARGIN_MS = 60_000;

export class GmailApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "GmailApiError";
  }
}

type Query = Record<string, string | number | boolean | string[] | undefined>;

export interface RequestOptions {
  method?: string;
  query?: Query;
  /** JSON body. */
  json?: unknown;
  /** Pre-encoded body (media uploads). */
  body?: { contentType: string; data: Buffer };
  units: number;
  base?: string;
}

export interface ClientOptions {
  /** Injectable for tests. */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function retryAfterMs(header: string | null, attempt: number): number {
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds)) return Math.min(seconds * 1000, 60_000);
    const at = Date.parse(header);
    if (Number.isFinite(at)) return Math.min(Math.max(at - Date.now(), 0), 60_000);
  }
  return Math.min(1000 * 2 ** attempt, 32_000) + Math.floor(Math.random() * 500);
}

export class GmailClient {
  private credentials: Extract<MailboxCredentials, { kind: "oauth" }>;
  private refreshing: Promise<string> | null = null;
  private windowStart = 0;
  private windowUnits = 0;
  private unitsPerSecond = UNITS_PER_SECOND;
  private slowedAt = 0;
  private sleep: (ms: number) => Promise<void>;

  constructor(
    private account: AdapterAccount,
    options: ClientOptions = {},
  ) {
    if (account.credentials.kind !== "oauth") {
      throw new MailAuthError(tk("Gmail accounts need OAuth credentials"), "invalid_credentials");
    }
    this.credentials = account.credentials;
    this.sleep = options.sleep ?? defaultSleep;
  }

  private async accessToken(): Promise<string> {
    const { accessToken, expiresAt } = this.credentials;
    if (accessToken && expiresAt && expiresAt - Date.now() > EXPIRY_MARGIN_MS) return accessToken;
    // Concurrent requests share one refresh instead of each burning a token request.
    this.refreshing ??= (async () => {
      try {
        const fresh = await refreshAccessToken(this.credentials.refreshToken);
        this.credentials = {
          kind: "oauth",
          refreshToken: fresh.refreshToken ?? this.credentials.refreshToken,
          accessToken: fresh.accessToken,
          expiresAt: fresh.expiresAt,
          scope: fresh.scope ?? this.credentials.scope,
        };
        await this.account.saveCredentials(this.credentials);
        return fresh.accessToken;
      } finally {
        this.refreshing = null;
      }
    })();
    return this.refreshing;
  }

  /** Waits until `units` fit into the current one-second window. */
  private async spend(units: number) {
    for (;;) {
      const now = Date.now();
      if (now - this.windowStart >= 1000) {
        this.windowStart = now;
        this.windowUnits = 0;
        if (this.unitsPerSecond < UNITS_PER_SECOND && now - this.slowedAt > SPEED_UP_AFTER_MS) {
          this.unitsPerSecond = Math.min(UNITS_PER_SECOND, this.unitsPerSecond + 5);
          this.slowedAt = now - SPEED_UP_AFTER_MS + 15_000;
        }
      }
      if (this.windowUnits === 0 || this.windowUnits + units <= this.unitsPerSecond) {
        this.windowUnits += units;
        return;
      }
      await this.sleep(1000 - (now - this.windowStart));
    }
  }

  async request<T>(path: string, options: RequestOptions): Promise<T> {
    const url = new URL((options.base ?? API_BASE) + path);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value === undefined) continue;
      for (const v of Array.isArray(value) ? value : [value]) url.searchParams.append(key, String(v));
    }
    let refreshedAfter401 = false;
    for (let attempt = 0; ; attempt++) {
      await this.spend(options.units);
      const token = await this.accessToken();
      const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
      let body: BodyInit | undefined;
      if (options.body) {
        headers["Content-Type"] = options.body.contentType;
        body = new Uint8Array(options.body.data);
      } else if (options.json !== undefined) {
        headers["Content-Type"] = "application/json";
        body = JSON.stringify(options.json);
      }
      const res = await fetch(url, { method: options.method ?? "GET", headers, body });

      if (res.ok) {
        const text = await res.text();
        return (text ? JSON.parse(text) : undefined) as T;
      }

      const errorText = await res.text().catch(() => "");
      if (res.status === 401) {
        if (refreshedAfter401) throw new MailAuthError(tk("Google rejected the access token"), "oauth_revoked");
        // The cached token may have been revoked or rotated server-side; refresh once and retry.
        refreshedAfter401 = true;
        this.credentials = { ...this.credentials, accessToken: undefined, expiresAt: undefined };
        continue;
      }
      const rateLimited = res.status === 429 || (res.status === 403 && RATE_LIMIT_TEXT.test(errorText));
      if ((rateLimited || res.status >= 500) && attempt < MAX_RETRIES) {
        // A per-minute quota only refills with the next minute, which the short exponential back-off
        // (≈30 s over all retries) can miss, so those waits grow in 20 s steps up to a minute.
        const perMinute = rateLimited && /per minute/i.test(errorText) && !res.headers.get("retry-after");
        const wait = perMinute ? Math.min(20_000 * (attempt + 1), 60_000) : retryAfterMs(res.headers.get("retry-after"), attempt);
        // Concurrent requests fail together, so slow down once per burst rather than once per request.
        if (perMinute && Date.now() - this.slowedAt > 15_000) {
          this.slowedAt = Date.now();
          this.unitsPerSecond = Math.max(MIN_UNITS_PER_SECOND, Math.round(this.unitsPerSecond * 0.6));
          console.warn(`Gmail per-minute quota: slowing to ${this.unitsPerSecond} units/s, retrying in ${Math.round(wait / 1000)} s (${errorText.slice(0, 160).replace(/\s+/g, " ")})`);
        } else if (attempt > 0 && !perMinute) console.warn(`Gmail ${res.status}, retrying in ${Math.round(wait / 1000)} s`);
        await this.sleep(wait);
        continue;
      }
      let message = errorText;
      try {
        message = (JSON.parse(errorText) as { error?: { message?: string } }).error?.message ?? errorText;
      } catch {}
      throw new GmailApiError(res.status, `Gmail API ${res.status} on ${path}: ${message}`);
    }
  }
}

/** Runs `fn` over `items` with at most `limit` in flight, preserving order. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
