import addressparser from "nodemailer/lib/addressparser";
import type { AttachmentMeta, FolderRole, Person } from "../../db/schema";
import { parseInvite } from "../ics";
import type { MessageBody, RemoteMessage } from "../types";

/** Subset of the Gmail API `Message` resource we read. */
export interface GmailHeader {
  name: string;
  value: string;
}

export interface GmailPart {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: { attachmentId?: string; size?: number; data?: string };
  parts?: GmailPart[];
}

export interface GmailMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  historyId?: string;
  /** Epoch ms as a string; when Gmail received the message (more trustworthy than the Date header). */
  internalDate?: string;
  sizeEstimate?: number;
  payload?: GmailPart;
}

/** Bodies above this aren't stored during sync; the reader fetches them lazily via `fetchBody`. */
export const INLINE_BODY_LIMIT = 200_000;

// ---------------------------------------------------------------------------------------------------
// Header decoding

const ENCODED_WORD = /=\?([^?\s]+)\?([BbQq])\?([^?\s]*)\?=/g;

function decodeCharset(bytes: Buffer, charset: string): string {
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return bytes.toString("utf8");
  }
}

function qDecode(text: string): Buffer {
  const bytes: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const hex = text.slice(i + 1, i + 3);
    if (text[i] === "_") bytes.push(0x20);
    else if (text[i] === "=" && /^[0-9a-f]{2}$/i.test(hex)) {
      bytes.push(parseInt(hex, 16));
      i += 2;
    } else bytes.push(text.charCodeAt(i) & 0xff);
  }
  return Buffer.from(bytes);
}

/**
 * RFC 2047 encoded-word decoding. Gmail hands headers over undecoded. Adjacent words in the same charset
 * are joined at the byte level because many mailers split a multi-byte character (e.g. "Š") across two
 * words; whitespace between encoded words is dropped as RFC 2047 §6.2 requires.
 */
export function decodeMimeWords(value: string): string {
  let out = "";
  let last = 0;
  let pending: { charset: string; bytes: Buffer[] } | null = null;
  const flush = () => {
    if (pending) out += decodeCharset(Buffer.concat(pending.bytes), pending.charset);
    pending = null;
  };
  for (const m of value.matchAll(ENCODED_WORD)) {
    const gap = value.slice(last, m.index);
    // RFC 2231 allows a language suffix: =?UTF-8*cs?Q?...?=
    const charset = m[1].split("*")[0].toLowerCase();
    const bytes = m[2].toUpperCase() === "B" ? Buffer.from(m[3], "base64") : qDecode(m[3]);
    const adjacent = pending !== null && /^\s*$/.test(gap);
    if (adjacent && pending!.charset === charset) pending!.bytes.push(bytes);
    else {
      flush();
      if (!adjacent) out += gap;
      pending = { charset, bytes: [bytes] };
    }
    last = m.index + m[0].length;
  }
  flush();
  return out + value.slice(last);
}

/** Parses an address-list header (From/To/Cc/…), decoding display names; groups are flattened. */
export function parseAddressList(value: string | undefined): Person[] {
  if (!value) return [];
  return addressparser(value, { flatten: true })
    .map((a) => ({ name: decodeMimeWords(a.name ?? "").trim(), email: (a.address ?? "").trim() }))
    .filter((p) => p.email);
}

/** Extracts `<id>` tokens; Message-IDs are kept with angle brackets, exactly as they appear in headers. */
export function parseMessageIds(value: string | undefined): string[] {
  return value?.match(/<[^<>\s]+>/g) ?? [];
}

const NAMED_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** Gmail snippets are HTML-escaped (`&#39;`, `&amp;`, …). */
export function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] !== "#") return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
    const code = entity[1] === "x" || entity[1] === "X" ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
  });
}

function headerMap(headers: GmailHeader[] | undefined): Map<string, string> {
  const map = new Map<string, string>();
  for (const h of headers ?? []) {
    const key = h.name.toLowerCase();
    if (!map.has(key)) map.set(key, h.value);
  }
  return map;
}

// ---------------------------------------------------------------------------------------------------
// Labels

/** Spam/trash win over everything (Gmail can leave other labels on them); SENT counts only outside INBOX. */
export function roleFromLabels(labels: string[]): FolderRole {
  if (labels.includes("TRASH")) return "trash";
  if (labels.includes("SPAM")) return "spam";
  if (labels.includes("DRAFT")) return "drafts";
  if (labels.includes("INBOX")) return "inbox";
  if (labels.includes("SENT")) return "sent";
  return "archive";
}

export function flagsFromLabels(labels: string[]) {
  return { unread: labels.includes("UNREAD"), pinned: labels.includes("STARRED"), role: roleFromLabels(labels), labels };
}

// ---------------------------------------------------------------------------------------------------
// Body

export function decodeBase64Url(data: string): Buffer {
  return Buffer.from(data, "base64url");
}

