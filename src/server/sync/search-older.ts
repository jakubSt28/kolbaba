import { and, eq, ne } from "drizzle-orm";
import { db, schema } from "../db";
import { withAdapter } from "../mail/adapters";
import { logWarn } from "../log";
import { DbSyncSink } from "./sink";
import { parseSearch } from "@/lib/search";

/** Per mailbox and search: enough to answer it, not a second history import. */
const PER_MAILBOX = 50;

/**
 * Search at the providers for mail the history import hasn't brought in yet (mailboxes still
 * importing): what matches is imported, so the app's own search finds it next. Mailboxes whose
 * whole history is here have nothing more to find.
 */
export async function searchOlderMail(userId: string, rawQuery: string, scope: string): Promise<{ imported: number; searched: number }> {
  // Providers search words; the app's own operators (from:, has:…) narrow down what comes in, here.
  const parsed = parseSearch(rawQuery);
  const query = [parsed.text, ...parsed.from, ...parsed.to, ...parsed.subject].join(" ").trim();
  if (!query) return { imported: 0, searched: 0 };
  const accounts = await db()
    .select()
    .from(schema.accounts)
    .where(and(eq(schema.accounts.userId, userId), ne(schema.accounts.status, "auth_error"), ...(scope !== "all" ? [eq(schema.accounts.id, scope)] : [])));
  const pending = accounts.filter((a) => !a.syncState.historyComplete);
  let imported = 0;
  for (const account of pending) {
    const sink = new DbSyncSink(account, false);
    imported += await withAdapter(account, (a) => (a.searchOlder ? a.searchOlder(sink, query, PER_MAILBOX) : Promise.resolve(0))).catch((err) => {
      logWarn(`[${account.id}] searching older mail failed`, err);
      return 0;
    });
  }
  return { imported, searched: pending.length };
}
