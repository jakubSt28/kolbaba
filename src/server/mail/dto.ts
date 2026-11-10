import { createHash } from "node:crypto";
import { opensInBrowser } from "@/lib/attachment-inline";
import type { Account, Attachment, Draft, Insight, InviteEvent, Message, Thread } from "@/lib/types";
import type { schema } from "../db";
import type { AttachmentMeta } from "../db/schema";
import type { Invite } from "./ics";

/** Shapes the API returns. They match the client store types (src/lib/types.ts) so the UI is shared with mock mode. */

type AccountRow = typeof schema.accounts.$inferSelect;
type ThreadRow = typeof schema.threads.$inferSelect;
type MessageRow = typeof schema.messages.$inferSelect;
type DraftRow = typeof schema.drafts.$inferSelect;

export function accountDto(row: AccountRow, signatureHtml = ""): Account {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    provider: row.provider === "gmail" ? "gmail" : /seznam/i.test(row.providerLabel) ? "seznam" : "imap",
    hue: row.hue,
    icon: row.icon as Account["icon"],
    // Versioned by content, so the browser can cache the picture forever and still see a new one.
    image: row.image ? `/api/accounts/${row.id}/image?v=${createHash("sha1").update(row.image).digest("hex").slice(0, 10)}` : null,
    signature: signatureHtml,
    status: row.status,
    statusMessage: row.statusMessage,
    mcpEnabled: row.mcpEnabled,
    notify: row.notify,
    historyComplete: !!row.syncState.historyComplete,
  };
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function attachmentKind(name: string, mime: string): Attachment["kind"] {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (mime.startsWith("image/")) return "image";
  if (mime === "application/pdf" || ext === "pdf") return "pdf";
  if (mime === "text/calendar" || ext === "ics") return "calendar";
  if (/zip|compressed|x-tar|x-7z|rar/.test(mime) || ["zip", "rar", "7z", "gz", "tar"].includes(ext)) return "zip";
  if (/sheet|excel|csv/.test(mime) || ["xls", "xlsx", "csv", "numbers", "ods"].includes(ext)) return "sheet";
  return "doc";
}

export function attachmentDto(messageId: string, a: AttachmentMeta): Attachment {
  return {
    name: a.name,
    size: formatBytes(a.size),
    kind: attachmentKind(a.name, a.mime),
    url: `/api/attachments/${messageId}/${encodeURIComponent(a.id)}`,
    opensInBrowser: opensInBrowser(a.mime),
  };
}

/** What the list and the reader show of an invitation (no attendees, description or reply lines). */
export function inviteEventDto(invite: Invite): InviteEvent {
  return {
    method: invite.method,
    summary: invite.summary,
    location: invite.location,
    start: invite.start,
    end: invite.end,
    allDay: invite.allDay,
    organizer: invite.organizer,
    joinUrl: invite.joinUrl ?? null,
  };
}

export function messageDto(
  row: Pick<MessageRow, "id" | "from" | "to" | "cc" | "date" | "snippet" | "attachments" | "trackingId"> & Partial<Pick<MessageRow, "invite">>,
  body?: { html: string; blockedImages: number; trackers: string[]; remoteImages?: boolean; spyPixels?: number; cleanedLinks?: number },
): Message {
  return {
    id: row.id,
    from: row.from,
    to: row.to,
    cc: row.cc.length ? row.cc : undefined,
    date: row.date.getTime(),
    html: body?.html ?? "",
    snippet: row.snippet,
    bodyLoaded: !!body,
    blockedImages: body?.blockedImages || undefined,
    remoteImages: body?.remoteImages || undefined,
    trackers: body?.trackers.length ? body.trackers : undefined,
    spyPixels: body?.spyPixels || undefined,
    cleanedLinks: body?.cleanedLinks || undefined,
    attachments: row.attachments.filter((a) => !a.inline).map((a) => attachmentDto(row.id, a)),
    ...(row.invite ? { invite: inviteEventDto(row.invite) } : {}),
    tracked: row.trackingId ? true : undefined,
  };
}

export function threadDto(row: ThreadRow, messages: Message[], insight?: Insight, warm?: boolean): Thread {
  return {
    id: row.id,
    accountId: row.accountId,
    subject: row.subject || "(no subject)",
    messages,
    unread: row.unread,
    pinned: row.pinned,
    folder: row.folder,
    snoozedUntil: row.snoozedUntil?.getTime(),
    wokeAt: row.wokeAt?.getTime(),
    followUpAt: row.followUpAt?.getTime(),
    ...(row.lastSentAt ? { sentAt: row.lastSentAt.getTime() } : {}),
    logo: row.logoDomain ?? undefined,
    kind: row.kind,
    listUnsubscribe: row.listUnsubscribe,
    ...(row.listUnsubscribeOneClick ? { listUnsubscribeOneClick: true } : {}),
    ...(row.unsubscribedAt ? { unsubscribedAt: row.unsubscribedAt.getTime() } : {}),
    ...(row.screening ? { screening: true } : {}),
    ...(row.folderId ? { folderId: row.folderId } : {}),
    ...(row.mutedAt ? { muted: true } : {}),
    ...(row.watchedAt ? { watched: true } : {}),
    ...(row.note ? { note: row.note } : {}),
    ...(insight ? { insight } : {}),
    ...(warm ? { warm: true } : {}),
  };
}

export function draftDto(row: DraftRow): Draft {
  return {
    id: row.id,
    accountId: row.accountId,
    to: row.to,
    cc: row.cc,
    subject: row.subject,
    html: row.html,
    threadId: row.threadId ?? undefined,
    updatedAt: row.updatedAt.getTime(),
    agentId: row.agentId ?? undefined,
  };
}