function decodeText(part: GmailPart, headers: Map<string, string>): string {
  // Gmail undoes the transfer encoding but leaves the bytes in the part's declared charset.
  const charset = /charset\s*=\s*"?([^";\s]+)/i.exec(headers.get("content-type") ?? "")?.[1] ?? "utf-8";
  return decodeCharset(decodeBase64Url(part.body?.data ?? ""), charset);
}

/** Walks the MIME tree: first text/html and text/plain win, everything else with content is an attachment. */
export function extractBody(payload: GmailPart | undefined): MessageBody {
  const body: MessageBody = { html: null, text: null, attachments: [] };
  const walk = (part: GmailPart) => {
    const mime = (part.mimeType ?? "").toLowerCase();
    if (mime.startsWith("multipart/")) {
      part.parts?.forEach(walk);
      return;
    }
    const headers = headerMap(part.headers);
    const disposition = (headers.get("content-disposition") ?? "").toLowerCase();
    const isBodyText =
      (mime === "text/html" || mime === "text/plain") && !part.filename && !disposition.startsWith("attachment");
    if (isBodyText) {
      if (mime === "text/html") body.html ??= decodeText(part, headers);
      else body.text ??= decodeText(part, headers);
      return;
    }
    if (!part.body?.attachmentId && !part.body?.data) return;
    if (mime === "text/calendar" && part.body?.data && !body.invite) body.invite = parseInvite(decodeText(part, headers)) ?? undefined;
    const cid = headers.get("content-id")?.trim().replace(/^<|>$/g, "") || undefined;
    const attachment: AttachmentMeta = {
      // partId is stable across fetches; Gmail's attachmentId isn't, so it's resolved again on download.
      id: part.partId ?? "",
      name: decodeMimeWords(part.filename || "") || (mime === "message/rfc822" ? "message.eml" : "attachment"),
      size: part.body?.size ?? 0,
      mime: mime || "application/octet-stream",
    };
    if (cid) attachment.cid = cid;
    if (disposition.startsWith("inline") || (cid && !disposition.startsWith("attachment"))) attachment.inline = true;
    body.attachments.push(attachment);
  };
  if (payload) walk(payload);
  return body;
}

export function findPart(payload: GmailPart | undefined, partId: string): GmailPart | undefined {
  if (!payload) return undefined;
  if (payload.partId === partId) return payload;
  for (const child of payload.parts ?? []) {
    const found = findPart(child, partId);
    if (found) return found;
  }
  return undefined;
}

// ---------------------------------------------------------------------------------------------------
// Message

/**
 * Maps a Gmail message (format=full or metadata) to the adapter contract. With `format=full`, bodies up to
 * INLINE_BODY_LIMIT are included so the reader opens without a round-trip; otherwise html/text stay
 * undefined (= fetch lazily). Attachment metadata needs the full MIME tree, so it's only set from `full`.
 */
export function mapMessage(msg: GmailMessage): RemoteMessage {
  const headers = headerMap(msg.payload?.headers);
  const labels = msg.labelIds ?? [];
  const hasTree = Boolean(msg.payload?.body?.data || msg.payload?.parts?.length);
  const body = hasTree ? extractBody(msg.payload) : null;
  const bodySize = (body?.html?.length ?? 0) + (body?.text?.length ?? 0);
  const inlineBody = body && bodySize <= INLINE_BODY_LIMIT;

  const internal = Number(msg.internalDate);
  const headerDate = Date.parse(headers.get("date") ?? "");
  const date = new Date(Number.isFinite(internal) && internal > 0 ? internal : Number.isFinite(headerDate) ? headerDate : 0);
  const precedence = (headers.get("precedence") ?? "").trim().toLowerCase();

  return {
    providerMessageId: msg.id,
    providerThreadId: msg.threadId,
    messageIdHeader: parseMessageIds(headers.get("message-id"))[0] ?? null,
    inReplyTo: parseMessageIds(headers.get("in-reply-to"))[0] ?? null,
    references: parseMessageIds(headers.get("references")),
    from: parseAddressList(headers.get("from"))[0] ?? { name: "", email: "" },
    to: parseAddressList(headers.get("to")),
    cc: parseAddressList(headers.get("cc")),
    bcc: parseAddressList(headers.get("bcc")),
    replyTo: parseAddressList(headers.get("reply-to")),
    subject: decodeMimeWords(headers.get("subject") ?? "").trim(),
    date,
    snippet: decodeEntities(msg.snippet ?? ""),
    ...(inlineBody ? { html: body.html, text: body.text } : {}),
    attachments: body?.attachments ?? [],
    ...(body?.invite ? { invite: body.invite } : {}),
    ...flagsFromLabels(labels),
    listUnsubscribe: headers.get("list-unsubscribe")?.replace(/\s+/g, " ").trim() || null,
    listUnsubscribeOneClick: /list-unsubscribe=one-click/i.test(headers.get("list-unsubscribe-post") ?? ""),
    bulk: headers.has("list-id") || ["bulk", "list", "junk"].includes(precedence),
  };
}
