import { eq } from "drizzle-orm";
import { seal, unseal } from "../crypto";
import { db, schema } from "../db";
import type { MailboxCredentials } from "../db/schema";
import { createGmailAdapter } from "./gmail";
import { createImapAdapter } from "./imap";
import type { AdapterAccount, MailAdapter } from "./types";

/** A mailbox without its picture (ACCOUNT_COLUMNS in ../db): all that syncing and sending need. */
export type AccountRow = Omit<typeof schema.accounts.$inferSelect, "image">;

/** Decrypt credentials and hand the account to the right provider adapter. */
export function toAdapterAccount(row: AccountRow): AdapterAccount {
  return {
    id: row.id,
    email: row.email,
    fromName: row.fromName,
    provider: row.provider,
    imap: row.imap,
    smtp: row.smtp,
    folders: row.folders,
    credentials: unseal<MailboxCredentials>(row.credentials, row.id),
    syncState: row.syncState,
    saveCredentials: async (credentials) => {
      await db()
        .update(schema.accounts)
        .set({ credentials: seal(credentials, row.id) })
        .where(eq(schema.accounts.id, row.id));
    },
  };
}

export function adapterFor(row: AccountRow): MailAdapter {
  const account = toAdapterAccount(row);
  return row.provider === "gmail" ? createGmailAdapter(account) : createImapAdapter(account);
}

/** Run `fn` with a fresh adapter and always close it. */
export async function withAdapter<T>(row: AccountRow, fn: (adapter: MailAdapter) => Promise<T>): Promise<T> {
  const adapter = adapterFor(row);
  try {
    return await fn(adapter);
  } finally {
    await adapter.close().catch(() => {});
  }
}
