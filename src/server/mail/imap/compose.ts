import { randomBytes } from "node:crypto";
import MailComposer from "nodemailer/lib/mail-composer";
import type { Person } from "../../db/schema";
import type { OutgoingMessage } from "../types";

/**
 * Hosts whose SMTP server files a copy into Sent by itself; appending another copy over IMAP would
 * duplicate it. Seznam is not on the list: as far as we know (not verified against a live account)
 * its SMTP doesn't save, and Thunderbird's Seznam profile keeps "place a copy in Sent" on.
 */
const AUTO_SAVE_SENT_HOSTS: RegExp[] = [
  /(^|\.)gmail\.com$/i,
  /(^|\.)googlemail\.com$/i,
  /(^|\.)office365\.com$/i,
  /(^|\.)outlook\.com$/i,
  /(^|\.)hotmail\.com$/i,
  /(^|\.)live\.com$/i,
];

export function smtpAutoSavesSent(smtpHost: string | undefined | null): boolean {
  return !!smtpHost && AUTO_SAVE_SENT_HOSTS.some((re) => re.test(smtpHost.trim()));
}

export function domainOf(email: string): string {
  const at = email.lastIndexOf("@");
  return (at >= 0 ? email.slice(at + 1) : "").trim().toLowerCase() || "localhost";
}

/** `<random@sender-domain>`; the sender's domain keeps it unique and looks native to spam filters. */
export function newMessageId(fromEmail: string): string {
  return `<${randomBytes(16).toString("hex")}@${domainOf(fromEmail)}>`;
}

const addr = (p: Person) => ({ name: p.name, address: p.email });

export interface BuiltMessage {
  messageId: string;
  /** What goes over SMTP: no Bcc header, so Bcc recipients stay hidden. */
  raw: Buffer;
  /** Copy for the Sent folder: keeps Bcc so the sender still sees who got it. */
  sentCopy: Buffer;
  envelope: { from: string; to: string[] };
}

export async function buildMessage(message: OutgoingMessage, date = new Date()): Promise<BuiltMessage> {
  const messageId = newMessageId(message.from.email);
  const references = [...(message.references ?? [])];
  if (message.inReplyTo && !references.includes(message.inReplyTo)) references.push(message.inReplyTo);

  const composer = new MailComposer({
    from: addr(message.from),
    to: message.to.map(addr),
    cc: message.cc.map(addr),
    bcc: message.bcc.map(addr),
    subject: message.subject,
    html: message.html,
    text: message.text,
    messageId,
    date,
    ...(message.inReplyTo ? { inReplyTo: message.inReplyTo } : {}),
    ...(references.length ? { references } : {}),
    headers: message.headers,
    attachments: message.attachments?.map((a) => ({
      filename: a.filename,
      content: a.content,
      contentType: a.contentType,
      ...(a.cid ? { cid: a.cid } : {}),
    })),
    ...(message.icalEvent ? { icalEvent: { method: message.icalEvent.method, content: message.icalEvent.content, filename: "invite.ics" } } : {}),
    disableFileAccess: true,
    disableUrlAccess: true,
  });

  const node = composer.compile();
  const raw = await node.build();
  node.keepBcc = true;
  const sentCopy = await node.build();
  const recipients = [...message.to, ...message.cc, ...message.bcc].map((p) => p.email);
  return { messageId, raw, sentCopy, envelope: { from: message.from.email, to: [...new Set(recipients)] } };
}
