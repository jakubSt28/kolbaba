import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { translate, type Locale } from "@/lib/i18n";
import { randomToken } from "./crypto";
import { db, schema } from "./db";
import type { Person } from "./db/schema";
import { env } from "./env";
import { isQuiet, notifyUser, userLocale } from "./push";

/**
 * Read tracking: one 1×1 pixel per sent message.
 *
 * An open is a hint, not proof: Apple Mail Privacy Protection preloads every image on delivery,
 * Gmail serves the pixel from its cache after the first fetch, and many clients block images.
 * Product rule: no IP address or location is ever stored. The IP is only looked at in memory to
 * recognise Apple's proxy.
 */

/** Pixel URLs live under this path; the sanitizer strips it from our own sent copies. */
export const PIXEL_PATH = "/api/t/";

/** Random, URL-safe, 144 bits: unguessable, so nobody can fake opens for someone else's mail. */
export function createTrackingId(): string {
  return randomToken(18);
}

export const ownPixelPrefix = () => `${env.appUrl}${PIXEL_PATH}`;

/** A plain-looking image URL; `.gif` keeps it from standing out in the HTML source. */
export function pixelUrl(id: string): string {
  return `${ownPixelPrefix()}${id}.gif`;
}

/** Recover the tracking id from the route segment (`<id>.gif`). Null for anything malformed. */
export function trackingIdFromSegment(segment: string): string | null {
  const id = segment.replace(/\.gif$/i, "");
  return /^[A-Za-z0-9_-]{16,64}$/.test(id) ? id : null;
}

/** Append the pixel at the very end of the body, where it doesn't affect layout. */
export function injectPixel(html: string, url: string): string {
  const safe = url.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  const img = `<img width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0" src="${safe}">`;
  const at = html.toLowerCase().lastIndexOf("</body>");
  return at === -1 ? html + img : html.slice(0, at) + img + html.slice(at);
}

/* ------------------------------ Classification ----------------------------- */

export interface OpenClassification {
  /** Coarse label like "iPhone · Apple Mail" or "Gmail". */
  client: string;
  /** Fetched by Apple's Mail Privacy Protection proxy: proves delivery, not reading. */
  viaApple: boolean;
  /** Fetched through Gmail's image proxy: no device info, later opens may be cached. */
  viaGoogleProxy: boolean;
}

/**
 * Image proxies identify themselves in the User-Agent. First match wins.
 * - Gmail: "Mozilla/5.0 (Windows NT 5.1; rv:11.0) Gecko Firefox/11.0 (via ggpht.com GoogleImageProxy)"
 * - Yahoo / AOL: "YahooMailProxy; https://help.yahoo.com/kb/yahoo-mail-proxy-SLN28749.html"
 */
const PROXY_RULES: { match: RegExp; client: string; viaGoogleProxy?: boolean }[] = [
  { match: /GoogleImageProxy|ggpht\.com/i, client: "Gmail", viaGoogleProxy: true },
  { match: /YahooMailProxy/i, client: "Yahoo Mail" },
  { match: /Superhuman/i, client: "Superhuman" },
];

/**
 * Apple's address space. MPP fetches come from Apple (17.0.0.0/8) or from the iCloud Private Relay
 * egress ranges, which are run by CDN partners and too large to embed
 * (https://mask-api.icloud.com/egress-ip-ranges.csv); for those the bare "Mozilla/5.0" UA below is
 * the giveaway. Add CIDRs here if a range shows up in practice.
 */
const APPLE_IPV4 = ["17.0.0.0/8"];
const APPLE_IPV6_PREFIXES = ["2620:149:", "2a01:b740:", "2403:300:"];

/** OS from the UA, most specific first. */
const OS_RULES: [RegExp, string][] = [
  [/iPad/i, "iPad"],
  [/iPhone|Outlook-iOS/i, "iPhone"],
  [/Android/, "Android"],
  [/Windows/, "Windows"],
  [/Macintosh|Mac OS X/, "Mac"],
  [/CrOS/, "ChromeOS"],
  [/Linux|X11/, "Linux"],
];

