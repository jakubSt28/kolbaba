import { and, eq } from "drizzle-orm";
import { tk, translate, type Locale } from "@/lib/i18n";
import type { InviteInfo } from "@/lib/types";
import { db, schema } from "../db";
import { HttpError } from "../http-error";
import { withAdapter } from "./adapters";
import { inviteEventDto } from "./dto";
import { buildEvent, buildReply, parseInvite, type Invite, type RsvpStatus } from "./ics";
import { getAttachment, ownedAccount } from "./service";

const isCalendar = (a: { name: string; mime: string }) => a.mime === "text/calendar" || a.mime === "application/ics" || /\.ics$/i.test(a.name);

async function load(userId: string, messageId: string) {
  const [m] = await db()
    .select()
    .from(schema.messages)
    .where(and(eq(schema.messages.id, messageId), eq(schema.messages.userId, userId)));
  if (!m) throw new HttpError(404, "Not found", "not_found");
  let invite = m.invite;
  if (!invite) {
    // Synced before invitations were read at sync, or too big to read then: read it now, once.
    const part = m.attachments.find(isCalendar);
    if (!part) throw new HttpError(404, "Not found", "not_found");
    const file = await getAttachment(userId, messageId, part.id);
    invite = parseInvite(file.content.toString("utf8"));
    if (!invite) throw new HttpError(422, "This invitation can't be read.", "bad_invite");
    await db().update(schema.messages).set({ invite }).where(eq(schema.messages.id, m.id));
  }
  const account = await ownedAccount(userId, m.accountId);
  return { message: m, invite, account };
}

function info(invite: Invite, me: string, rsvp: RsvpStatus | null): InviteInfo {
  const mine = invite.attendees.find((a) => a.email === me.toLowerCase());
  const answered = rsvp ?? (mine && mine.status !== "NEEDS-ACTION" ? (mine.status as RsvpStatus) : null);
  return {
    ...inviteEventDto(invite),
    attendees: invite.attendees.length,
    status: answered,
    // An invitation the user sent, or one that only informs (PUBLISH, CANCEL), has nothing to answer.
    canReply: invite.method === "REQUEST" && !!invite.organizer && invite.organizer.email !== me.toLowerCase(),
  };
}

export async function inviteFor(userId: string, messageId: string): Promise<InviteInfo> {
  const { message, invite, account } = await load(userId, messageId);
  return info(invite, account.email, message.rsvp);
}

/** The event as a file the user's calendar adds (Apple Calendar, Outlook…). */
export async function inviteEventFile(userId: string, messageId: string): Promise<{ name: string; content: string }> {
  const { invite } = await load(userId, messageId);
  const content = buildEvent(invite);
  if (!content) throw new HttpError(422, "This invitation can't be read.", "bad_invite");
  const name = (invite.summary || "event").replace(/[^\p{L}\p{N} ._-]+/gu, "").trim().slice(0, 60) || "event";
  return { name: `${name}.ics`, content };
}

const SUBJECT = {
  ACCEPTED: tk("Accepted: {summary}"),
  TENTATIVE: tk("Tentative: {summary}"),
  DECLINED: tk("Declined: {summary}"),
};
const BODY = {
  ACCEPTED: tk("I accept the invitation."),
  TENTATIVE: tk("I might come."),
  DECLINED: tk("I decline the invitation."),
};

/** Answers an invitation: an iTIP REPLY to the organizer, which their calendar reads. */
export async function respondToInvite(userId: string, messageId: string, status: RsvpStatus, locale: Locale): Promise<InviteInfo> {
  const { message, invite, account } = await load(userId, messageId);
  if (invite.method !== "REQUEST" || !invite.organizer) throw new HttpError(400, "This invitation can't be answered.", "not_answerable");
  const [user] = await db().select({ name: schema.users.name }).from(schema.users).where(eq(schema.users.id, userId));
  const me = { name: account.fromName || user?.name || "", email: account.email };
  const vars = { summary: invite.summary || translate(locale, "(no subject)"), name: me.name || me.email };
  const text = translate(locale, BODY[status], vars);
  await withAdapter(account, (adapter) =>
    adapter.send({
      from: me,
      to: [invite.organizer!],
      cc: [],
      bcc: [],
      subject: translate(locale, SUBJECT[status], vars),
      html: `<p>${text.replace(/[&<>]/g, (c) => `&#${c.charCodeAt(0)};`)}</p>`,
      text,
      inReplyTo: message.messageIdHeader,
      references: message.messageIdHeader ? [...message.references, message.messageIdHeader].slice(-20) : [],
      icalEvent: { method: "REPLY", content: buildReply(invite, me, status) },
    }),
  );
  await db().update(schema.messages).set({ rsvp: status }).where(eq(schema.messages.id, message.id));
  return info(invite, account.email, status);
}
