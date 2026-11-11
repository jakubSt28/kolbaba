import { asc, eq } from "drizzle-orm";
import type { AttendeeStatus, EditScope } from "@/lib/calendar/types";
import { intlLocale, tk, translate, type Locale } from "@/lib/i18n";
import { ACCOUNT_COLUMNS, db, schema } from "../db";
import type { Person } from "../db/schema";
import { withAdapter } from "../mail/adapters";
import { userLocale } from "../push";
import { itipMessage, itipReply, splitProviderId } from "./ics";

/**
 * Invitations by email, for calendars that don't send them themselves (CalDAV, Kolbaba's own): the
 * event goes to its guests as an iCalendar REQUEST they can answer from any calendar, a change goes
 * out again, and a deleted event (or a guest taken off) gets a CANCEL. Google and Microsoft do all
 * of this on their side.
 */

type EventRow = typeof schema.calendarEvents.$inferSelect;
type SourceRow = typeof schema.calendarSources.$inferSelect;

export type InvitationChange =
  | { kind: "created" }
  /** `removed`: guests taken off; `old`: the event as it was, to tell them from. */
  | { kind: "updated"; removed: string[]; old: string | null; scope: EditScope }
  | { kind: "cancelled"; scope: EditScope };

const SUBJECT = {
  created: tk("Invitation: {title}"),
  updated: tk("Updated invitation: {title}"),
  cancelled: tk("Cancelled: {title}"),
};
const LEAD = {
  created: tk("{name} invites you to an event."),
  updated: tk("{name} changed this event."),
  cancelled: tk("{name} cancelled this event."),
};

const escape = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

