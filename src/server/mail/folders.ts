import { and, eq, gt, inArray, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import { tk, translate } from "@/lib/i18n";
import type { MailFolder } from "@/lib/types";
import { db, schema } from "../db";
import { HttpError } from "../http-error";
import { logWarn } from "../log";
import { userLocale } from "../push";
import { withAdapter, type AccountRow } from "./adapters";
import type { ProviderFolder } from "./types";

/**
 * The user's own folders (see `mail_folders`): one list across mailboxes, matched by name. At each
 * provider a folder is a Gmail label or an IMAP folder, made there the first time mail from that
 * mailbox goes in. The sync reports what each provider has (`syncOwnFolders`); conversations follow
 * where their messages are (src/server/sync/sink.ts).
 */

type FolderRow = typeof schema.mailFolders.$inferSelect;

/** Colours handed out to new folders in turn: distinct from each other in both themes. */
const HUES = [262, 160, 28, 205, 330, 95, 0, 50, 290, 130, 230, 15];

export const MAX_FOLDER_NAME = 60;

/**
 * Folders a provider fills on its own (Seznam sorts newsletters into "newsletters"): shown under a
 * readable name in the user's language, and renamed in the app only, so the provider keeps finding it.
 */
const PROVIDER_FOLDERS: Record<string, string> = { newsletters: tk("Newsletters") };
const providerFolderName = (ref: string) => PROVIDER_FOLDERS[ref.toLowerCase()];

const dto = (row: FolderRow): MailFolder => ({ id: row.id, name: row.name, hue: row.hue, accountIds: Object.keys(row.refs) });

function cleanName(name: string) {
  const clean = name.replace(/\s+/g, " ").trim();
  if (!clean) throw new HttpError(400, "Give the folder a name", "folder_name");
  if (clean.length > MAX_FOLDER_NAME) throw new HttpError(400, "That name is a little long", "folder_name");
  return clean;
}

async function nextHue(userId: string) {
  const rows = await db().select({ hue: schema.mailFolders.hue }).from(schema.mailFolders).where(eq(schema.mailFolders.userId, userId));
  const used = new Set(rows.map((r) => r.hue));
  return HUES.find((h) => !used.has(h)) ?? HUES[rows.length % HUES.length];
}

export async function listFolders(userId: string): Promise<MailFolder[]> {
  const rows = await db().select().from(schema.mailFolders).where(eq(schema.mailFolders.userId, userId)).orderBy(schema.mailFolders.createdAt);
  const counts = await countsByFolder(userId);
  return rows.map((row) => ({ ...dto(row), unread: counts.unread.get(row.id) ?? {}, count: counts.total.get(row.id) ?? {} }));
}

/**
 * Conversations per own folder and mailbox, as the folder's list shows them (not snoozed, not in a
 * bin): unread ones for the number beside it, all of them for whether its icon holds papers.
 */
async function countsByFolder(userId: string) {
  const t = schema.threads;
  const rows = await db()
    .select({
      folderId: t.folderId,
      accountId: t.accountId,
      unread: sql<number>`(count(*) filter (where ${t.unread}))::int`,
      total: sql<number>`count(*)::int`,
    })
    .from(t)
    .where(
      and(
        eq(t.userId, userId),
        isNotNull(t.folderId),
        gt(t.messageCount, 0),
        inArray(t.folder, ["inbox", "archive", "sent"]),
        or(isNull(t.snoozedUntil), lte(t.snoozedUntil, new Date())),
      ),
    )
    .groupBy(t.folderId, t.accountId);
  const unread = new Map<string, Record<string, number>>();
  const total = new Map<string, Record<string, number>>();
  for (const r of rows) {
    if (r.unread) unread.set(r.folderId!, { ...unread.get(r.folderId!), [r.accountId]: r.unread });
    total.set(r.folderId!, { ...total.get(r.folderId!), [r.accountId]: r.total });
  }
  return { unread, total };
}

async function ownedFolder(userId: string, id: string) {
  const [row] = await db()
    .select()
    .from(schema.mailFolders)
    .where(and(eq(schema.mailFolders.id, id), eq(schema.mailFolders.userId, userId)));
  if (!row) throw new HttpError(404, "That folder no longer exists", "not_found");
  return row;
}

const sameName = (userId: string, name: string) =>
  and(eq(schema.mailFolders.userId, userId), sql`lower(${schema.mailFolders.name}) = lower(${name})`);

export async function createFolder(userId: string, input: { name: string; hue?: number; accountId?: string }): Promise<MailFolder> {
  const name = cleanName(input.name);
  const [taken] = await db().select().from(schema.mailFolders).where(sameName(userId, name));
  if (taken) throw new HttpError(409, "You already have a folder with that name", "folder_exists");
  const [row] = await db()
    .insert(schema.mailFolders)
    .values({ userId, name, hue: input.hue ?? (await nextHue(userId)) })
    .returning();
  // Made with one mailbox picked: there right away, so it's listed under that mailbox. Otherwise (or
  // if the provider says no now) it's made at each provider when mail first goes in.
  const [account] = input.accountId ? await accountsOf(userId, [input.accountId]) : [];
  if (account) {
    await ensureAtProvider(row, account).catch((err) => logWarn(`[${account.id}] creating folder ${row.id} at the provider failed`, err));
  }
  return dto(row);
}

/** Rename (at every provider it's already at) or recolour. */
export async function updateFolder(userId: string, id: string, patch: { name?: string; hue?: number }): Promise<MailFolder> {
  const row = await ownedFolder(userId, id);
  const set: Partial<FolderRow> = {};
  if (patch.hue !== undefined) set.hue = patch.hue;
  if (patch.name !== undefined) {
    const name = cleanName(patch.name);
    if (name.toLowerCase() !== row.name.toLowerCase()) {
      const [taken] = await db().select({ id: schema.mailFolders.id }).from(schema.mailFolders).where(sameName(userId, name));
      if (taken) throw new HttpError(409, "You already have a folder with that name", "folder_exists");
    }
    const refs = { ...row.refs };
    for (const account of await accountsOf(userId, Object.keys(refs))) {
      if (providerFolderName(refs[account.id])) continue;
      try {
        refs[account.id] = await withAdapter(account, async (a) => (a.renameFolder ? a.renameFolder(refs[account.id], name) : refs[account.id]));
      } catch (err) {
        // The folder keeps its old name there; mail in it stays where it is.
        logWarn(`[${account.id}] renaming folder ${row.id} at the provider failed`, err);
      }
    }
    set.name = name;
    set.refs = refs;
  }
  const [updated] = await db().update(schema.mailFolders).set(set).where(eq(schema.mailFolders.id, id)).returning();
  return dto(updated);
}

/** Delete the folder everywhere; what's in it goes to Archive (nothing is deleted). */
export async function deleteFolder(userId: string, id: string) {
  const row = await ownedFolder(userId, id);
  for (const account of await accountsOf(userId, Object.keys(row.refs))) {
    await withAdapter(account, async (a) => a.deleteFolder?.(row.refs[account.id])).catch((err) =>
      logWarn(`[${account.id}] deleting folder ${row.id} at the provider failed`, err),
    );
  }
  // Conversations stay, in Archive (where the providers put them); the next sync confirms it.
  await db().update(schema.threads).set({ folderId: null }).where(eq(schema.threads.folderId, id));
  await db().delete(schema.mailFolders).where(eq(schema.mailFolders.id, id));
}

/**
 * A disconnected mailbox takes its folders along: the ones only it had go (their names are its data,
 * as the privacy policy promises), and the ones other mailboxes share forget where they were there.
 */
export async function forgetMailboxFolders(userId: string, accountId: string) {
  const f = schema.mailFolders;
  const there = and(eq(f.userId, userId), sql`${f.refs} ? ${accountId}`);
  await db().delete(f).where(and(there, sql`${f.refs} - ${accountId}::text = '{}'::jsonb`));
  await db().update(f).set({ refs: sql`${f.refs} - ${accountId}::text` }).where(there);
}

async function accountsOf(userId: string, ids: string[]) {
  if (!ids.length) return [];
  return db()
    .select()
    .from(schema.accounts)
    .where(and(eq(schema.accounts.userId, userId), inArray(schema.accounts.id, ids)));
}

/** Where this folder is at that mailbox's provider, making it there first if needed. */
export async function ensureAtProvider(row: FolderRow, account: AccountRow): Promise<string> {
  const existing = row.refs[account.id];
  if (existing) return existing;
  const created = await withAdapter(account, (a) => {
    if (!a.createFolder) throw new HttpError(409, "This mailbox doesn't support folders", "unsupported");
    return a.createFolder(row.name);
  });
  await db()
    .update(schema.mailFolders)
    .set({ refs: sql`${schema.mailFolders.refs} || ${JSON.stringify({ [account.id]: created.ref })}::jsonb` })
    .where(eq(schema.mailFolders.id, row.id));
  if (created.state) {
    // A brand-new IMAP folder: sync it from its very first message, so mail moved in shows up whole
    // (a folder seen for the first time is otherwise imported from the last month only).
    await db()
      .update(schema.accounts)
      .set({
        syncState: sql`jsonb_set(${schema.accounts.syncState}, '{folders}', coalesce(${schema.accounts.syncState}->'folders', '{}'::jsonb) || ${JSON.stringify({ [created.ref]: { uidValidity: created.state.uidValidity, uidNext: created.state.uidNext } })}::jsonb)`,
      })
      .where(eq(schema.accounts.id, account.id));
  }
  row.refs = { ...row.refs, [account.id]: created.ref };
  return created.ref;
}

export async function folderRow(userId: string, id: string) {
  return ownedFolder(userId, id);
}

/** Every own folder's ref at this mailbox, mapped to the folder (for Gmail labels and IMAP paths alike). */
export async function folderRefs(accountId: string): Promise<Map<string, string>> {
  const rows = await db()
    .select({ id: schema.mailFolders.id, ref: sql<string>`${schema.mailFolders.refs}->>${accountId}` })
    .from(schema.mailFolders)
    .where(sql`${schema.mailFolders.refs} ? ${accountId}`);
  return new Map(rows.map((r) => [r.ref, r.id]));
}

/**
 * What a provider has, matched with the app's folders: a known ref stays, one with the same name
 * links up, anything new becomes a folder. A ref the provider no longer lists is unlinked from that
 * mailbox; the folder itself stays (it may be mid-creation elsewhere, and the user may still want it).
 * Returns the refs newly linked at this mailbox and the folders unlinked from it, so mail already
 * here can move in or out (src/server/sync/sink.ts).
 */
export async function syncOwnFolders(account: { id: string; userId: string }, found: ProviderFolder[]) {
  const rows = await db().select().from(schema.mailFolders).where(eq(schema.mailFolders.userId, account.userId));
  const listed = new Set(found.map((f) => f.ref));
  const linked: string[] = [];
  const unlinked: string[] = [];
  for (const row of rows) {
    const ref = row.refs[account.id];
    if (ref && !listed.has(ref)) {
      const refs = { ...row.refs };
      delete refs[account.id];
      await db().update(schema.mailFolders).set({ refs }).where(eq(schema.mailFolders.id, row.id));
      row.refs = refs;
      unlinked.push(row.id);
    }
  }
  const pretty = async (f: ProviderFolder) => {
    const name = providerFolderName(f.ref);
    return name ? translate(await userLocale(account.userId), name) : f.name;
  };
  for (const f of found) {
    const known = rows.find((r) => r.refs[account.id] === f.ref);
    if (known) {
      // Still under the provider's own name (taken over before folders like this got a readable one).
      const name = known.name === f.name ? await pretty(f) : known.name;
      if (name !== known.name) {
        await db()
          .update(schema.mailFolders)
          .set({ name })
          .where(eq(schema.mailFolders.id, known.id))
          .catch(() => {});
      }
      continue;
    }
    linked.push(f.ref);
    const display = await pretty(f);
    const named = rows.find((r) => [f.name.toLowerCase(), display.toLowerCase()].includes(r.name.toLowerCase()) && !r.refs[account.id]);
    if (named) {
      named.refs = { ...named.refs, [account.id]: f.ref };
      await db().update(schema.mailFolders).set({ refs: named.refs }).where(eq(schema.mailFolders.id, named.id));
      continue;
    }
    const name = display.slice(0, MAX_FOLDER_NAME);
    // Two syncs at once may race to add the same name: the unique index lets one win, the other links.
    const [row] = await db()
      .insert(schema.mailFolders)
      .values({ userId: account.userId, name, hue: await nextHue(account.userId), refs: { [account.id]: f.ref } })
      .onConflictDoNothing()
      .returning();
    if (row) rows.push(row);
  }
  return { linked, unlinked };
}

/** The own folder a conversation is in: where its newest live message sits (IMAP path or Gmail label). */
export function ownFolderOf(messages: { imapPath: string | null; labels: string[] }[], refs: Map<string, string>): string | null {
  if (!refs.size) return null;
  for (const m of [...messages].reverse()) {
    const byPath = m.imapPath ? refs.get(m.imapPath) : undefined;
    if (byPath) return byPath;
    for (const label of m.labels) {
      const byLabel = refs.get(label);
      if (byLabel) return byLabel;
    }
  }
  return null;
}
