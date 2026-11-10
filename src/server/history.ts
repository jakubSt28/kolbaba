import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { HistoryEntry, HistoryKind } from "@/lib/types";
import type { ThreadPatchInput } from "./api/schemas";
import { db, schema } from "./db";
import type { HistorySnapshot, ThreadFolder } from "./db/schema";
import { HttpError } from "./http-error";
import { applyThreadPatch, patchThreads } from "./mail/service";
import { forgetSender } from "./mail/screener-actions";

/**
 * "My history": what the user did to their mail in the app (archive, delete, file, snooze, pin…),
 * kept for 30 days with Undo. Written by the API routes the app calls, so agents' steps (through MCP,
 * logged in agent_events) and Undo itself don't show up here.
 */

type Change = { kind: HistoryKind; data?: Record<string, string | number> };

export async function snapshotThreads(userId: string, ids: string[]): Promise<(HistorySnapshot & { subject: string })[]> {
  if (!ids.length) return [];
  const rows = await db()
    .select({
      id: schema.threads.id,
      folder: schema.threads.folder,
      folderId: schema.threads.folderId,
      snoozedUntil: schema.threads.snoozedUntil,
      pinned: schema.threads.pinned,
      mutedAt: schema.threads.mutedAt,
      subject: schema.threads.subject,
    })
    .from(schema.threads)
    .where(and(eq(schema.threads.userId, userId), inArray(schema.threads.id, ids)));
  // In the order asked, so the first one names the entry.
  return ids.flatMap((id) => {
    const r = rows.find((x) => x.id === id);
    return r ? [{ id: r.id, folder: r.folder, folderId: r.folderId, snoozedUntil: r.snoozedUntil?.getTime() ?? null, pinned: r.pinned, muted: !!r.mutedAt, subject: r.subject }] : [];
  });
}

/** What a change from the app amounts to; null for what isn't worth a line (read / unread, reminders). */
export function describeChange(patch: ThreadPatchInput, before: { folder: ThreadFolder }[], folderName?: string): Change | null {
  if (patch.folderId) return { kind: "filed", data: { folder: folderName ?? "" } };
  if (patch.folder === "inbox") {
    const from = before[0]?.folder;
    return { kind: from === "trash" ? "restored" : from === "spam" ? "not_spam" : "inbox" };
  }
  if (patch.folder === "archive") return { kind: "archived" };
  if (patch.folder === "trash") return { kind: "deleted" };
  if (patch.folder === "spam") return { kind: "spam" };
  if (typeof patch.snoozedUntil === "number") return { kind: "snoozed", data: { until: patch.snoozedUntil } };
  if (patch.snoozedUntil === null) return { kind: "unsnoozed" };
  if (patch.pinned !== undefined) return { kind: patch.pinned ? "pinned" : "unpinned" };
  if (patch.muted !== undefined) return { kind: patch.muted ? "muted" : "unmuted" };
  return null;
}

export async function recordHistory(
  userId: string,
  change: Change,
  done: (HistorySnapshot & { subject?: string })[],
  /** `count`: how many, when the conversations aren't listed one by one (an emptied Trash). `always`: a line even with none (a block). */
  opts: { undoable?: boolean; count?: number; always?: boolean } = {},
): Promise<string | null> {
  if (!done.length && !opts.count && !opts.always) return null;
  const [row] = await db()
    .insert(schema.history)
    .values({
      userId,
      kind: change.kind,
      threadIds: done.map((s) => s.id),
      subject: done[0]?.subject ?? "",
      count: opts.count ?? done.length,
      data: change.data ?? {},
      undo: done.map(({ id, folder, folderId, snoozedUntil, pinned, muted }) => ({ id, folder, folderId, snoozedUntil, pinned, ...(muted ? { muted } : {}) })),
      undoable: opts.undoable ?? true,
    })
    .returning({ id: schema.history.id });
  return row?.id ?? null;
}

/**
 * A change from the app, logged: snapshot, apply, record what went through. `undo` marks it as the
 * app's own Undo (from the toast): no new line, the line it reverses is marked undone instead.
 */
export async function patchWithHistory(userId: string, ids: string[], patch: ThreadPatchInput & { undo?: boolean }) {
  const { undo, ...change } = patch;
  const before = await snapshotThreads(userId, ids);
  const failed = await patchThreads(userId, ids, change);
  if (undo) {
    await markUndone(userId, ids);
    return failed;
  }
  const folderName = change.folderId
    ? (await db().select({ name: schema.mailFolders.name }).from(schema.mailFolders).where(eq(schema.mailFolders.id, change.folderId)))[0]?.name
    : undefined;
  const what = describeChange(change, before, folderName);
  if (what) await recordHistory(userId, what, before.filter((s) => !failed.includes(s.id)));
  return failed;
}