/** Mail app / browser from the UA, first match wins. */
const APP_RULES: [RegExp, string][] = [
  [/Outlook-iOS|Outlook-Android|Microsoft Outlook|MSOffice|ms-office|Microsoft Office/i, "Outlook"],
  [/Thunderbird/, "Thunderbird"],
  [/Airmail/, "Airmail"],
  [/Spark/, "Spark"],
  [/eM ?Client/i, "eM Client"],
  [/Postbox/, "Postbox"],
  [/Edg(e|A|iOS)?\//, "Edge"],
  [/OPR\//, "Opera"],
  [/Firefox\/|FxiOS/, "Firefox"],
  [/; wv\)/, "Mail app"],
  [/Chrome\/|CriOS/, "Chrome"],
  // Apple Mail embeds WebKit without the "Safari/" token that Safari itself sends.
  [/AppleWebKit\/[\d.]+ \(KHTML, like Gecko\)(?!.*Safari\/)/, "Apple Mail"],
  [/Safari\//, "Safari"],
];

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    const v = Number(p);
    if (!/^\d{1,3}$/.test(p) || v > 255) return null;
    n = n * 256 + v;
  }
  return n;
}

function inCidr(ip: string, cidr: string): boolean {
  const [base, bits] = cidr.split("/");
  const a = ipv4ToInt(ip);
  const b = ipv4ToInt(base);
  if (a == null || b == null) return false;
  const size = 2 ** (32 - Number(bits));
  return Math.floor(a / size) === Math.floor(b / size);
}

export function isAppleIp(ip: string | null | undefined): boolean {
  if (!ip) return false;
  const addr = ip.trim().toLowerCase().replace(/^::ffff:/, "");
  if (addr.includes(":")) return APPLE_IPV6_PREFIXES.some((p) => addr.startsWith(p));
  return APPLE_IPV4.some((c) => inCidr(addr, c));
}

/** Turn a pixel request into a coarse client label. The IP is used for the Apple check only. */
export function classifyOpen({ userAgent, ip }: { userAgent: string | null | undefined; ip?: string | null }): OpenClassification {
  const ua = (userAgent ?? "").trim();
  // MPP's proxy sends exactly "Mozilla/5.0", nothing else.
  if (isAppleIp(ip) || ua === "Mozilla/5.0") return { client: "Apple Mail", viaApple: true, viaGoogleProxy: false };
  const proxy = PROXY_RULES.find((r) => r.match.test(ua));
  if (proxy) return { client: proxy.client, viaApple: false, viaGoogleProxy: !!proxy.viaGoogleProxy };
  const os = OS_RULES.find(([re]) => re.test(ua))?.[1];
  const app = APP_RULES.find(([re]) => re.test(ua))?.[1];
  const client = os && app ? `${os} · ${app}` : (os ?? app ?? "Unknown client");
  return { client, viaApple: false, viaGoogleProxy: false };
}

/* --------------------------------- Opens ---------------------------------- */

/** Proxies and prefetchers often fetch the pixel several times in a row. */
const DEDUPE_MS = 60_000;
/** At most this many opens of one email recorded per hour, and notified about. */
const OPENS_PER_HOUR = 10;
const NOTIFY_PER_HOUR = 3;

export interface OpenHit {
  trackingId: string;
  userAgent: string | null;
  ip: string | null;
  /** The request carries our session cookie: it's the sender looking at their own mail. */
  hasSessionCookie: boolean;
  now?: Date;
}

export type OpenOutcome = "recorded" | "duplicate" | "ignored";

function openedTitle(recipients: Person[], subject: string, locale: Locale): string {
  const who =
    recipients.length === 1
      ? (recipients[0].name.trim().split(/\s+/)[0] || recipients[0].email.split("@")[0] || translate(locale, "Someone"))
      : translate(locale, "Someone");
  return translate(locale, "{name} opened “{subject}”", { name: who, subject: subject.trim() || translate(locale, "(no subject)") });
}

