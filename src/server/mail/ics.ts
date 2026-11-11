/**
 * Just enough iCalendar (RFC 5545) to show an invitation and answer it (iTIP REPLY, RFC 5546):
 * the first VEVENT, its times, organizer and attendees.
 */

export interface IcsProp {
  name: string;
  params: Record<string, string>;
  value: string;
  /** The line as it was (unfolded), for copying DTSTART & co. into the reply. */
  raw: string;
}

export interface Invite {
  method: string;
  uid: string;
  sequence: number;
  summary: string;
  location: string;
  description: string;
  /** ISO (UTC) for timed events; YYYY-MM-DD for all-day ones; wall time without zone when the event floats. */
  start: string | null;
  end: string | null;
  allDay: boolean;
  organizer: { name: string; email: string } | null;
  attendees: { name: string; email: string; status: string }[];
  /** Lines the reply must repeat to point at the same event (DTSTART, DTEND, RECURRENCE-ID). */
  timeLines: string[];
  /** The link to join the call (Teams, Google Meet, Zoom, Webex…), https only. */
  joinUrl: string | null;
}

/** Long lines continue on the next line after a space or tab. */
export function unfold(text: string) {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\n[ \t]/g, "").split("\n").filter(Boolean);
}

function parseLine(line: string): IcsProp | null {
  // NAME;PARAM=a;PARAM="b:c":VALUE — the first colon outside quotes ends the name part.
  let inQuote = false;
  let split = -1;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') inQuote = !inQuote;
    else if (line[i] === ":" && !inQuote) {
      split = i;
      break;
    }
  }
  if (split < 0) return null;
  const [name, ...rest] = line.slice(0, split).split(/;(?=(?:[^"]*"[^"]*")*[^"]*$)/);
  const params: Record<string, string> = {};
  for (const p of rest) {
    const eq = p.indexOf("=");
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, "");
  }
  return { name: name.toUpperCase(), params, value: line.slice(split + 1), raw: line };
}

const unescapeText = (s: string) => s.replace(/\\n/gi, "\n").replace(/\\([,;\\])/g, "$1");
const mailto = (s: string) => s.replace(/^mailto:/i, "").trim().toLowerCase();

/** Outlook sends Windows zone names; the common ones, mapped to IANA. */
export const WINDOWS_ZONES: Record<string, string> = {
  "Central Europe Standard Time": "Europe/Prague",
  "Central European Standard Time": "Europe/Warsaw",
  "W. Europe Standard Time": "Europe/Berlin",
  "Romance Standard Time": "Europe/Paris",
  "GMT Standard Time": "Europe/London",
  "Greenwich Standard Time": "UTC",
  "E. Europe Standard Time": "Europe/Bucharest",
  "FLE Standard Time": "Europe/Kiev",
  "Eastern Standard Time": "America/New_York",
  "Central Standard Time": "America/Chicago",
  "Mountain Standard Time": "America/Denver",
  "Pacific Standard Time": "America/Los_Angeles",
  UTC: "UTC",
};

/** One formatter per zone: making one costs far more than using it, and a repeating event asks thousands of times. */
const zoneFormats = new Map<string, Intl.DateTimeFormat>();

function zoneFormat(zone: string) {
  let format = zoneFormats.get(zone);
  if (!format) {
    format = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    // Names come from other people's files, in any spelling: don't keep them all forever.
    if (zoneFormats.size > 1000) zoneFormats.clear();
    zoneFormats.set(zone, format);
  }
  return format;
}

/** Offset of `zone` at the given UTC moment, in minutes. Throws a RangeError for a zone name Intl doesn't know. */
export function zoneOffset(utc: number, zone: string) {
  const parts = zoneFormat(zone).formatToParts(utc);
  const n = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return (Date.UTC(n("year"), n("month") - 1, n("day"), n("hour"), n("minute"), n("second")) - utc) / 60_000;
}

/** A wall time in a zone → UTC (two passes settle DST edges). */
export function zonedToUtc(y: number, mo: number, d: number, h: number, mi: number, s: number, zone: string) {
  const wall = Date.UTC(y, mo - 1, d, h, mi, s);
  let utc = wall - zoneOffset(wall, zone) * 60_000;
  utc = wall - zoneOffset(utc, zone) * 60_000;
  return utc;
}

function parseTime(prop: IcsProp | undefined): { value: string | null; allDay: boolean } {
  if (!prop) return { value: null, allDay: false };
  const v = prop.value.trim();
  const date = v.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (date || prop.params.VALUE === "DATE") {
    const m = date ?? v.match(/^(\d{4})(\d{2})(\d{2})/);
    return m ? { value: `${m[1]}-${m[2]}-${m[3]}`, allDay: true } : { value: null, allDay: true };
  }
  const m = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/);
  if (!m) return { value: null, allDay: false };
  const [y, mo, d, h, mi, s] = m.slice(1, 7).map(Number);
  if (m[7] === "Z") return { value: new Date(Date.UTC(y, mo - 1, d, h, mi, s)).toISOString(), allDay: false };
  const tzid = prop.params.TZID?.replace(/^\//, "");
  const zone = tzid && (WINDOWS_ZONES[tzid] ?? tzid);
  if (zone) {
    try {
      return { value: new Date(zonedToUtc(y, mo, d, h, mi, s, zone)).toISOString(), allDay: false };
    } catch {
      // An unknown zone name: show the wall time as it is.
    }
  }
  return { value: `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`, allDay: false };
}

/** Links that join a call, as Teams, Google Meet, Zoom and Webex write them into invitations. */
export const MEETING_LINK = [
  /^https:\/\/teams\.microsoft\.com\/(l\/meetup-join|meet)\//i,
  /^https:\/\/teams\.live\.com\/meet\//i,
  /^https:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}/i,
  /^https:\/\/([\w-]+\.)?zoom\.(us|com)\/(j|my|w)\//i,
  /^https:\/\/[\w-]+\.webex\.com\/([\w-]+\/j\.php|meet|join)/i,
];

/** An https address, with Microsoft's Safe Links wrapper taken off. */
export function httpsUrl(raw: string): string | null {
  try {
    let url = new URL(raw.replace(/[).,;:!?\]>'"]+$/, ""));
    const wrapped = /\.safelinks\.protection\.outlook\.com$/i.test(url.hostname) && url.searchParams.get("url");
    if (wrapped) url = new URL(wrapped);
    return url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

/** The values of an event that can carry the link to its call, as plain text (already unescaped). */
export interface JoinUrlSource {
  /** X-MICROSOFT-SKYPETEAMSMEETINGURL */
  teams?: string;
  /** X-GOOGLE-CONFERENCE */
  google?: string;
  /** Every CONFERENCE value (RFC 7986). */
  conferences?: string[];
  location?: string;
  url?: string;
  description?: string;
}

/**
 * Where to join the call: the property Teams or Google Calendar sets for it, a CONFERENCE link
 * (RFC 7986), a location that is just a link, or else the first meeting link in the text.
 */
export function joinUrlFrom(source: JoinUrlSource): string | null {
  for (const own of [source.teams, source.google]) {
    const url = httpsUrl((own ?? "").trim());
    if (url) return url;
  }
  for (const conference of source.conferences ?? []) {
    const url = httpsUrl(conference.trim());
    if (url) return url;
  }
  const location = (source.location ?? "").trim();
  // A place on a map isn't a call.
  const own = /^https:\/\/\S+$/i.test(location) && httpsUrl(location);
  if (own && !/^https:\/\/(([\w-]+\.)*(maps?|mapy)\.|[^/]*goo\.gl\/|[^/]+\/maps\b)/i.test(own)) return own;
  for (const text of [location, (source.url ?? "").trim(), (source.description ?? "").trim()]) {
    for (const raw of text.match(/https:\/\/[^\s<>"]+/gi) ?? []) {
      const url = httpsUrl(raw);
      if (url && MEETING_LINK.some((re) => re.test(url))) return url;
    }
  }
  return null;
}

function findJoinUrl(props: IcsProp[]): string | null {
  const value = (name: string) => unescapeText(props.find((p) => p.name === name)?.value ?? "");
  return joinUrlFrom({
    teams: value("X-MICROSOFT-SKYPETEAMSMEETINGURL"),
    google: value("X-GOOGLE-CONFERENCE"),
    conferences: props.filter((p) => p.name === "CONFERENCE").map((p) => p.value),
    location: value("LOCATION"),
    url: value("URL"),
    description: value("DESCRIPTION"),
  });
}

export function parseInvite(text: string): Invite | null {
  const lines = unfold(text);
  let method = "";
  let inEvent = false;
  let depth = 0;
  const props: IcsProp[] = [];
  for (const line of lines) {
    const p = parseLine(line);
    if (!p) continue;
    if (p.name === "METHOD" && !inEvent) method = p.value.trim().toUpperCase();
    if (p.name === "BEGIN" && p.value.toUpperCase() === "VEVENT") {
      if (props.length) break; // the first event is the invitation (others are exceptions)
      inEvent = true;
      continue;
    }
    if (!inEvent) continue;
    if (p.name === "BEGIN") depth++;
    else if (p.name === "END" && p.value.toUpperCase() === "VEVENT" && depth === 0) inEvent = false;
    else if (p.name === "END") depth--;
    else if (depth === 0) props.push(p);
  }
  const get = (name: string) => props.find((p) => p.name === name);
  const uid = get("UID")?.value.trim();
  if (!uid) return null;
  const start = parseTime(get("DTSTART"));
  const end = parseTime(get("DTEND"));
  const org = get("ORGANIZER");
  return {
    method: method || "PUBLISH",
    uid,
    sequence: Number(get("SEQUENCE")?.value) || 0,
    summary: unescapeText(get("SUMMARY")?.value ?? "").trim(),
    location: unescapeText(get("LOCATION")?.value ?? "").trim(),
    description: unescapeText(get("DESCRIPTION")?.value ?? "").trim().slice(0, 2000),
    start: start.value,
    end: end.value,
    allDay: start.allDay,
    organizer: org ? { name: org.params.CN ?? "", email: mailto(org.value) } : null,
    attendees: props
      .filter((p) => p.name === "ATTENDEE")
      .map((p) => ({ name: p.params.CN ?? "", email: mailto(p.value), status: (p.params.PARTSTAT ?? "NEEDS-ACTION").toUpperCase() })),
    timeLines: props.filter((p) => ["DTSTART", "DTEND", "RECURRENCE-ID"].includes(p.name)).map((p) => p.raw),
    joinUrl: findJoinUrl(props),
  };
}

export type RsvpStatus = "ACCEPTED" | "TENTATIVE" | "DECLINED";

const escapeText = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
const quoteParam = (s: string) => `"${s.replace(/"/g, "'")}"`;

/** Lines longer than 75 octets fold onto the next line (RFC 5545 §3.1). */
export function fold(line: string) {
  const out: string[] = [];
  let rest = line;
  while (Buffer.byteLength(rest) > 75) {
    let cut = 74;
    while (Buffer.byteLength(rest.slice(0, cut)) > 74) cut--;
    out.push(rest.slice(0, cut));
    rest = " " + rest.slice(cut);
  }
  out.push(rest);
  return out.join("\r\n");
}

const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

/** "2026-10-15T08:00:00.000Z" → 20261015T080000Z; a floating wall time stays without Z; a date → 20261015. */
function icsTime(value: string, allDay: boolean) {
  if (allDay) return value.replace(/-/g, "");
  if (value.endsWith("Z")) return stamp(new Date(value));
  return value.replace(/[-:]/g, "").slice(0, 15);
}

/**
 * The event alone, for the user's own calendar ("Add to calendar"): METHOD:PUBLISH, times in UTC, no
 * organizer or attendees, so calendars add it as an event rather than another invitation. The same
 * UID means adding it again updates it.
 */
export function buildEvent(invite: Invite, now = new Date()): string | null {
  if (!invite.start) return null;
  const date = invite.allDay ? ";VALUE=DATE" : "";
  const lines = [
    "BEGIN:VCALENDAR",
    "PRODID:-//Kolbaba//Mail//EN",
    "VERSION:2.0",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${invite.uid}`,
    `DTSTAMP:${stamp(now)}`,
    `DTSTART${date}:${icsTime(invite.start, invite.allDay)}`,
    ...(invite.end ? [`DTEND${date}:${icsTime(invite.end, invite.allDay)}`] : []),
    ...(invite.summary ? [`SUMMARY:${escapeText(invite.summary)}`] : []),
    ...(invite.location ? [`LOCATION:${escapeText(invite.location)}`] : []),
    ...(invite.description ? [`DESCRIPTION:${escapeText(invite.description)}`] : []),
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.map(fold).join("\r\n") + "\r\n";
}

/** The iTIP REPLY an organizer's calendar reads to update this attendee's answer. */
export function buildReply(invite: Invite, me: { name: string; email: string }, status: RsvpStatus, now = new Date()): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "PRODID:-//Kolbaba//Mail//EN",
    "VERSION:2.0",
    "CALSCALE:GREGORIAN",
    "METHOD:REPLY",
    "BEGIN:VEVENT",
    `UID:${invite.uid}`,
    `DTSTAMP:${stamp(now)}`,
    `SEQUENCE:${invite.sequence}`,
    ...invite.timeLines,
    ...(invite.organizer ? [`ORGANIZER${invite.organizer.name ? `;CN=${quoteParam(invite.organizer.name)}` : ""}:mailto:${invite.organizer.email}`] : []),
    `ATTENDEE;PARTSTAT=${status}${me.name ? `;CN=${quoteParam(me.name)}` : ""}:mailto:${me.email}`,
    ...(invite.summary ? [`SUMMARY:${escapeText(invite.summary)}`] : []),
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.map(fold).join("\r\n") + "\r\n";
}