/** One conversation (the reader, a swipe): errors reach the app as they are. */
export async function patchOneWithHistory(userId: string, id: string, patch: ThreadPatchInput & { undo?: boolean }) {
  const { undo, ...change } = patch;
  const before = await snapshotThreads(userId, [id]);
  await applyThreadPatch(userId, id, change);
  if (undo) return markUndone(userId, [id]);
  const folderName = change.folderId
    ? (await db().select({ name: schema.mailFolders.name }).from(schema.mailFolders).where(eq(schema.mailFolders.id, change.folderId)))[0]?.name
    : undefined;
  const what = describeChange(change, before, folderName);
  if (what) await recordHistory(userId, what, before);
}

/** The newest line (from the last few minutes) about these conversations, now reversed by Undo. */
async function markUndone(userId: string, ids: string[]) {
  const [latest] = await db()
    .select({ id: schema.history.id, threadIds: schema.history.threadIds })
    .from(schema.history)
    .where(
      and(
        eq(schema.history.userId, userId),
        isNull(schema.history.undoneAt),
        sql`${schema.history.at} > now() - interval '15 minutes'`,
        sql`${schema.history.threadIds} ?| array[${sql.join(
          ids.map((i) => sql`${i}`),
          sql`, `,
        )}]::text[]`,
      ),
    )
    .orderBy(desc(schema.history.at))
    .limit(1);
  if (latest) await db().update(schema.history).set({ undoneAt: new Date() }).where(eq(schema.history.id, latest.id));
}

const restoreTarget = (folder: ThreadFolder) => (folder === "trash" || folder === "spam" || folder === "archive" ? folder : folder === "sent" ? "archive" : "inbox");

/** What puts one conversation back the way the snapshot has it, for this kind of change. */
function reverse(kind: HistoryKind, s: HistorySnapshot): ThreadPatchInput {
  switch (kind) {
    case "pinned":
    case "unpinned":
      return { pinned: s.pinned };
    case "unsnoozed":
      return { snoozedUntil: s.snoozedUntil };
    case "unmuted":
      return { muted: true };
    case "muted":
      // Back where it was, and listening again.
      return s.folderId ? { muted: false, folderId: s.folderId } : { muted: false, folder: restoreTarget(s.folder) };
    case "snoozed":
      return s.folderId ? { snoozedUntil: null, folderId: s.folderId } : { snoozedUntil: s.snoozedUntil, ...(s.folder === "inbox" ? {} : { folder: restoreTarget(s.folder) }) };
    default:
      return s.folderId ? { folderId: s.folderId } : { folder: restoreTarget(s.folder), snoozedUntil: s.snoozedUntil };
  }
}

export async function undoHistory(userId: string, id: string) {
  const [entry] = await db()
    .select()
    .from(schema.history)
    .where(and(eq(schema.history.id, id), eq(schema.history.userId, userId)));
  if (!entry) throw new HttpError(404, "Not found", "not_found");
  if (!entry.undoable || entry.undoneAt) throw new HttpError(409, "That can't be undone anymore", "not_undoable");
  // Conversations needing the same change go together, one provider connection per mailbox.
  const groups = new Map<string, { patch: ThreadPatchInput; ids: string[] }>();
  for (const s of entry.undo) {
    const patch = reverse(entry.kind, s);
    const key = JSON.stringify(patch);
    groups.set(key, { patch, ids: [...(groups.get(key)?.ids ?? []), s.id] });
  }
  // A block is undone by unblocking first, so the mail coming back doesn't go straight to Trash again.
  if (entry.kind === "blocked" && typeof entry.data.sender === "string") await forgetSender(userId, entry.data.sender);
  const failed: string[] = [];
  for (const g of groups.values()) failed.push(...(await patchThreads(userId, g.ids, g.patch)));
  await db().update(schema.history).set({ undoneAt: new Date() }).where(eq(schema.history.id, id));
  return { failed };
}

/** Newest first; `before` is the last line of the previous page (compared in the database, to the microsecond). */
export async function listHistory(userId: string, opts: { before?: string; limit?: number } = {}): Promise<{ entries: HistoryEntry[]; next: string | null }> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 100);
  const h = schema.history;
  const rows = await db()
    .select()
    .from(h)
    .where(
      and(
        eq(h.userId, userId),
        opts.before ? sql`(${h.at}, ${h.id}) < (select p.at, p.id from history p where p.id = ${opts.before} and p.user_id = ${userId})` : undefined,
      ),
    )
    .orderBy(desc(h.at), desc(h.id))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  return {
    entries: page.map((r) => ({
      id: r.id,
      at: r.at.getTime(),
      kind: r.kind,
      subject: r.subject,
      count: r.count,
      threadIds: r.threadIds,
      data: r.data,
      undoable: r.undoable && !r.undoneAt,
      undone: !!r.undoneAt,
    })),
    next: rows.length > limit ? page[page.length - 1].id : null,
  };
}
