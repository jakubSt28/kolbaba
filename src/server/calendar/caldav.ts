import { Resolver } from "node:dns/promises";
import { within } from "../autodetect/dns";
import { buildObject, expandObject, removeOccurrence, setPartstat, splitProviderId, updateObject } from "./ics";
import { safeFetch, type SafeFetchInit, type SafeResponse } from "./net";
import { CalendarAuthError, CalendarConflictError, type CalendarProvider, type EventDraft, type ProviderCalendar, type ProviderEvent } from "./types";

/**
 * CalDAV (RFC 4791): the calendars of Seznam, iCloud, Fastmail and of servers people run themselves.
 * Every event is one .ics resource in a collection; a repeating event is one resource with its
 * exceptions inside, so changing one occurrence means reading the resource, changing it and writing
 * it back, guarded by its ETag.
 */

export interface CalDavLogin {
  username: string;
  password: string;
}

/** The DNS questions discovery asks (RFC 6764). */
export interface CalDavDns {
  resolveSrv(name: string): Promise<{ name: string; port: number; priority: number; weight: number }[]>;
  resolveTxt(name: string): Promise<string[][]>;
}

/** What tests replace: the HTTP function (default: safeFetch, which keeps the hosted app out of private networks) and DNS. */
export interface Deps {
  http?: (url: string, init?: SafeFetchInit) => Promise<SafeResponse>;
  dns?: CalDavDns;
}

/** Mail domains whose calendar server isn't announced in DNS. */
const KNOWN_SERVERS: Record<string, string> = {
  "seznam.cz": "https://caldav.seznam.cz",
  "email.cz": "https://caldav.seznam.cz",
  "post.cz": "https://caldav.seznam.cz",
  "spoluzaci.cz": "https://caldav.seznam.cz",
  "stream.cz": "https://caldav.seznam.cz",
  "firmy.cz": "https://caldav.seznam.cz",
  "icloud.com": "https://caldav.icloud.com",
  "me.com": "https://caldav.icloud.com",
  "mac.com": "https://caldav.icloud.com",
  "fastmail.com": "https://caldav.fastmail.com/dav/",
  "fastmail.fm": "https://caldav.fastmail.com/dav/",
  "gmx.net": "https://caldav.gmx.net",
  "gmx.de": "https://caldav.gmx.net",
  "gmx.com": "https://caldav.gmx.net",
  "yahoo.com": "https://caldav.calendar.yahoo.com",
  "mailbox.org": "https://dav.mailbox.org",
  "posteo.de": "https://posteo.de:8443",
  "posteo.net": "https://posteo.de:8443",
};

const DISCOVERY_TIMEOUT_MS = 8000;
const DNS_TIMEOUT_MS = 3000;
/** Resources asked for in one calendar-multiget. */
const MULTIGET_BATCH = 100;

// ---------------------------------------------------------------------------------------------
// XML. WebDAV answers are small and regular, so a reader of a few lines beats an XML library. Servers
// pick their own namespace prefixes ("D:href", "d:href", plain "href"): elements are matched by the
// name after the prefix.

interface XmlNode {
  /** The name without its namespace prefix. */
  name: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  /** The element's own text, entities and CDATA decoded. */
  text: string;
}

const NAMED: Record<string, string> = { lt: "<", gt: ">", quot: '"', apos: "'", amp: "&" };

function decodeEntities(text: string) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|lt|gt|quot|apos|amp);/gi, (whole, name: string) => {
    if (name[0] !== "#") return NAMED[name.toLowerCase()] ?? whole;
    const code = name[1].toLowerCase() === "x" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
  });
}

const localName = (name: string) => name.slice(name.lastIndexOf(":") + 1).toLowerCase();

