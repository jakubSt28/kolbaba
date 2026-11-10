import { snippetFromHtml } from "../sanitize";
import type { FetchMessageObject, MessageAddressObject, MessageStructureObject } from "imapflow";
import type { AttachmentMeta, FolderRole, Person } from "../../db/schema";
import type { Invite } from "../ics";
import type { MessageRef, RemoteMessage } from "../types";

/**
 * Pure mapping from imapflow fetch results to the adapter contract, kept free of I/O so it can be
 * tested with fixtures.
 */

/** Headers the envelope doesn't carry but threading and newsletter detection need. */
export const EXTRA_HEADERS = ["references", "in-reply-to", "list-unsubscribe", "list-unsubscribe-post", "list-id", "precedence"];

/** Messages up to this size get their body during sync so the reader opens without a round-trip. */
export const BODY_PREFETCH_LIMIT = 200 * 1024;

const SNIPPET_LENGTH = 200;

/** `${path}:${uidValidity}:${uid}`: unique per account and invalidated with UIDVALIDITY. */
export function providerMessageId(path: string, uidValidity: string, uid: number): string {
  return `${path}:${uidValidity}:${uid}`;
}

/** Folder paths may contain ":", so parse from the right. */
export function parseProviderMessageId(id: string): { path: string; uidValidity: string; uid: number } | null {
  const last = id.lastIndexOf(":");
  const prev = last > 0 ? id.lastIndexOf(":", last - 1) : -1;
  if (prev <= 0) return null;
  const uid = Number(id.slice(last + 1));
  if (!Number.isInteger(uid) || uid <= 0) return null;
  return { path: id.slice(0, prev), uidValidity: id.slice(prev + 1, last), uid };
}

/** Where a ref lives; the explicit columns win over the id (they follow moves the engine recorded). */
export function locate(ref: MessageRef): { path: string; uid: number } {
  if (ref.imapPath && ref.imapUid) return { path: ref.imapPath, uid: ref.imapUid };
  const parsed = parseProviderMessageId(ref.providerMessageId);
  if (!parsed) throw new Error(`Not an IMAP message id: ${ref.providerMessageId}`);
  return { path: parsed.path, uid: parsed.uid };
}

/** Raw header block (as fetched with HEADER.FIELDS) → lowercased name → unfolded value. */
export function parseHeaderBlock(raw: Buffer | string | undefined): Map<string, string> {
  const headers = new Map<string, string>();
  if (!raw) return headers;
  const unfolded = raw.toString("utf8").replace(/\r?\n[ \t]+/g, " ");
  for (const line of unfolded.split(/\r?\n/)) {
    const sep = line.indexOf(":");
    if (sep <= 0) continue;
    const key = line.slice(0, sep).trim().toLowerCase();
    if (!headers.has(key)) headers.set(key, line.slice(sep + 1).trim());
  }
  return headers;
}

/** All `<msg-id>` tokens in a References / In-Reply-To value, brackets kept (matches Message-ID form). */
export function parseMessageIds(value: string | undefined | null): string[] {
  return value?.match(/<[^<>\s]+>/g) ?? [];
}

function person(a: MessageAddressObject | undefined): Person | null {
  if (!a?.address) return null;
  return { name: a.name?.trim() ?? "", email: a.address.trim() };
}

function people(list: MessageAddressObject[] | undefined): Person[] {
  return (list ?? []).map(person).filter((p): p is Person => p !== null);
}

function toDate(value: Date | string | undefined): Date | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * The Date header is what users expect to see, but it's sender-controlled; a missing, broken or
 * far-future value would pin a message to the top of the list, so fall back to INTERNALDATE.
 */
export function messageDate(msg: Pick<FetchMessageObject, "envelope" | "internalDate">, now = Date.now()): Date {
  const header = toDate(msg.envelope?.date);
  const internal = toDate(msg.internalDate);
  if (header && header.getTime() <= now + 24 * 3600_000) return header;
  return internal ?? header ?? new Date(now);
}

function dispositionOf(node: MessageStructureObject): string | undefined {
  return node.disposition?.toLowerCase();
}

function filenameOf(node: MessageStructureObject): string | undefined {
  return node.dispositionParameters?.filename || node.parameters?.name || undefined;
}

function isBodyText(node: MessageStructureObject): boolean {
  const type = node.type.toLowerCase();
  return (type === "text/plain" || type === "text/html") && dispositionOf(node) !== "attachment" && !filenameOf(node);
}

/** BODYSTRUCTURE part number; a single-part message's only part is "1". */
function partOf(node: MessageStructureObject): string {
  return node.part || "1";
}

/**
 * Attachments from BODYSTRUCTURE. The id is the IMAP part number, so fetchAttachment downloads just
 * that part (the server decodes it) instead of the whole message.
 */
export function attachmentsFromStructure(root: MessageStructureObject | undefined): AttachmentMeta[] {
  const out: AttachmentMeta[] = [];
  const walk = (node: MessageStructureObject, inRelated: boolean) => {
    const type = node.type.toLowerCase();
    if (type.startsWith("multipart/")) {
      for (const child of node.childNodes ?? []) walk(child, type === "multipart/related");
      return;
    }
    if (isBodyText(node)) return;
    const disposition = dispositionOf(node);
    const cid = node.id?.replace(/^<|>$/g, "") || undefined;
    const encoded = node.size ?? 0;
    out.push({
      id: partOf(node),
      name: filenameOf(node) ?? defaultName(type),
      // BODYSTRUCTURE reports the encoded size; base64 inflates by 4/3.
      size: node.encoding?.toLowerCase() === "base64" ? Math.floor((encoded * 3) / 4) : encoded,
      mime: type,
      ...(cid ? { cid } : {}),
      inline: disposition === "inline" || (inRelated && !!cid && disposition !== "attachment"),
    });
  };
  if (root) walk(root, false);
  return out;
}

