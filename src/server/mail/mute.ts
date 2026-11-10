import { and, eq, isNull, lte, or, sql } from "drizzle-orm";
import { db, schema } from "../db";
import { logWarn } from "../log";
import { moveThread, moveToOwnFolder, setUnread } from "./service";

/**
 * Worker: a reply that came into a muted conversation brought it back to Inbox at the provider; it goes
 * back where it was (Archive, or its own folder), read. Inbox lists never show muted conversations, and
 * the sync doesn't notify about them (src/server/sync/sink.ts), so this only tidies the provider up.
 */
export async function archiveMutedMail() {
  const t = schema.threads;
  const rows = await db()
    .select({ id: t.id, userId: t.userId, unread: t.unread, folderId: t.folderId })
    .from(t)
    // Written out as threads_muted_inbox_idx says it, so this reads only muted conversations in Inbox.
    .where(and(sql`${t.mutedAt} is not null and ${t.folder} = 'inbox'`, eq(t.screening, false), or(isNull(t.snoozedUntil), lte(t.snoozedUntil, new Date()))))
    .limit(50);
  for (const r of rows) {
    try {
      if (r.folderId) await moveToOwnFolder(r.userId, r.id, r.folderId);
      else await moveThread(r.userId, r.id, "archive");
      if (r.unread) await setUnread(r.userId, r.id, false);
    } catch (err) {
      logWarn(`[mute] ${r.id}`, err);
    }
  }
  return rows.length;
}