const TOKEN = /<!\[CDATA\[([\s\S]*?)\]\]>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<![^>]*>|<\/([^\s>]+)\s*>|<([^\s>/]+)((?:\s+[^\s=>/]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;

function parseXml(xml: string): XmlNode {
  const root: XmlNode = { name: "", attrs: {}, children: [], text: "" };
  const stack = [root];
  for (const m of xml.matchAll(TOKEN)) {
    const top = stack[stack.length - 1];
    if (m[1] !== undefined) top.text += m[1];
    else if (m[2] !== undefined) {
      // Close the nearest open element of that name; a stray closing tag closes nothing.
      const name = localName(m[2]);
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].name !== name) continue;
        stack.length = i;
        break;
      }
    } else if (m[3] !== undefined) {
      const attrs: Record<string, string> = {};
      for (const a of (m[4] ?? "").matchAll(/([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[localName(a[1])] = decodeEntities(a[2] ?? a[3] ?? "");
      const node: XmlNode = { name: localName(m[3]), attrs, children: [], text: "" };
      top.children.push(node);
      if (!m[5]) stack.push(node);
    } else if (m[6] !== undefined) top.text += decodeEntities(m[6]);
  }
  return root;
}

const child = (node: XmlNode | undefined, name: string) => node?.children.find((c) => c.name === name);
const childrenOf = (node: XmlNode | undefined, name: string) => node?.children.filter((c) => c.name === name) ?? [];
const has = (node: XmlNode | undefined, name: string): boolean => !!node?.children.some((c) => c.name === name || has(c, name));
/** The address inside a property like <current-user-principal><href>…</href></current-user-principal>. */
const hrefIn = (node: XmlNode | undefined) => child(node, "href")?.text.trim() || null;

interface DavResponse {
  /** The href as the server wrote it. */
  href: string;
  /** The same, absolute. */
  url: string;
  /** Properties the server had (propstat with a 2xx status), by local name. */
  props: Map<string, XmlNode>;
}

const statusOf = (line: string | undefined) => Number(/^HTTP\/\S+\s+(\d{3})/i.exec(line?.trim() ?? "")?.[1]) || null;

/** hrefs come absolute or as paths, depending on the server: both resolve against the address that was asked. */
function absolute(href: string, base: string): string | null {
  try {
    return new URL(href.trim(), base).href;
  } catch {
    return null;
  }
}

function multistatus(xml: string, base: string): DavResponse[] {
  const out: DavResponse[] = [];
  for (const response of childrenOf(child(parseXml(xml), "multistatus"), "response")) {
    const href = child(response, "href")?.text.trim() ?? "";
    const url = absolute(href, base);
    const gone = statusOf(child(response, "status")?.text);
    if (!url || (gone !== null && (gone < 200 || gone >= 300))) continue;
    const props = new Map<string, XmlNode>();
    for (const propstat of childrenOf(response, "propstat")) {
      const status = statusOf(child(propstat, "status")?.text);
      if (status !== null && (status < 200 || status >= 300)) continue;
      for (const prop of child(propstat, "prop")?.children ?? []) props.set(prop.name, prop);
    }
    out.push({ href, url, props });
  }
  return out;
}

/** The same resource, however the two addresses escape their characters and end. */
function sameResource(a: string, b: string) {
  const norm = (value: string) => {
    try {
      const url = new URL(value);
      return `${url.origin}${decodeURIComponent(url.pathname).replace(/\/+$/, "")}`;
    } catch {
      return value;
    }
  };
  return norm(a) === norm(b);
}

const xmlEscape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// ---------------------------------------------------------------------------------------------
// Requests

interface DavRequest {
  depth?: "0" | "1";
  /** A PROPFIND or REPORT body. */
  xml?: string;
  /** Any other body (an event), with its own Content-Type in `headers`. */
  body?: string;
  headers?: Record<string, string>;
}

function davClient(login: CalDavLogin, deps: Deps, timeoutMs?: number) {
  const http = deps.http ?? safeFetch;
  const authorization = `Basic ${Buffer.from(`${login.username}:${login.password}`, "utf8").toString("base64")}`;
  return (method: string, url: string, req: DavRequest = {}) =>
    http(url, {
      method,
      body: req.xml ?? req.body,
      ...(timeoutMs ? { timeoutMs } : {}),
      headers: {
        Authorization: authorization,
        ...(req.depth ? { Depth: req.depth } : {}),
        ...(req.xml ? { "Content-Type": "application/xml; charset=utf-8", Prefer: "return-minimal" } : {}),
        ...req.headers,
      },
    });
}

type Dav = ReturnType<typeof davClient>;

const XML_HEAD = '<?xml version="1.0" encoding="utf-8"?>';
const NAMESPACES = 'xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"';
const FIND_HOME = `${XML_HEAD}<d:propfind ${NAMESPACES}><d:prop><d:current-user-principal/><d:principal-URL/><c:calendar-home-set/><d:resourcetype/></d:prop></d:propfind>`;
const FIND_CALENDARS =
  `${XML_HEAD}<d:propfind ${NAMESPACES} xmlns:a="http://apple.com/ns/ical/"><d:prop><d:resourcetype/><d:displayname/><a:calendar-color/>` +
  "<c:supported-calendar-component-set/><d:current-user-privilege-set/></d:prop></d:propfind>";

// ---------------------------------------------------------------------------------------------
// Discovery

type Found = { homeUrl: string } | "refused" | null;

/**
 * Asks one address who the user is and where their calendars live. `typed` is an address the user
 * gave: it may be the calendar home itself. `guess` is an address nobody announced (the mail
 * domain's own website): there a 403 means "nothing here", not "wrong password".
 */
async function probe(dav: Dav, url: string, how: { typed?: boolean; guess?: boolean } = {}): Promise<Found> {
  let res: SafeResponse;
  try {
    res = await dav("PROPFIND", url, { depth: "0", xml: FIND_HOME });
    // A redirect to another host loses the password on the way (see safeFetch). The server we were
    // sent to by the one we asked is the CalDAV server: ask it directly, once.
    if (res.status === 401 && new URL(res.url).origin !== new URL(url).origin) res = await dav("PROPFIND", res.url, { depth: "0", xml: FIND_HOME });
  } catch {
    return null;
  }
  if (res.status === 401 || (res.status === 403 && !how.guess)) return "refused";
  if (res.status !== 207) return null;
  const responses = multistatus(res.text, res.url);
  const self = responses.find((r) => sameResource(r.url, res.url)) ?? responses[0];
  if (!self) return null;

  const home = hrefIn(self.props.get("calendar-home-set"));
  const homeUrl = home && absolute(home, res.url);
  if (homeUrl) return { homeUrl };

  const principal = hrefIn(self.props.get("current-user-principal")) ?? hrefIn(self.props.get("principal-url"));
  const principalUrl = principal && absolute(principal, res.url);
  if (principalUrl && !sameResource(principalUrl, res.url)) {
    try {
      const asked = await dav("PROPFIND", principalUrl, { depth: "0", xml: FIND_HOME });
      if (asked.status === 401) return "refused";
      const theirs = asked.status === 207 ? hrefIn(multistatus(asked.text, asked.url)[0]?.props.get("calendar-home-set")) : null;
      const theirHome = theirs && absolute(theirs, asked.url);
      if (theirHome) return { homeUrl: theirHome };
    } catch {
      // Falls through to what the first answer says about the address itself.
    }
  }

  const type = self.props.get("resourcetype");
  if (how.typed && has(type, "collection")) {
    // The user gave a calendar's own address: its home is one level up.
    return { homeUrl: has(type, "calendar") ? new URL("..", res.url.replace(/\/*$/, "/")).href : res.url };
  }
  return null;
}

/** A server's address as announced or typed: asked as it is, and at its well-known address when it is just a host. */
async function probeServer(dav: Dav, url: string, how: { typed?: boolean } = {}): Promise<Found> {
  const found = await probe(dav, url, how);
  if (found) return found;
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return null;
  }
  return target.pathname === "/" ? probe(dav, new URL("/.well-known/caldav", target).href) : null;
}

function systemDns(): CalDavDns {
  const resolver = new Resolver({ timeout: DNS_TIMEOUT_MS, tries: 1 });
  return { resolveSrv: (name) => resolver.resolveSrv(name), resolveTxt: (name) => resolver.resolveTxt(name) };
}

/** The server a domain announces for CalDAV over TLS (RFC 6764 §3–4): the SRV record's host with the TXT record's path. */
async function announcedServer(dns: CalDavDns, domain: string): Promise<string | null> {
  const name = `_caldavs._tcp.${domain}`;
  const records = (await within(dns.resolveSrv(name), DNS_TIMEOUT_MS)) ?? [];
  // "." as the target means the service is explicitly not offered.
  const best = records.filter((r) => r.name && r.name !== "." && r.port > 0).sort((a, b) => a.priority - b.priority || b.weight - a.weight)[0];
  if (!best) return null;
  const txt = (await within(dns.resolveTxt(name), DNS_TIMEOUT_MS)) ?? [];
  const path = txt.map((chunks) => chunks.join("")).find((entry) => /^path=\//i.test(entry))?.slice(5);
  const host = best.name.toLowerCase().replace(/\.$/, "");
  return absolute(path ?? "/.well-known/caldav", `https://${host}${best.port === 443 ? "" : `:${best.port}`}`);
}

/** Find the account's calendar home. Tries, in order: `url` when given (a server, a principal or a home URL); known
 *  providers by the email's domain; RFC 6764 (SRV `_caldavs._tcp.<domain>` with its TXT `path=`, then
 *  `https://<domain>/.well-known/caldav`); then PROPFIND current-user-principal → calendar-home-set.
 *  Returns null when no CalDAV server answers; throws CalendarAuthError when a server is there but refuses the login
 *  (401/403). The first server that refuses ends the search: the password isn't offered to the next one. */
export async function discoverCalDav(input: { email: string; login: CalDavLogin; url?: string }, deps: Deps = {}): Promise<{ homeUrl: string } | null> {
  const dav = davClient(input.login, deps, DISCOVERY_TIMEOUT_MS);
  const domain = input.email.trim().toLowerCase().split("@")[1] ?? "";
  const typed = input.url?.trim();

  const steps: (() => Promise<Found>)[] = [];
  if (typed) steps.push(() => probeServer(dav, /^[a-z][a-z0-9+.-]*:\/\//i.test(typed) ? typed : `https://${typed}`, { typed: true }));
  const known = KNOWN_SERVERS[domain];
  if (known) steps.push(() => probeServer(dav, known));
  if (domain) {
    steps.push(async () => {
      const announced = await announcedServer(deps.dns ?? systemDns(), domain);
      return announced ? probe(dav, announced) : null;
    });
    steps.push(() => probe(dav, `https://${domain}/.well-known/caldav`, { guess: true }));
  }
  for (const step of steps) {
    const found = await step();
    if (found === "refused") throw new CalendarAuthError("The CalDAV server refused the sign-in");
    if (found) return found;
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// The provider

const stamp = (date: Date) => date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

function calendarQuery(from: Date, to: Date) {
  return (
    `${XML_HEAD}<c:calendar-query ${NAMESPACES}><d:prop><d:getetag/><c:calendar-data/></d:prop>` +
    `<c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT"><c:time-range start="${stamp(from)}" end="${stamp(to)}"/></c:comp-filter></c:comp-filter></c:filter>` +
    "</c:calendar-query>"
  );
}

function calendarMultiget(hrefs: string[]) {
  return `${XML_HEAD}<c:calendar-multiget ${NAMESPACES}><d:prop><d:getetag/><c:calendar-data/></d:prop>${hrefs.map((h) => `<d:href>${xmlEscape(h)}</d:href>`).join("")}</c:calendar-multiget>`;
}

function hexColor(value: string | undefined): string | null {
  // Apple writes "#RRGGBBAA".
  const m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(value?.trim() ?? "");
  return m ? `#${m[1].toLowerCase()}` : null;
}

function lastSegment(url: string) {
  try {
    return decodeURIComponent(new URL(url).pathname.replace(/\/+$/, "").split("/").pop() ?? "");
  } catch {
    return "";
  }
}

const PARTSTAT = { accepted: "ACCEPTED", tentative: "TENTATIVE", declined: "DECLINED" } as const;

export function createCalDavProvider(opts: { homeUrl: string; login: CalDavLogin; /** owner's addresses, lowercase */ me: string[]; tz: string }, deps: Deps = {}): CalendarProvider {
  const dav = davClient(opts.login, deps);
  const me = opts.me.map((m) => m.trim().toLowerCase()).filter(Boolean);

  const request = async (method: string, url: string, req?: DavRequest) => {
    const res = await dav(method, url, req);
    if (res.status === 401) throw new CalendarAuthError("The CalDAV server refused the sign-in");
    return res;
  };
  const failed = (method: string, res: SafeResponse) => new Error(`CalDAV ${method} failed (${res.status})`);

  /** Which resource a stored event is, and which occurrence in it. Requests carry the password, so they stay on the calendar's server. */
  const locate = (calendarId: string, providerId: string) => {
    const { key, rid } = splitProviderId(providerId);
    let ok = false;
    try {
      ok = new URL(key).origin === new URL(calendarId).origin;
    } catch {
      // Not an address at all.
    }
    if (!ok) throw new Error("The event doesn't belong to this calendar");
    return { key, rid };
  };

  /** The resource as it is now; null when it is gone. */
  const read = async (url: string) => {
    const res = await request("GET", url, { headers: { Accept: "text/calendar" } });
    if (res.status === 404 || res.status === 410) return null;
    if (res.status !== 200) throw failed("GET", res);
    return { ics: res.text, etag: res.headers.get("etag") };
  };
  const readForChange = async (url: string) => {
    const current = await read(url);
    if (!current) throw new CalendarConflictError("The event is no longer on the server");
    return current;
  };

  const write = async (url: string, ics: string, condition: Record<string, string>) => {
    const res = await request("PUT", url, { body: ics, headers: { "Content-Type": "text/calendar; charset=utf-8", ...condition } });
    if (res.status === 412) throw new CalendarConflictError("The event changed on the server");
    if (res.status < 200 || res.status >= 300) throw failed("PUT", res);
  };
  /** Only if it is still the version just read. */
  const ifUnchanged = (etag: string | null): Record<string, string> => (etag ? { "If-Match": etag } : {});

  const remove = async (url: string) => {
    const res = await request("DELETE", url);
    // Already gone is as good as deleted.
    if (res.status !== 404 && res.status !== 410 && (res.status < 200 || res.status >= 300)) throw failed("DELETE", res);
  };

  const organizer = (draft: EventDraft) => (draft.attendees.length && me[0] ? { name: "", email: me[0] } : null);

  return {
    sendsInvitations: false,

    async listCalendars() {
      const res = await request("PROPFIND", opts.homeUrl, { depth: "1", xml: FIND_CALENDARS });
      if (res.status !== 207) throw failed("PROPFIND", res);
      const calendars: ProviderCalendar[] = [];
      for (const item of multistatus(res.text, res.url)) {
        const type = item.props.get("resourcetype");
        if (!has(type, "calendar") || ["schedule-inbox", "schedule-outbox", "notification"].some((kind) => has(type, kind))) continue;
        const components = childrenOf(item.props.get("supported-calendar-component-set"), "comp").map((c) => (c.attrs.name ?? "").toUpperCase());
        if (components.length && !components.includes("VEVENT")) continue;
        const privileges = item.props.get("current-user-privilege-set");
        calendars.push({
          providerId: item.url,
          name: item.props.get("displayname")?.text.trim() || lastSegment(item.url),
          color: hexColor(item.props.get("calendar-color")?.text),
          readOnly: !!privileges && !["write", "write-content", "all"].some((p) => has(privileges, p)),
          // CalDAV doesn't name a main calendar.
          primary: false,
          shown: true,
        });
      }
      return calendars;
    },

    async listEvents(calendarId, from, to) {
      const res = await request("REPORT", calendarId, { depth: "1", xml: calendarQuery(from, to) });
      if (res.status !== 207) throw failed("REPORT", res);
      const resources = new Map<string, { etag: string | null; data: string }>();
      const bare: string[] = [];
      const collect = (items: DavResponse[]) => {
        for (const item of items) {
          const data = item.props.get("calendar-data")?.text.trim() ?? "";
          if (data) resources.set(item.url, { etag: item.props.get("getetag")?.text.trim() || null, data });
          else if (!sameResource(item.url, res.url) && !resources.has(item.url)) bare.push(item.href);
        }
      };
      collect(multistatus(res.text, res.url));
      // Some servers answer the query with addresses only: the events themselves come from a second question.
      const asked = [...bare];
      bare.length = 0;
      for (let i = 0; i < asked.length; i += MULTIGET_BATCH) {
        const more = await request("REPORT", calendarId, { depth: "1", xml: calendarMultiget(asked.slice(i, i + MULTIGET_BATCH)) });
        if (more.status !== 207) throw failed("REPORT", more);
        collect(multistatus(more.text, more.url));
      }

      const events: ProviderEvent[] = [];
      for (const [url, { etag, data }] of resources) {
        try {
          events.push(...expandObject(data, from, to, { key: url, etag, me, tz: opts.tz }));
        } catch {
          // One unreadable resource doesn't hide the rest of the calendar.
        }
      }
      return events.sort((a, b) => a.start.getTime() - b.start.getTime());
    },

    async createEvent(calendarId, draft) {
      const { uid, ics } = buildObject(draft, { uid: draft.uid, organizer: organizer(draft), clientSchedules: true });
      const url = new URL(`${encodeURIComponent(uid)}.ics`, calendarId.replace(/\/*$/, "/")).href;
      // Never over an event that is already there.
      await write(url, ics, { "If-None-Match": "*" });
    },

    async updateEvent(calendarId, ref, draft, scope) {
      const { key, rid } = locate(calendarId, ref.providerId);
      const current = await readForChange(key);
      const ics = updateObject(current.ics, draft, rid ? scope : "all", rid, { organizer: organizer(draft), clientSchedules: true });
      await write(key, ics, ifUnchanged(current.etag));
    },

    async deleteEvent(calendarId, ref, scope) {
      const { key, rid } = locate(calendarId, ref.providerId);
      if (!rid || scope === "all") return remove(key);
      const current = await read(key);
      if (!current) return;
      const ics = removeOccurrence(current.ics, rid);
      // A resource can't be left without any event in it.
      if (!/^BEGIN:VEVENT/im.test(ics)) return remove(key);
      await write(key, ics, ifUnchanged(current.etag));
    },

    async readObject(calendarId, ref) {
      return (await read(locate(calendarId, ref.providerId).key))?.ics ?? null;
    },

    async respond(calendarId, ref, status, scope) {
      const { key, rid } = locate(calendarId, ref.providerId);
      const current = await readForChange(key);
      const ics = setPartstat(current.ics, me, PARTSTAT[status], rid ? scope : "all", rid);
      if (ics !== current.ics) await write(key, ics, ifUnchanged(current.etag));
    },
  };
}