function defaultName(type: string): string {
  if (type === "message/rfc822") return "message.eml";
  const sub = type.split("/")[1]?.replace(/[^a-z0-9]+/g, "") || "bin";
  return `attachment.${sub}`;
}

export interface TextPart {
  part: string;
  type: string;
  encoding: string;
  charset: string;
}

/** First plain-text body part (or HTML when there is none), for a cheap snippet of large messages. */
export function findTextPart(root: MessageStructureObject | undefined): TextPart | null {
  let html: TextPart | null = null;
  const walk = (node: MessageStructureObject): TextPart | null => {
    const type = node.type.toLowerCase();
    if (type.startsWith("multipart/")) {
      for (const child of node.childNodes ?? []) {
        const found = walk(child);
        if (found) return found;
      }
      return null;
    }
    if (!isBodyText(node)) return null;
    const part: TextPart = {
      part: partOf(node),
      type,
      encoding: node.encoding?.toLowerCase() ?? "7bit",
      charset: node.parameters?.charset ?? "utf-8",
    };
    if (type === "text/plain") return part;
    html ??= part;
    return null;
  };
  return (root && walk(root)) || html;
}

/**
 * Decode a (possibly truncated) body part fetched raw. Handles the partial base64 quantum and a cut
 * quoted-printable escape at the end, since we fetch only the first few KB.
 */
export function decodePart(raw: Buffer, encoding: string, charset: string): string {
  let bytes: Buffer;
  if (encoding === "base64") {
    const clean = raw.toString("latin1").replace(/[^A-Za-z0-9+/]/g, "");
    bytes = Buffer.from(clean.slice(0, clean.length - (clean.length % 4)), "base64");
  } else if (encoding === "quoted-printable") {
    const text = raw
      .toString("latin1")
      .replace(/=\r?\n/g, "")
      .replace(/=[0-9A-Fa-f]?$/, "");
    bytes = Buffer.from(text.replace(/=([0-9A-Fa-f]{2})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16))), "latin1");
  } else {
    bytes = raw;
  }
  let text: string;
  try {
    text = new TextDecoder(charset.toLowerCase()).decode(bytes);
  } catch {
    text = new TextDecoder("utf-8").decode(bytes);
  }
  // The cut may split a multi-byte character.
  return text.replace(/\uFFFD+$/, "");
}

const ENTITIES: Record<string, string> = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

/** Crude HTML → text, good enough for a 200 character preview (not for display). */
export function htmlToSnippetText(html: string): string {
  return html
    .replace(/<(head|style|script|title)\b[\s\S]*?(<\/\1>|$)/gi, " ")
    .replace(/<br\s*\/?>|<\/(p|div|li|tr|h\d)>/gi, "\n")
    .replace(/<[^>]*>?/g, " ")
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] === "#") {
        const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : " ";
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    });
}

/** Preview text: quoted reply lines dropped, whitespace collapsed. */
export function makeSnippet(text: string | null | undefined, html?: string | null): string {
  // Prefer the HTML: for HTML-only mail mailparser generates `text` itself, with image URLs in
  // brackets and UPPERCASED headings — not what a preview line should show.
  if (html?.trim()) return snippetFromHtml(html, SNIPPET_LENGTH);
  const source = text?.trim() ? text : "";
  return source
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith(">"))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, SNIPPET_LENGTH);
}

export interface FolderContext {
  path: string;
  uidValidity: string;
  role: FolderRole | null;
}

export interface PrefetchedBody {
  html?: string | null;
  text?: string | null;
  snippet: string;
  invite?: Invite;
}

/** Build the contract message from one FETCH row (envelope, flags, bodystructure, extra headers). */
export function toRemoteMessage(msg: FetchMessageObject, folder: FolderContext, body?: PrefetchedBody): RemoteMessage {
  const env = msg.envelope ?? {};
  const headers = parseHeaderBlock(msg.headers);
  const flags = msg.flags ?? new Set<string>();
  const precedence = headers.get("precedence")?.toLowerCase();
  const inReplyTo = parseMessageIds(headers.get("in-reply-to") ?? env.inReplyTo)[0] ?? null;
  const from = person(env.from?.[0]) ?? person(env.sender?.[0]) ?? { name: "", email: "" };

  return {
    providerMessageId: providerMessageId(folder.path, folder.uidValidity, msg.uid),
    imapPath: folder.path,
    imapUid: msg.uid,
    messageIdHeader: env.messageId?.trim() || null,
    inReplyTo,
    references: parseMessageIds(headers.get("references")),
    from,
    to: people(env.to),
    cc: people(env.cc),
    bcc: people(env.bcc),
    replyTo: people(env.replyTo),
    subject: env.subject ?? "",
    date: messageDate(msg),
    snippet: body?.snippet ?? "",
    ...(body && body.html !== undefined ? { html: body.html } : {}),
    ...(body && body.text !== undefined ? { text: body.text } : {}),
    attachments: attachmentsFromStructure(msg.bodyStructure),
    ...(body?.invite ? { invite: body.invite } : {}),
    unread: !flags.has("\\Seen"),
    pinned: flags.has("\\Flagged"),
    role: folder.role,
    labels: [],
    listUnsubscribe: headers.get("list-unsubscribe") ?? null,
    listUnsubscribeOneClick: /list-unsubscribe=one-click/i.test(headers.get("list-unsubscribe-post") ?? ""),
    bulk: headers.has("list-id") || precedence === "bulk" || precedence === "list" || precedence === "junk",
  };
}