/**
 * Record a pixel hit. Plain function (no request APIs) so it can run inside `after()` and in tests.
 * Push goes out only for real opens; Apple prefetches just mark the message as delivered.
 */
export async function recordOpen(hit: OpenHit, deps: { notify?: typeof notifyUser } = {}): Promise<OpenOutcome> {
  if (hit.hasSessionCookie) return "ignored";
  const now = hit.now ?? new Date();
  const [tracked] = await db().select().from(schema.trackedMessages).where(eq(schema.trackedMessages.id, hit.trackingId));
  if (!tracked || now < tracked.armedAt) return "ignored";

  const open = classifyOpen({ userAgent: hit.userAgent, ip: hit.ip });
  const id = `opn_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
  const since = new Date(now.getTime() - DEDUPE_MS);
  const hourAgo = new Date(now.getTime() - 3600_000);
  // One statement, so two simultaneous proxy fetches can't both pass the duplicate check. A recipient
  // changing their browser's name on every load can't flood the list: at most OPENS_PER_HOUR an hour.
  const inserted = await db().execute(sql`
    insert into open_events (id, tracked_id, at, client, via_apple, via_google_proxy)
    select ${id}, ${tracked.id}, ${now.toISOString()}::timestamptz, ${open.client}, ${open.viaApple}, ${open.viaGoogleProxy}
    where not exists (
      select 1 from open_events
      where tracked_id = ${tracked.id} and client = ${open.client} and at > ${since.toISOString()}::timestamptz
    )
    and (select count(*) from open_events where tracked_id = ${tracked.id} and at > ${hourAgo.toISOString()}::timestamptz) < ${OPENS_PER_HOUR}
    returning id`);
  if (inserted.length === 0) return "duplicate";

  // Nor the user's phone: at most NOTIFY_PER_HOUR buzzes an hour for one email.
  const [{ n }] = await db().execute<{ n: number }>(sql`
    select count(*)::int as n from open_events where tracked_id = ${tracked.id} and not via_apple and at > ${hourAgo.toISOString()}::timestamptz`);
  // Seen in the morning instead of at night: an open is recorded either way.
  if (!open.viaApple && n <= NOTIFY_PER_HOUR && !(await isQuiet(tracked.userId, now))) {
    await (deps.notify ?? notifyUser)(tracked.userId, {
      title: openedTitle(tracked.recipients, tracked.subject, await userLocale(tracked.userId)),
      body: open.client,
      url: tracked.threadId ? `/?thread=${encodeURIComponent(tracked.threadId)}` : "/",
      tag: `open-${tracked.id}`,
    });
  }
  return "recorded";
}

export interface OpenSummary {
  opens: { at: number; client: string; viaApple: boolean }[];
}

/** Opens per tracking id (oldest first), limited to the user's own tracked messages. */
export async function getOpenSummaries(userId: string, trackingIds: string[]): Promise<Record<string, OpenSummary>> {
  const ids = [...new Set(trackingIds.filter(Boolean))];
  if (!ids.length) return {};
  const t = schema.trackedMessages;
  const o = schema.openEvents;
  const rows = await db()
    .select({ trackedId: t.id, at: o.at, client: o.client, viaApple: o.viaApple })
    .from(t)
    .leftJoin(o, eq(o.trackedId, t.id))
    .where(and(eq(t.userId, userId), inArray(t.id, ids)))
    .orderBy(asc(o.at));
  const result: Record<string, OpenSummary> = {};
  for (const r of rows) {
    const entry = (result[r.trackedId] ??= { opens: [] });
    if (r.at) entry.opens.push({ at: r.at.getTime(), client: r.client ?? "", viaApple: r.viaApple ?? false });
  }
  return result;
}