/** "Wednesday 11 November 2026, 9:00 – 10:00 (Europe/Prague)", or the day(s) for an all-day event. */
export function whenText(event: Pick<EventRow, "startAt" | "endAt" | "allDay">, tz: string, locale: Locale) {
  const lang = intlLocale(locale);
  if (event.allDay) {
    const day = new Intl.DateTimeFormat(lang, { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
    const last = new Date(event.endAt.getTime() - 86_400_000);
    return last > event.startAt ? `${day.format(event.startAt)} – ${day.format(last)}` : day.format(event.startAt);
  }
  const day = new Intl.DateTimeFormat(lang, { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: tz });
  const time = new Intl.DateTimeFormat(lang, { hour: "numeric", minute: "2-digit", timeZone: tz });
  const sameDay = day.format(event.startAt) === day.format(event.endAt);
  const end = sameDay ? time.format(event.endAt) : `${day.format(event.endAt)}, ${time.format(event.endAt)}`;
  return `${day.format(event.startAt)}, ${time.format(event.startAt)} – ${end} (${tz})`;
}

export async function sendInvitations(userId: string, source: SourceRow, input: InvitationChange & { ics: string; event: EventRow; tz: string }) {
  const mailboxes = await db().select(ACCOUNT_COLUMNS).from(schema.accounts).where(eq(schema.accounts.userId, userId)).orderBy(asc(schema.accounts.sortOrder));
  // From the mailbox the calendar came with; one of Kolbaba's own calendars invites from the first mailbox.
  const mailbox = mailboxes.find((m) => m.id === source.accountId) ?? mailboxes.find((m) => m.email.toLowerCase() === source.label.toLowerCase()) ?? mailboxes[0];
  if (!mailbox) return;
  const [user] = await db().select({ name: schema.users.name }).from(schema.users).where(eq(schema.users.id, userId));
  const locale = await userLocale(userId);
  const me: Person = { name: mailbox.fromName || user?.name || "", email: mailbox.email };
  const own = new Set(mailboxes.map((m) => m.email.toLowerCase()));
  const guests = input.event.attendees.filter((a) => !own.has(a.email.toLowerCase())).map((a) => ({ name: a.name, email: a.email }));
  // One occurrence of a repeating event, when only that one changed.
  const rid = "scope" in input && input.scope === "this" ? splitProviderId(input.event.providerId).rid : null;

  const send = async (kind: keyof typeof SUBJECT, to: Person[], ics: string) => {
    if (!to.length) return;
    const vars = { title: input.event.title || translate(locale, "(No title)"), name: me.name || me.email };
    const lines = [translate(locale, LEAD[kind], vars), "", vars.title, whenText(input.event, input.tz, locale), input.event.location].filter((l, i) => l || i === 1);
    const method = kind === "cancelled" ? "CANCEL" : "REQUEST";
    await withAdapter(mailbox, (adapter) =>
      adapter.send({
        from: me,
        to,
        cc: [],
        bcc: [],
        subject: translate(locale, SUBJECT[kind], vars),
        html: lines.map((l) => (l ? `<p>${escape(l)}</p>` : "")).join(""),
        text: lines.join("\n"),
        icalEvent: { method, content: itipMessage(ics, method, { rid }) },
      }),
    );
  };

  if (input.kind === "cancelled") return send("cancelled", guests, input.ics);
  await send(input.kind, guests, input.ics);
  if (input.kind === "updated" && input.removed.length && input.old) {
    const gone = input.removed.filter((email) => !own.has(email)).map((email) => ({ name: "", email }));
    await send("cancelled", gone, input.old);
  }
}

const PARTSTAT = { accepted: "ACCEPTED", tentative: "TENTATIVE", declined: "DECLINED" } as const;
// The same words as an answer given from the invitation's email (src/server/mail/invites.ts).
const ANSWER_SUBJECT = { accepted: tk("Accepted: {summary}"), tentative: tk("Tentative: {summary}"), declined: tk("Declined: {summary}") };
const ANSWER_BODY = { accepted: tk("I accept the invitation."), tentative: tk("I might come."), declined: tk("I decline the invitation.") };

/**
 * Tells the organizer the user's answer to an invitation kept at CalDAV or in one of Kolbaba's own
 * calendars: an iCalendar REPLY by email, from the mailbox that was invited. `ics` is the event after
 * the answer was saved. Returns false when there was nobody to write to, or the calendar's own server
 * already does it.
 */
export async function sendAnswer(
  userId: string,
  source: SourceRow,
  input: { ics: string; event: EventRow; status: Exclude<AttendeeStatus, "needsAction">; scope: EditScope },
): Promise<boolean> {
  const mailboxes = await db().select(ACCOUNT_COLUMNS).from(schema.accounts).where(eq(schema.accounts.userId, userId)).orderBy(asc(schema.accounts.sortOrder));
  const own = [...new Set([source.label.toLowerCase(), ...mailboxes.map((m) => m.email.toLowerCase())])].filter((a) => a.includes("@"));
  const rid = input.scope === "this" ? splitProviderId(input.event.providerId).rid : null;
  const reply = itipReply(input.ics, own, PARTSTAT[input.status], { rid });
  if (!reply || reply.serverReplies) return false;
  // From the address that was invited, when it's a mailbox here; else from the calendar's mailbox.
  const mailbox = mailboxes.find((m) => m.email.toLowerCase() === reply.attendee) ?? mailboxes.find((m) => m.id === source.accountId) ?? mailboxes[0];
  if (!mailbox) return false;
  const [user] = await db().select({ name: schema.users.name }).from(schema.users).where(eq(schema.users.id, userId));
  const locale = await userLocale(userId);
  const me: Person = { name: mailbox.fromName || user?.name || "", email: mailbox.email };
  const vars = { summary: input.event.title || translate(locale, "(No title)") };
  const text = translate(locale, ANSWER_BODY[input.status]);
  await withAdapter(mailbox, (adapter) =>
    adapter.send({
      from: me,
      to: [reply.organizer],
      cc: [],
      bcc: [],
      subject: translate(locale, ANSWER_SUBJECT[input.status], vars),
      html: `<p>${escape(text)}</p>`,
      text,
      icalEvent: { method: "REPLY", content: reply.content },
    }),
  );
  return true;
}
