import type { NotifyMode, QuietHours } from "./types";

/** Minutes since midnight of "22:30"; null when it isn't a time. */
export function minutesOf(time: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h < 24 && min < 60 ? h * 60 + min : null;
}

/** The time of day in a zone, in minutes since midnight. An unknown zone counts as UTC. */
export function minutesIn(tz: string, now: Date): number {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  } catch {
    return now.getUTCHours() * 60 + now.getUTCMinutes();
  }
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return get("hour") * 60 + get("minute");
}

/** Whether `now` falls in the quiet hours. They may run over midnight (22:00–07:00). */
export function inQuietHours(quiet: QuietHours | undefined, now: Date): boolean {
  if (!quiet?.on) return false;
  const from = minutesOf(quiet.from);
  const to = minutesOf(quiet.to);
  if (from === null || to === null || from === to) return false;
  const at = minutesIn(quiet.tz, now);
  return from < to ? at >= from && at < to : at >= from || at < to;
}

/** What is known about a new email when deciding whether it may notify. */
export interface NewMailFacts {
  kind: "person" | "newsletter" | "notification";
  /** It carries a sign-in code: someone is waiting for it right now. */
  code: boolean;
  /** From a VIP in the address book. */
  vip: boolean;
  /** The conversation is watched ("Notify me of replies"). */
  watched: boolean;
  /** One of the user's rules takes care of it (it never notifies). */
  ruled: boolean;
}

/**
 * Whether a new email may buzz the phone. A watched conversation always does; then the mailbox's
 * setting and quiet hours decide, except that a sign-in code (asked for a moment ago) and a VIP get
 * through quiet hours, and a code gets through "people" and "VIPs" too. "Nothing" is nothing.
 */
export function mayNotify(mode: NotifyMode, quiet: boolean, mail: NewMailFacts): boolean {
  if (mail.watched) return true;
  if (mode === "none" || mail.ruled) return false;
  if (mail.code) return true;
  if (quiet) return mail.vip;
  if (mode === "vip") return mail.vip;
  if (mode === "people") return mail.vip || mail.kind === "person";
  return true;
}
