import { and, asc, desc, eq, gt, gte, inArray, isNull, lt, lte, or, sql, type SQL } from "drizzle-orm";
import { parseSearch, type ParsedSearch } from "@/lib/search";
import { nameHidesAddress } from "@/lib/phishing";
import { CATEGORY_VIEWS, mergeInsights } from "@/lib/insights";
import type { Draft, ForwardedFiles, Insight, Message, NotifyMode, Thread } from "@/lib/types";
import { HttpError } from "../http-error";
import { ACCOUNT_COLUMNS, columnsWithout, db, schema } from "../db";
import type { FolderRole, Person, ThreadFolder } from "../db/schema";
import { env } from "../env";
import { roleOf, withRole } from "../sync/sink";
import { revokeProviderAccess } from "./accounts";
import { withAdapter, type AccountRow } from "./adapters";
import { accountDto, draftDto, messageDto, threadDto } from "./dto";
import { cleanSignatureHtml, toEmail } from "./email-html";
import { asksQuestion, isPersonAddress, LOOK_BACK_DAYS, WAIT_WORKING_DAYS, workingDaysAgo } from "./unanswered";
import { sanitizeIncoming } from "./sanitize";
import { wordForms } from "./word-forms";
import { recordTrackerBlocks } from "../stats";
import type { ThreadPatchInput } from "../api/schemas";
import type { MessageRef } from "./types";
import { logWarn } from "../log";
import { limit, LIMITS } from "../rate-limit";
import { addFiles, attachmentsByDraft, backToDraft, draftAttachmentBytes, MAX_ATTACHMENTS_BYTES, moveToOutbox, previewUrl } from "./outgoing-attachments";
import { ensureAtProvider, folderRefs, folderRow, forgetMailboxFolders } from "./folders";
import { translate } from "@/lib/i18n";
import { userLocale } from "../push";

/**
 * The one place that reads and changes mail on behalf of a user. The REST API, the MCP server and
 * the worker all go through here, so permissions, provider write-through and bookkeeping
 * (follow-ups, tracking, agent drafts) behave the same everywhere.
 *
 * Changes are applied to the cache first and then written through to the provider. If the provider
 * refuses, the cache is rolled back and the caller gets a 502 (the client store reverts its
 * optimistic update and shows a toast).
 */

export type ListFolder =
  | "inbox"
  | "pinned"
  | "snoozed"
  | "scheduled"
  | "sent"
  | "archive"
  | "trash"
  | "spam"
  | "drafts"
  | "orders"
  | "travel"
  | "invoices"
  | "subscriptions"
  | "security"
  | "replies"
  | "screener"
  | "unanswered"
  | `folder:${string}`;

const PROVIDER_NAMES: Record<string, string> = { gmail: "Gmail" };

/* --------------------------------- Helpers --------------------------------- */

async function ownedThread(userId: string, threadId: string) {
  const [t] = await db()
    .select()
    .from(schema.threads)
    .where(and(eq(schema.threads.id, threadId), eq(schema.threads.userId, userId)));
  if (!t) throw new HttpError(404, "Conversation not found", "not_found");
  return t;
}

export async function ownedAccount(userId: string, accountId: string) {
  const [a] = await db()
    .select(ACCOUNT_COLUMNS)
    .from(schema.accounts)
    .where(and(eq(schema.accounts.id, accountId), eq(schema.accounts.userId, userId)));
  if (!a) throw new HttpError(404, "Mailbox not found", "not_found");
  return a;
}

function providerName(a: AccountRow) {
  return PROVIDER_NAMES[a.provider] ?? (a.providerLabel || a.email.split("@")[1]);
}

/** A conversation's messages with their bodies (reading, replying), never the search vector. */
async function threadMessages(threadId: string) {
  return db().select(MESSAGE_COLUMNS).from(schema.messages).where(eq(schema.messages.threadId, threadId)).orderBy(asc(schema.messages.date));
}

/** A conversation's messages without bodies: all it takes to change flags, labels and folders. */
async function threadMessageMeta(threadId: string) {
  return db().select(MESSAGE_META_COLUMNS).from(schema.messages).where(eq(schema.messages.threadId, threadId)).orderBy(asc(schema.messages.date));
}

const MESSAGE_COLUMNS = columnsWithout(schema.messages, "search");
const MESSAGE_META_COLUMNS = columnsWithout(schema.messages, "search", "bodyHtml", "bodyText");

const refOf = (m: Pick<MessageRow, "providerMessageId" | "imapPath" | "imapUid">): MessageRef => ({
  providerMessageId: m.providerMessageId,
  imapPath: m.imapPath,
  imapUid: m.imapUid,
});

/** Run a provider write; on failure restore the cache via `rollback` and surface a friendly 502. */
async function writeThrough(account: AccountRow, op: () => Promise<void>, rollback: () => Promise<void>) {
  try {
    await op();
  } catch (err) {
    await rollback();
    logWarn(`[${account.id}] provider write failed`, err);
    throw new HttpError(502, "Couldn't reach {provider}. Try again in a moment.", "provider_error", { provider: providerName(account) });
  }
}

/* --------------------------------- Accounts -------------------------------- */

export async function listAccounts(userId: string) {
  const rows = await db()
    .select()
    .from(schema.accounts)
    .where(eq(schema.accounts.userId, userId))
    .orderBy(asc(schema.accounts.sortOrder), asc(schema.accounts.createdAt));
  const sigs = await db().select().from(schema.signatures).where(eq(schema.signatures.userId, userId));
  return rows.map((a) => {
    const sig = sigs.find((s) => s.accountId === a.id && s.isDefault) ?? sigs.find((s) => s.accountId === a.id);
    return accountDto(a, sig?.html ? cleanSignatureHtml(sig.html) : "");
  });
}

export async function updateAccount(
  userId: string,
  accountId: string,
  patch: { name?: string; hue?: number; icon?: string; fromName?: string; mcpEnabled?: boolean; signature?: string; sortOrder?: number; notify?: NotifyMode },
) {
  await ownedAccount(userId, accountId);
  const { signature: rawSignature, ...fields } = patch;
  const signature = rawSignature === undefined ? undefined : cleanSignatureHtml(rawSignature);
  if (Object.keys(fields).length) {
    await db().update(schema.accounts).set(fields).where(eq(schema.accounts.id, accountId));
  }
  if (signature !== undefined) {
    const [existing] = await db()
      .select()
      .from(schema.signatures)
      .where(and(eq(schema.signatures.userId, userId), eq(schema.signatures.accountId, accountId), eq(schema.signatures.isDefault, true)));
    if (existing) await db().update(schema.signatures).set({ html: signature }).where(eq(schema.signatures.id, existing.id));
    else await db().insert(schema.signatures).values({ userId, accountId, html: signature, isDefault: true });
  }
}

const IMAGE_DATA_URL = /^data:(image\/(?:webp|png|jpeg));base64,([A-Za-z0-9+/]+={0,2})$/;
/** The client sends 256 px pictures of a few tens of kB; this only keeps abuse out of the database. */
const MAX_IMAGE_BYTES = 200_000;

export async function setAccountImage(userId: string, accountId: string, dataUrl: string | null) {
  await ownedAccount(userId, accountId);
  if (dataUrl !== null) {
    const m = IMAGE_DATA_URL.exec(dataUrl);
    if (!m) throw new HttpError(400, "Use a PNG, JPEG or WebP picture", "invalid_image");
    if (Buffer.byteLength(m[2], "base64") > MAX_IMAGE_BYTES) throw new HttpError(413, "That picture is too big", "image_too_big");
  }
  await db().update(schema.accounts).set({ image: dataUrl }).where(eq(schema.accounts.id, accountId));
}

export async function getAccountImage(userId: string, accountId: string) {
  const [account] = await db()
    .select({ image: schema.accounts.image })
    .from(schema.accounts)
    .where(and(eq(schema.accounts.id, accountId), eq(schema.accounts.userId, userId)));
  if (!account) throw new HttpError(404, "Mailbox not found", "not_found");
  const m = account.image ? IMAGE_DATA_URL.exec(account.image) : null;
  if (!m) throw new HttpError(404, "No picture", "not_found");
  return { mime: m[1], bytes: Buffer.from(m[2], "base64") };
}

/** Disconnect: our copy goes right away, then the access at the provider (see revokeProviderAccess). */
export async function removeAccount(userId: string, accountId: string) {
  const row = await ownedAccount(userId, accountId);
  // AI activity and My history keep subjects and draft text for Undo; they go with the mailbox, as the
  // privacy policy promises. A run whose every step was in this mailbox goes too (its title is the agent's words).
  await db().execute(sql`
    delete from ${schema.agentSessions} s where s.user_id = ${userId}
      and s.id in (select e.session_id from ${schema.agentEvents} e where e.user_id = ${userId} and e.account_id = ${accountId})
      and not exists (select 1 from ${schema.agentEvents} e where e.session_id = s.id and e.account_id is distinct from ${accountId})`);
  await db().delete(schema.agentEvents).where(and(eq(schema.agentEvents.userId, userId), eq(schema.agentEvents.accountId, accountId)));
  await db().execute(sql`
    delete from ${schema.history} where ${schema.history.userId} = ${userId}
      and ${schema.history.threadIds} ?| array(select id from ${schema.threads} where account_id = ${accountId})`);
  await forgetMailboxFolders(userId, accountId);
  await db().delete(schema.accounts).where(eq(schema.accounts.id, accountId));
  await revokeProviderAccess(row);
}

/* --------------------------------- Reading --------------------------------- */

export interface ListOptions {
  /** "all" or an account id. */
  scope?: string;
  folder?: ListFolder;
  query?: string;
  unreadOnly?: boolean;
  limit?: number;
  /** Opaque cursor from the previous page. */
  cursor?: string;
  /** Restrict to these accounts (MCP: only mailboxes exposed to agents). */
  accountIds?: string[];
}

const likeAny = (v: string) => `%${v.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/** What a search (src/lib/search.ts) asks of a conversation, as conditions on `threads`. */
function searchConditions(userId: string, p: ParsedSearch) {
  const t = schema.threads;
  const out = [];
  const tsq = toTsQuery(p.text);
  // The matching messages come from the full-text index first; checking every conversation in the
  // folder one by one would read the search vector of each of its messages.
  // Without diacritics, like the index (schema.ts).
  if (tsq) out.push(sql`${t.id} in (select m.thread_id from ${schema.messages} m where m.user_id = ${userId} and m.search @@ to_tsquery('simple', immutable_unaccent(${tsq})))`);
  for (const v of p.from) {
    out.push(sql`exists (select 1 from ${schema.messages} m where m.thread_id = ${t.id} and (m."from"->>'email' ilike ${likeAny(v)} or m."from"->>'name' ilike ${likeAny(v)}))`);
  }
  for (const v of p.to) {
    out.push(
      sql`exists (select 1 from ${schema.messages} m, jsonb_array_elements(m."to" || m.cc) p where m.thread_id = ${t.id} and (p->>'email' ilike ${likeAny(v)} or p->>'name' ilike ${likeAny(v)}))`,
    );
  }
  for (const v of p.subject) out.push(sql`${t.subject} ilike ${likeAny(v)}`);
  if (p.hasAttachment) out.push(eq(t.hasAttachments, true));
  if (p.unread) out.push(eq(t.unread, true));
  if (p.pinned) out.push(eq(t.pinned, true));
  if (p.before) out.push(lt(t.lastMessageAt, p.before));
  if (p.after) out.push(gte(t.lastMessageAt, p.after));
  return out;
}

/**
 * Prefix search over the full-text index: "fakt led" → fakt:* & led:*. An address or a link comes
 * apart into its words, as it does in the index: "info@nasereality.test" → info:* & naserealit:* & (test:* | teset:*)
 * A Czech word finds its other forms too (word-forms.ts): "kšiltovka" → (ksiltovk:* | ksiltovce:* | ksiltovci:* | ksiltovek:*)
 */
export function toTsQuery(query: string) {
  const terms = query
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 0)
    .slice(0, 8);
  // A one-letter prefix matches nearly every email, so it narrows nothing: left out next to longer words.
  const long = terms.filter((t) => t.length > 1);
  const used = long.length ? long : terms;
  const any = (forms: string[]) => (forms.length > 1 ? `(${forms.map((f) => `${f}:*`).join(" | ")})` : `${forms[0]}:*`);
  return used.length ? used.map((t) => any(wordForms(t))).join(" & ") : null;
}

export async function listThreads(userId: string, opts: ListOptions = {}): Promise<{ threads: Thread[]; nextCursor: string | null }> {
  const limit = Math.min(Math.max(Math.floor(opts.limit ?? 60) || 60, 1), 200);
  const folder = opts.folder ?? "inbox";
  if (folder === "scheduled") return { threads: await listScheduled(userId, opts), nextCursor: null };
  if (folder === "unanswered") return { threads: await listUnanswered(userId, opts), nextCursor: null };
  if (folder === "drafts") return { threads: [], nextCursor: null };

  const t = schema.threads;
  const now = new Date();
  const where: SQL[] = [eq(t.userId, userId), gt(t.messageCount, 0)];
  if (opts.scope && opts.scope !== "all") where.push(eq(t.accountId, opts.scope));
  if (opts.accountIds) where.push(inArray(t.accountId, opts.accountIds.length ? opts.accountIds : ["-"]));
  if (opts.unreadOnly) where.push(eq(t.unread, true));

  const notSnoozed = or(isNull(t.snoozedUntil), lte(t.snoozedUntil, now))!;
  const search = opts.query ? parseSearch(opts.query) : null;
  if (search) where.push(...searchConditions(userId, search));
  const cursor = opts.cursor ? Number(opts.cursor) : NaN;
  const before = Number.isFinite(cursor) && folder !== "snoozed" ? new Date(cursor) : null;
  if (folder === "inbox" && !search?.everywhere) return listInbox(where, limit, now, before);

  // Conditions that pick a partial index are written out (not bound), so the planner always sees them.
  // "in:all": every folder a conversation can live in, Trash and Spam aside.
  if (search?.everywhere) where.push(inArray(t.folder, ["inbox", "archive", "sent"]), eq(t.screening, false));
  else switch (folder) {
    case "screener":
      where.push(sql`${t.screening}`, eq(t.folder, "inbox"));
      break;
    case "pinned":
      where.push(sql`${t.pinned}`, inArray(t.folder, ["inbox", "archive"]));
      break;
    case "snoozed":
      where.push(gt(t.snoozedUntil, now));
      break;
    case "sent":
      // Every conversation the user wrote in, like Gmail's Sent: a reply in one that's in Inbox or Archive too.
      where.push(sql`${t.lastSentAt} is not null`, inArray(t.folder, ["inbox", "archive", "sent"]));
      break;
    case "archive":
      // Filed mail lives in its own folder, not in Archive.
      where.push(eq(t.folder, "archive"), isNull(t.folderId));
      break;
    case "trash":
    case "spam":
      where.push(eq(t.folder, folder));
      break;
    case "orders":
    case "travel":
    case "invoices":
    case "subscriptions":
    case "security":
    case "replies":
      // Smart categories span Inbox, Archive and Sent; deleted and spam mail stays out.
      // Starting from the user's few cards, not from every conversation they have.
      where.push(
        inArray(t.folder, ["inbox", "archive", "sent"]),
        sql`${t.id} in (select i.thread_id from ${schema.insights} i where i.user_id = ${userId} and i.category = ${CATEGORY_VIEWS[folder]} and i.dismissed_at is null)`,
      );
      break;
    default:
      // One of the user's own folders (a snoozed conversation waits, then comes back here).
      where.push(eq(t.folderId, folder.slice("folder:".length)), inArray(t.folder, ["inbox", "archive", "sent"]), notSnoozed);
      break;
  }

  // Own folders: a conversation back from snooze sorts as if it had just arrived.
  // Sent: by when the user wrote, not by a reply that came after.
  const bySent = folder === "sent" && !search?.everywhere;
  const sortAt = isOwnFolder(folder) ? sql<Date>`greatest(${t.lastMessageAt}, ${t.wokeAt})` : bySent ? t.lastSentAt : t.lastMessageAt;
  const order = folder === "snoozed" ? asc(t.snoozedUntil) : desc(sortAt);
  if (before) where.push(isOwnFolder(folder) ? sql`${sortAt} < ${before.toISOString()}::timestamptz` : lt(bySent ? t.lastSentAt : t.lastMessageAt, before));

  const rows = await db()
    .select()
    .from(t)
    .where(and(...where))
    .orderBy(order)
    .limit(limit + 1);
  // "in:all" typed in Sent pages like any other search.
  return listPage(rows, limit, folder === "sent" && !bySent ? "archive" : folder, now);
}

/**
 * Inbox, as two lists each read from its own index and then merged: conversations in Inbox by when
 * they last moved (a reply, or back from snooze; threads_inbox_sort_idx), and the few whose "remind me
 * if nobody replies" came due, which come back from wherever they are and sort by that moment.
 * Muted conversations never show here: the worker archives their new replies (src/server/mail/mute.ts);
 * the screener's waiting room isn't Inbox either.
 */
async function listInbox(where: SQL[], limit: number, now: Date, before: Date | null) {
  const t = schema.threads;
  const moved = sql<Date>`greatest(${t.lastMessageAt}, ${t.wokeAt})`;
  const [due, inbox] = await Promise.all([
    db()
      .select()
      .from(t)
      .where(and(...where, lte(t.followUpAt, now), eq(t.screening, false), isNull(t.mutedAt))),
    db()
      .select()
      .from(t)
      .where(
        and(
          ...where,
          sql`${t.folder} = 'inbox' and not ${t.screening} and ${t.mutedAt} is null and ${t.messageCount} > 0`,
          or(isNull(t.snoozedUntil), lte(t.snoozedUntil, now)),
          // Due reminders are the other list, with their own sort time.
          or(isNull(t.followUpAt), gt(t.followUpAt, now)),
          before ? sql`${moved} < ${before.toISOString()}::timestamptz` : undefined,
        ),
      )
      .orderBy(desc(moved))
      .limit(limit + 1),
  ]);
  const sortTime = (row: typeof t.$inferSelect) => listSortTime(row, "inbox", now);
  const rows = [...due.filter((row) => !before || sortTime(row) < before.getTime()), ...inbox].sort((a, b) => sortTime(b) - sortTime(a));
  return listPage(rows, limit, "inbox", now);
}

async function listPage(rows: (typeof schema.threads.$inferSelect)[], limit: number, folder: ListFolder, now: Date) {
  const page = rows.slice(0, limit);
  const threads = await withSummaries(page);
  const nextCursor = rows.length > limit && folder !== "snoozed" ? String(listSortTime(page[page.length - 1], folder, now)) : null;
  return { threads, nextCursor };
}

const isOwnFolder = (folder: ListFolder) => folder.startsWith("folder:");

function listSortTime(row: typeof schema.threads.$inferSelect, folder: ListFolder, now: Date) {
  if (folder === "sent" && row.lastSentAt) return row.lastSentAt.getTime();
  const at = row.lastMessageAt.getTime();
  if (isOwnFolder(folder)) return Math.max(at, row.wokeAt?.getTime() ?? 0);
  if (folder !== "inbox") return at;
  const due = row.followUpAt && row.followUpAt <= now ? row.followUpAt.getTime() : 0;
  return Math.max(at, row.wokeAt?.getTime() ?? 0, due);
}

/** Attach light messages (no bodies) so the list can show sender, preview and attachments. */
async function withSummaries(rows: (typeof schema.threads.$inferSelect)[]): Promise<Thread[]> {
  if (!rows.length) return [];
  const m = schema.messages;
  // Only what a list row shows (messageDto): References alone can be kilobytes in a long conversation.
  const msgs = await db()
    .select({
      id: m.id,
      threadId: m.threadId,
      messageIdHeader: m.messageIdHeader,
      from: m.from,
      to: m.to,
      cc: m.cc,
      date: m.date,
      snippet: m.snippet,
      attachments: m.attachments,
      invite: m.invite,
      labels: m.labels,
      isOutgoing: m.isOutgoing,
      trackingId: m.trackingId,
    })
    .from(m)
    .where(
      inArray(
        m.threadId,
        rows.map((r) => r.id),
      ),
    )
    .orderBy(asc(m.date));
  const people = await addressBook(rows[0].userId, msgs);
  const byThread = new Map<string, Message[]>();
  const seen = new Set<string>();
  const binned = new Set(rows.filter((r) => isBin(r.folder)).map((r) => r.id));
  for (const row of msgs) {
    if (!visibleRole(roleOf(row), binned.has(row.threadId))) continue;
    // The same message can sit in two IMAP folders (e.g. sent to yourself) — show it once.
    const key = `${row.threadId}|${row.messageIdHeader ?? row.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const list = byThread.get(row.threadId) ?? [];
    list.push(withNames(messageDto(row), people));
    byThread.set(row.threadId, list);
  }
  const opens = await openSummaries(msgs.map((x) => x.trackingId).filter((x): x is string => !!x));
  const insights = await threadInsights(rows.map((r) => r.id));
  const warm = new Set(msgs.filter((x) => isWarm(x, people)).map((x) => x.threadId));
  return rows.map((r) =>
    threadDto(
      r,
      (byThread.get(r.id) ?? []).map((msg) => withOpens(msg, msgs.find((x) => x.id === msg.id)?.trackingId, opens)),
      insights.get(r.id),
      warm.has(r.id),
    ),
  );
}

/**
 * The people in these messages who are in the user's address book (people they've written to, and
 * those they added), with the name each address goes by. Only these, not the whole book every time.
 */
async function addressBook(userId: string, msgs: { from: Person; to: Person[]; cc: Person[] }[]): Promise<Map<string, string>> {
  const emails = [...new Set(msgs.flatMap((m) => [m.from, ...m.to, ...m.cc]).map((p) => p.email.toLowerCase()))].filter(Boolean);
  if (!emails.length) return new Map();
  const c = schema.contacts;
  // Address book emails are stored lowercase (src/server/contacts.ts), which `?|` (contacts_emails_gin) relies on.
  const rows = await db()
    .select({ emails: c.emails, name: c.name })
    .from(c)
    .where(
      and(
        eq(c.userId, userId),
        eq(c.hidden, false),
        sql`${c.emails} ?| array[${sql.join(
          emails.map((e) => sql`${e}`),
          sql`, `,
        )}]::text[]`,
      ),
    );
  return new Map(rows.flatMap((r) => r.emails.map((e) => [e.toLowerCase(), r.name] as const)));
}

/** Mail sent to a bare address carries no name: the address book's name for it, if it has one. */
function named(p: Person, people: Map<string, string>): Person {
  if (p.name.trim() || !p.email) return p;
  const name = people.get(p.email.toLowerCase());
  return name ? { ...p, name } : p;
}

function withNames(msg: Message, people: Map<string, string>): Message {
  msg.from = named(msg.from, people);
  msg.to = msg.to.map((p) => named(p, people));
  if (msg.cc) msg.cc = msg.cc.map((p) => named(p, people));
  return msg;
}

/** A warm letter (the ace of hearts in Čapek's postman tale): written to us by someone we write to. */
const isWarm = (m: { isOutgoing: boolean; from: Person }, people: Map<string, string>) => !m.isOutgoing && !!m.from.email && people.has(m.from.email.toLowerCase());

/** Smart categories: each conversation's emails about an order (trip…) merged into one picture. */
async function threadInsights(threadIds: string[]): Promise<Map<string, Insight>> {
  const out = new Map<string, Insight>();
  if (!threadIds.length) return out;
  // A card the user hid ("doesn't belong here") is kept for the record but never shown.
  const rows = await db()
    .select()
    .from(schema.insights)
    .where(and(inArray(schema.insights.threadId, threadIds), isNull(schema.insights.dismissedAt)));
  const byThread = new Map<string, Insight[]>();
  for (const r of rows) {
    const insight: Insight = { ...r.data, category: r.category, key: r.groupKey, at: r.at.getTime(), doneAt: r.doneAt?.getTime() ?? null };
    byThread.set(r.threadId, [...(byThread.get(r.threadId) ?? []), insight]);
  }
  for (const [id, list] of byThread) {
    // A conversation about one order shares its key; if it mixes things, the latest one speaks for it.
    const latest = list.reduce((a, b) => (b.at > a.at ? b : a));
    const merged = mergeInsights(list.filter((i) => i.key === latest.key));
    if (merged) out.set(id, merged);
  }
  return out;
}

const isBin = (folder: string | null) => folder === "trash" || folder === "spam";

/**
 * Messages a conversation shows. Trash and Spam copies stay hidden while the conversation lives on
 * elsewhere; a conversation that's all in Trash or Spam (its folder says so) shows them.
 */
const visibleRole = (role: FolderRole | null, binned = false) =>
  role !== "drafts" && (binned || (role !== "trash" && role !== "spam"));

type OpenMap = Record<string, { at: number; client: string; viaApple: boolean }[]>;

async function openSummaries(trackingIds: string[]): Promise<OpenMap> {
  if (!trackingIds.length) return {};
  const rows = await db()
    .select()
    .from(schema.openEvents)
    .where(inArray(schema.openEvents.trackedId, trackingIds))
    .orderBy(asc(schema.openEvents.at));
  const map: OpenMap = {};
  for (const r of rows) (map[r.trackedId] ??= []).push({ at: r.at.getTime(), client: r.client, viaApple: r.viaApple });
  return map;
}

function withOpens(msg: Message, trackingId: string | null | undefined, opens: OpenMap): Message {
  if (!trackingId) return msg;
  return { ...msg, tracked: true, opens: opens[trackingId] ?? [] };
}

async function listScheduled(userId: string, opts: ListOptions): Promise<Thread[]> {
  const o = schema.outbox;
  const where = [eq(o.userId, userId), eq(o.scheduled, true), inArray(o.status, ["pending", "failed"])];
  if (opts.scope && opts.scope !== "all") where.push(eq(o.accountId, opts.scope));
  const rows = await db().select().from(o).where(and(...where)).orderBy(asc(o.sendAt));
  const accounts = await db().select().from(schema.accounts).where(eq(schema.accounts.userId, userId));
  return rows.map((r) => {
    const account = accounts.find((a) => a.id === r.accountId);
    return {
      id: r.id,
      outboxId: r.id,
      accountId: r.accountId,
      subject: r.subject || "(no subject)",
      unread: false,
      pinned: false,
      folder: "scheduled",
      scheduledAt: r.sendAt.getTime(),
      kind: "person",
      messages: [
        {
          id: r.id,
          from: { name: account?.fromName || account?.name || "", email: account?.email ?? "" },
          to: r.to,
          cc: r.cc.length ? r.cc : undefined,
          date: r.sendAt.getTime(),
          html: r.html,
          bodyLoaded: true,
          snippet: r.text.slice(0, 200),
          tracked: r.track || undefined,
        },
      ],
    } satisfies Thread;
  });
}

/** No reply yet (src/server/mail/unanswered.ts): the user's emails that nobody answered. */
async function listUnanswered(userId: string, opts: ListOptions): Promise<Thread[]> {
  const t = schema.threads;
  const now = new Date();
  const where = [
    eq(t.userId, userId),
    gt(t.messageCount, 0),
    inArray(t.folder, ["inbox", "archive", "sent"]),
    eq(t.screening, false),
    isNull(t.mutedAt),
    sql`${t.kind} <> 'newsletter'`,
    lte(t.lastMessageAt, workingDaysAgo(WAIT_WORKING_DAYS, now)),
    gt(t.lastMessageAt, new Date(now.getTime() - LOOK_BACK_DAYS * 86_400_000)),
    or(isNull(t.noReplyDismissedAt), lt(t.noReplyDismissedAt, t.lastMessageAt))!,
    // The newest message (Trash, Spam and drafts aside) is the user's own.
    sql`(select m.is_outgoing from ${schema.messages} m where m.thread_id = ${t.id} and not (m.labels ?| array['role:trash','role:spam','role:drafts']) order by m.date desc limit 1) is true`,
  ];
  if (opts.scope && opts.scope !== "all") where.push(eq(t.accountId, opts.scope));
  if (opts.accountIds) where.push(inArray(t.accountId, opts.accountIds.length ? opts.accountIds : ["-"]));
  if (opts.query) where.push(...searchConditions(userId, parseSearch(opts.query)));
  const rows = await db()
    .select()
    .from(t)
    .where(and(...where))
    .orderBy(desc(t.lastMessageAt))
    .limit(200);
  if (!rows.length) return [];
  const mine = new Set((await db().select({ email: schema.accounts.email }).from(schema.accounts).where(eq(schema.accounts.userId, userId))).map((a) => a.email.toLowerCase()));
  const m = schema.messages;
  const msgs = await db()
    .select({ id: m.id, threadId: m.threadId, isOutgoing: m.isOutgoing, to: m.to, cc: m.cc, snippet: m.snippet, labels: m.labels, date: m.date })
    .from(m)
    .where(inArray(m.threadId, rows.map((r) => r.id)))
    .orderBy(asc(m.date));
  const candidates = rows.flatMap((r) => {
    const list = msgs.filter((x) => x.threadId === r.id && visibleRole(roleOf(x)));
    const last = list[list.length - 1];
    if (!last?.isOutgoing) return [];
    const people = [...last.to, ...last.cc].filter((p) => !mine.has(p.email.toLowerCase()) && isPersonAddress(p.email));
    return people.length ? [{ thread: r, last, started: list[0].isOutgoing }] : [];
  });
  // Only the user's last emails in conversations someone else started need their text: does it ask anything?
  const asking = candidates.filter((c) => !c.started).map((c) => c.last.id);
  const bodies = new Map(
    asking.length ? (await db().select({ id: m.id, text: m.bodyText }).from(m).where(inArray(m.id, asking))).map((b) => [b.id, b.text]) : [],
  );
  const waiting = candidates.filter((c) => c.started || asksQuestion(bodies.get(c.last.id) ?? c.last.snippet)).map((c) => c.thread);
  return (await withSummaries(waiting)).map((th) => ({ ...th, awaiting: true }));
}

/**
 * Full conversation with sanitised bodies. Bodies the sync didn't prefetch are downloaded from the
 * provider now and cached.
 */
export async function getThread(userId: string, threadId: string, opts: { allowRemoteImages?: boolean } = {}): Promise<Thread> {
  const thread = await ownedThread(userId, threadId);
  const shown = (m: MessageMeta) => visibleRole(roleOf(m), isBin(thread.folder));
  let rows = (await threadMessages(threadId)).filter(shown);
  const missing = rows.filter((m) => m.bodyHtml === null && m.bodyText === null);
  if (missing.length) {
    const account = await ownedAccount(userId, thread.accountId);
    await withAdapter(account, async (adapter) => {
      for (const m of missing) {
        const body = await adapter.fetchBody(refOf(m));
        await db()
          .update(schema.messages)
          .set({
            bodyHtml: body.html,
            bodyText: body.text ?? "",
            attachments: body.attachments.length ? body.attachments : m.attachments,
            ...(body.invite ? { invite: body.invite } : {}),
          })
          .where(eq(schema.messages.id, m.id));
      }
    }).catch((err) => logWarn("body fetch failed", err));
    rows = (await threadMessages(threadId)).filter(shown);
  }

  const [user] = await db().select({ settings: schema.users.settings }).from(schema.users).where(eq(schema.users.id, userId));
  const allowRemote = opts.allowRemoteImages ?? user?.settings.loadRemoteImages ?? false;
  const opens = await openSummaries(rows.map((r) => r.trackingId).filter((x): x is string => !!x));
  const people = await addressBook(userId, rows);
  const seen = new Set<string>();
  const messages: Message[] = [];
  const tracked: string[] = [];
  for (const m of rows) {
    const key = m.messageIdHeader ?? m.id;
    if (seen.has(key)) continue;
    seen.add(key);
    const raw = m.bodyHtml ?? textToHtml(m.bodyText ?? m.snippet);
    const cids = new Map(m.attachments.filter((a) => a.cid).map((a) => [a.cid!, a.id]));
    // Our own mail may load its images. "Own" means it sits in Sent: a From: header with our address can be forged.
    const remote = allowRemote || roleOf(m) === "sent";
    const clean = sanitizeIncoming(raw, {
      allowRemoteImages: remote,
      cidUrl: (cid: string) => {
        const id = cids.get(cid.replace(/^<|>$/g, ""));
        return id ? `/api/attachments/${m.id}/${encodeURIComponent(id)}` : null;
      },
      ownPixelPrefix: `${env.appUrl}/api/t/`,
    });
    const msg = withNames(messageDto(m, { ...clean, remoteImages: remote }), people);
    // Someone never written to shows their whole address; a name with another address in it is flagged.
    if (!m.isOutgoing && m.from.email && !people.has(m.from.email.toLowerCase())) msg.stranger = true;
    if (!m.isOutgoing && nameHidesAddress(m.from)) msg.nameMismatch = true;
    messages.push(withOpens(msg, m.trackingId, opens));
    if ((clean.trackers.length || clean.spyPixels) && roleOf(m) !== "sent") tracked.push(m.id);
  }
  // The postcard's counter of emails that didn't get to see when they were opened.
  await recordTrackerBlocks(userId, tracked).catch((err) => logWarn("tracker count failed", err));
  return threadDto(thread, messages, (await threadInsights([thread.id])).get(thread.id), rows.some((m) => isWarm(m, people)));
}

function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function textToHtml(text: string) {
  const linked = escapeHtml(text).replace(/https?:\/\/[^\s<]+/g, (url) => `<a href="${url}">${url}</a>`);
  return `<div style="white-space:pre-wrap">${linked}</div>`;
}

export async function getAttachment(userId: string, messageId: string, attachmentId: string) {
  const ms = schema.messages;
  const [m] = await db()
    .select({ accountId: ms.accountId, attachments: ms.attachments, providerMessageId: ms.providerMessageId, imapPath: ms.imapPath, imapUid: ms.imapUid })
    .from(schema.messages)
    .where(and(eq(schema.messages.id, messageId), eq(schema.messages.userId, userId)));
  if (!m) throw new HttpError(404, "Attachment not found", "not_found");
  const meta = m.attachments.find((a) => a.id === attachmentId);
  if (!meta) throw new HttpError(404, "Attachment not found", "not_found");
  const account = await ownedAccount(userId, m.accountId);
  const content = await withAdapter(account, (adapter) => adapter.fetchAttachment(refOf(m), attachmentId));
  return { ...content, name: meta.name || content.name, mime: meta.mime || content.mime };
}

/**
 * Forwarding: the forwarded email's files go into the draft, so they go out with it. Pictures in its
 * text come along too (as the draft's own inline images); files that would push the email over the
 * size limit, or that the mail server won't hand over, are reported instead.
 */
export async function forwardAttachments(userId: string, draftId: string, messageId: string): Promise<ForwardedFiles> {
  const ms = schema.messages;
  const [m] = await db()
    .select({ accountId: ms.accountId, attachments: ms.attachments, bodyHtml: ms.bodyHtml, providerMessageId: ms.providerMessageId, imapPath: ms.imapPath, imapUid: ms.imapUid })
    .from(ms)
    .where(and(eq(ms.id, messageId), eq(ms.userId, userId)));
  if (!m) throw new HttpError(404, "Conversation not found", "not_found");
  const [draft] = await db()
    .select({ id: schema.drafts.id })
    .from(schema.drafts)
    .where(and(eq(schema.drafts.id, draftId), eq(schema.drafts.userId, userId)));
  if (!draft) throw new HttpError(404, "Draft not found", "not_found");

  // Files first, then the pictures the text actually shows (signature logos and the like are inline too).
  const wanted = [
    ...m.attachments.filter((a) => !a.inline),
    ...m.attachments.filter((a) => a.inline && a.cid && m.bodyHtml?.includes(a.cid)),
  ];
  const out: ForwardedFiles = { attachments: [], images: {}, failed: [] };
  if (!wanted.length) return out;
  let room = MAX_ATTACHMENTS_BYTES - (await draftAttachmentBytes(userId, draftId));
  const account = await ownedAccount(userId, m.accountId);
  const fetched = await withAdapter(account, async (adapter) => {
    const files: { meta: (typeof wanted)[number]; content: Buffer }[] = [];
    for (const meta of wanted) {
      if (meta.size > room) {
        if (!meta.inline) out.failed.push({ name: meta.name, reason: "too_large" });
        continue;
      }
      try {
        const file = await adapter.fetchAttachment(refOf(m), meta.id);
        if (file.content.length > room) {
          if (!meta.inline) out.failed.push({ name: meta.name, reason: "too_large" });
          continue;
        }
        room -= file.content.length;
        files.push({ meta: { ...meta, name: meta.name || file.name, mime: meta.mime || file.mime }, content: file.content });
      } catch (err) {
        logWarn("forwarded attachment unavailable", err);
        if (!meta.inline) out.failed.push({ name: meta.name, reason: "unavailable" });
      }
    }
    return files;
  });
  const added = await addFiles(
    userId,
    draftId,
    fetched.map((f) => ({ name: f.meta.name, mime: f.meta.mime, content: f.content, inline: f.meta.inline })),
  );
  added.forEach((a, i) => {
    const meta = fetched[i].meta;
    if (a.inline) out.images[`/api/attachments/${messageId}/${encodeURIComponent(meta.id)}`] = previewUrl(draftId, a.id);
  });
  // Inline pictures live in the text, not among the files; what isn't shown in it is dropped when sending.
  out.attachments = added;
  return out;
}

/* --------------------------------- Actions --------------------------------- */

type MessageRow = typeof schema.messages.$inferSelect;
type MessageMeta = Omit<MessageRow, "bodyHtml" | "bodyText" | "search">;
type ThreadRow = typeof schema.threads.$inferSelect;
type Adapter = Parameters<Parameters<typeof withAdapter>[1]>[0];

/**
 * Patch the cache for the picked messages and the thread, then write through to the provider.
 * On failure everything touched is restored from the snapshot taken before.
 */
async function applyToMessages(
  userId: string,
  threadId: string,
  pick: (messages: MessageMeta[], thread: ThreadRow) => MessageMeta[],
  dbPatch: (m: MessageMeta) => Partial<MessageRow>,
  provider: (adapter: Adapter, refs: MessageRef[]) => Promise<void>,
  threadPatch: Partial<typeof schema.threads.$inferSelect>,
  /** An open connection to reuse (bulk changes); otherwise one is opened for this call. */
  adapter?: Adapter,
) {
  const thread = await ownedThread(userId, threadId);
  const account = await ownedAccount(userId, thread.accountId);
  const targets = pick(await threadMessageMeta(threadId), thread);

  if (Object.keys(threadPatch).length) await db().update(schema.threads).set(threadPatch).where(eq(schema.threads.id, threadId));
  for (const m of targets) await db().update(schema.messages).set(dbPatch(m)).where(eq(schema.messages.id, m.id));
  if (!targets.length) return thread;

  await writeThrough(
    account,
    () => (adapter ? provider(adapter, targets.map(refOf)) : withAdapter(account, (a) => provider(a, targets.map(refOf)))),
    async () => {
      const { folder, unread, pinned, snoozedUntil, folderId } = thread;
      await db().update(schema.threads).set({ folder, unread, pinned, snoozedUntil, folderId }).where(eq(schema.threads.id, threadId));
      for (const m of targets) {
        await db().update(schema.messages).set({ unread: m.unread, labels: m.labels }).where(eq(schema.messages.id, m.id));
      }
    },
  );
  return thread;
}

const isFlagged = (m: MessageMeta) => m.labels.includes("\\Flagged") || m.labels.includes("STARRED");
const latestIncoming = (msgs: MessageMeta[]) => [...msgs].reverse().find((m) => !m.isOutgoing) ?? msgs[msgs.length - 1];

export async function setUnread(userId: string, threadId: string, unread: boolean, adapter?: Adapter) {
  return applyToMessages(
    userId,
    threadId,
    // Marking unread flags only the latest incoming message, like Gmail.
    (msgs) => (unread ? [latestIncoming(msgs)].filter(Boolean) : msgs.filter((m) => m.unread)),
    () => ({ unread }),
    (a, refs) => a.setFlags(refs, { unread }),
    { unread },
    adapter,
  );
}

export async function setPinned(userId: string, threadId: string, pinned: boolean, adapter?: Adapter) {
  return applyToMessages(
    userId,
    threadId,
    // Pin = star/flag the latest message (what Gmail's UI does); unpin clears every flagged one.
    (msgs) => (pinned ? [latestIncoming(msgs)].filter(Boolean) : msgs.filter(isFlagged)),
    (m) => ({
      labels: [...m.labels.filter((l) => l !== "\\Flagged" && l !== "STARRED"), ...(pinned ? ["\\Flagged"] : [])],
    }),
    (a, refs) => a.setFlags(refs, { pinned }),
    { pinned },
    adapter,
  );
}

/**
 * Which copies a move takes along, by where the conversation is now. No role = an own IMAP folder
 * (`filed`): leaving it takes those along too.
 */
function movedRoles(from: ThreadFolder, to: "archive" | "inbox" | "trash" | "spam", filed = false): (FolderRole | null)[] {
  // Out of Trash or Spam (restore, "Not spam", Undo of a delete): only what's in there.
  if (isBin(from) && !isBin(to)) return ["trash", "spam"];
  switch (to) {
    case "inbox":
      return ["archive", "trash", "spam", null];
    case "archive":
      return filed ? ["inbox", null] : ["inbox"];
    case "trash":
      // A deleted conversation takes our own replies along, like Gmail.
      return ["inbox", "archive", "sent", "spam", null];
    case "spam":
      return ["inbox", "archive", "trash", null];
  }
}

export async function moveThread(userId: string, threadId: string, to: "archive" | "inbox" | "trash" | "spam", adapter?: Adapter) {
  const before = await applyToMessages(
    userId,
    threadId,
    // Our own sent copies stay in Sent when a conversation goes back to Inbox.
    (msgs, thread) => {
      const from = movedRoles(thread.folder, to, !!thread.folderId);
      return msgs.filter((m) => from.includes(roleOf(m)) && !(to === "inbox" && roleOf(m) === "sent"));
    },
    (m) => ({ labels: withRole(m.labels, to) }),
    (a, refs) => a.move(refs, to),
    // Any move replaces what a snooze would have put back, and takes it out of its own folder.
    { folder: to as ThreadFolder, folderId: null, snoozeMoved: [], ...(to !== "inbox" ? { snoozedUntil: null, followUpAt: null, wokeAt: null } : {}) },
    adapter,
  );
  if (before.folderId) await leaveOwnFolder(userId, before, adapter);
  // IMAP keeps our own mail in Sent: copies coming back out of Trash or Spam go there, not into Inbox.
  // (Gmail is label-based and does the same thing as its own "Move to Inbox".)
  if (isBin(before.folder) && !isBin(to) && (await ownedAccount(userId, before.accountId)).provider === "imap") {
    await applyToMessages(
      userId,
      threadId,
      (msgs) => msgs.filter((m) => m.isOutgoing && roleOf(m) === to),
      (m) => ({ labels: withRole(m.labels, "sent") }),
      (a, refs) => a.move(refs, "sent"),
      {},
      adapter,
    );
  }
  return before;
}

/**
 * Gmail leaves labels on when mail moves to Inbox or Archive, so leaving an own folder takes its label
 * off as well. (IMAP needs nothing more: the messages moved out of that folder.)
 */
async function leaveOwnFolder(userId: string, thread: ThreadRow, adapter?: Adapter) {
  const account = await ownedAccount(userId, thread.accountId);
  if (account.provider !== "gmail") return;
  const refs = await folderRefs(account.id);
  if (!refs.size) return;
  await applyToMessages(
    userId,
    thread.id,
    (msgs) => msgs.filter((m) => m.labels.some((l) => refs.has(l))),
    (m) => ({ labels: m.labels.filter((l) => !refs.has(l)) }),
    (a, r) => (a.leaveFolders ? a.leaveFolders(r, [...refs.keys()]) : Promise.resolve()),
    {},
    adapter,
  );
}

/**
 * File a conversation in one of the user's own folders: out of Inbox (and any other own folder), into
 * that label or IMAP folder, made at the provider first if this mailbox doesn't have it yet. Our own
 * sent copies stay in Sent on IMAP; Gmail labels the whole conversation, like its own "Move to".
 */
export async function moveToOwnFolder(userId: string, threadId: string, folderId: string, adapter?: Adapter) {
  const thread = await ownedThread(userId, threadId);
  const account = await ownedAccount(userId, thread.accountId);
  const ref = await ensureAtProvider(await folderRow(userId, folderId), account);
  const gmail = account.provider === "gmail";
  const others = gmail ? [...(await folderRefs(account.id)).keys()].filter((r) => r !== ref) : [];
  return applyToMessages(
    userId,
    threadId,
    (msgs) => msgs.filter((m) => (gmail ? roleOf(m) !== "drafts" : roleOf(m) !== "sent" && roleOf(m) !== "drafts")),
    (m) =>
      gmail
        ? { labels: withRole([...m.labels.filter((l) => !others.includes(l) && l !== "INBOX" && l !== "TRASH" && l !== "SPAM" && l !== ref), ref], roleOf(m) === "sent" ? "sent" : "archive") }
        : { labels: withRole(m.labels, null) },
    (a, refs) => (a.moveToFolder ? a.moveToFolder(refs, ref, others) : Promise.reject(new Error("This mailbox doesn't support folders"))),
    {
      folderId,
      folder: thread.folder === "sent" ? "sent" : "archive",
      snoozeMoved: [],
      snoozedUntil: null,
      followUpAt: null,
      wokeAt: null,
    },
    adapter,
  );
}

/**
 * Delete for good, from Trash or Spam only. The provider goes first: once it's gone there, there's
 * nothing to roll back to, and our copy follows. All of one mailbox's conversations share one connection.
 */
async function deleteForever(userId: string, accountId: string, threadIds: string[]) {
  const account = await ownedAccount(userId, accountId);
  if (account.provider === "gmail") {
    throw new HttpError(400, "Gmail deletes mail in Trash and Spam for good after 30 days", "gmail_no_delete");
  }
  if (!threadIds.length) return;
  const targets = (await db().select().from(schema.messages).where(inArray(schema.messages.threadId, threadIds))).filter((m) =>
    isBin(roleOf(m)),
  );
  if (targets.length) {
    await writeThrough(
      account,
      () => withAdapter(account, (a) => (a.deleteForever ? a.deleteForever(targets.map(refOf)) : Promise.reject(new Error("unsupported")))),
      async () => {},
    );
    await db().delete(schema.messages).where(inArray(schema.messages.id, targets.map((m) => m.id)));
  }
  // A conversation can keep copies elsewhere (e.g. Sent); only empty ones go.
  await db()
    .delete(schema.threads)
    .where(
      and(
        inArray(schema.threads.id, threadIds),
        sql`not exists (select 1 from ${schema.messages} m where m.thread_id = ${schema.threads.id})`,
      ),
    );
}

export async function deleteThreadForever(userId: string, threadId: string) {
  const thread = await ownedThread(userId, threadId);
  if (!isBin(thread.folder)) throw new HttpError(409, "Only mail in Trash or Spam can be deleted for good", "not_in_bin");
  await deleteForever(userId, thread.accountId, [threadId]);
}

/** Multi-select "Delete forever": per mailbox, one connection. Returns the ids that couldn't go (to put back in the UI). */
export async function deleteThreadsForever(userId: string, threadIds: string[]): Promise<string[]> {
  const rows = await db()
    .select({ id: schema.threads.id, accountId: schema.threads.accountId, folder: schema.threads.folder })
    .from(schema.threads)
    .where(and(eq(schema.threads.userId, userId), inArray(schema.threads.id, threadIds)));
  const inBin = rows.filter((r) => isBin(r.folder));
  const failed = threadIds.filter((id) => !inBin.some((r) => r.id === id));
  for (const accountId of new Set(inBin.map((r) => r.accountId))) {
    const ids = inBin.filter((r) => r.accountId === accountId).map((r) => r.id);
    await deleteForever(userId, accountId, ids).catch(() => failed.push(...ids));
  }
  return failed;
}

/** Empty Trash or Spam of the mailboxes in scope that can delete (not Gmail). Returns how many conversations went. */
export async function emptyBin(userId: string, folder: "trash" | "spam", scope = "all") {
  const t = schema.threads;
  const rows = await db()
    .select({ id: t.id, accountId: t.accountId, provider: schema.accounts.provider })
    .from(t)
    .innerJoin(schema.accounts, eq(schema.accounts.id, t.accountId))
    .where(and(eq(t.userId, userId), eq(t.folder, folder), ...(scope !== "all" ? [eq(t.accountId, scope)] : [])));
  const deletable = rows.filter((r) => r.provider !== "gmail");
  for (const accountId of new Set(deletable.map((r) => r.accountId))) {
    await deleteForever(
      userId,
      accountId,
      deletable.filter((r) => r.accountId === accountId).map((r) => r.id),
    );
  }
  return deletable.length;
}

export const archiveThread = (userId: string, threadId: string) => moveThread(userId, threadId, "archive");

/**
 * Snooze: the conversation leaves Inbox until `until`. At the provider it's archived meanwhile, so it
 * disappears from the inbox in other clients too; the messages it had in Inbox or Archive go back to the
 * provider's Inbox when it wakes (`releaseSnooze`). If the provider can't be reached, the snooze still
 * holds here.
 */
export async function snoozeThread(userId: string, threadId: string, until: Date | null, adapter?: Adapter) {
  const thread = await ownedThread(userId, threadId);
  if (!until) {
    await db().update(schema.threads).set({ snoozedUntil: null }).where(eq(schema.threads.id, threadId));
    await releaseSnooze(userId, threadId, adapter).catch((err) => logWarn(`[${thread.accountId}] unsnooze at the provider failed`, err));
    return;
  }
  const now = new Date();
  // Filed: it's already out of Inbox at the provider, so it just waits in its folder and comes back there.
  if (thread.folderId) {
    await db().update(schema.threads).set({ snoozedUntil: until, wokeAt: null, snoozedAt: now }).where(eq(schema.threads.id, threadId));
  } else {
    const msgs = await threadMessageMeta(threadId);
    const back = msgs.filter((m) => !m.isOutgoing && (roleOf(m) === "inbox" || roleOf(m) === "archive")).flatMap((m) => (m.messageIdHeader ? [m.messageIdHeader] : []));
    await db()
      .update(schema.threads)
      .set({ snoozedUntil: until, folder: "inbox", wokeAt: null, snoozedAt: now, snoozeMoved: [...new Set([...thread.snoozeMoved, ...back])] })
      .where(eq(schema.threads.id, threadId));
    await applyToMessages(
      userId,
      threadId,
      (all) => all.filter((m) => roleOf(m) === "inbox"),
      (m) => ({ labels: withRole(m.labels, "archive") }),
      (a, refs) => a.move(refs, "archive"),
      {},
      adapter,
    ).catch((err) => logWarn(`[${thread.accountId}] snooze at the provider failed`, err));
  }
  await labelSnoozed(userId, threadId, true, adapter).catch((err) => logWarn(`[${thread.accountId}] snooze label failed`, err));
}

/**
 * Gmail: the app's "Snoozed" label on (or off) a conversation, so it's findable as snoozed in Gmail
 * too (Gmail's own snooze isn't in its API). Made in the user's language the first time it's needed.
 */
async function labelSnoozed(userId: string, threadId: string, on: boolean, adapter?: Adapter) {
  const thread = await ownedThread(userId, threadId);
  const account = await ownedAccount(userId, thread.accountId);
  const known = account.syncState.snoozeLabelId;
  if (account.provider !== "gmail" || (!on && !known)) return;
  const msgs = (await threadMessageMeta(threadId)).filter((m) => roleOf(m) !== "drafts");
  if (!msgs.length) return;
  const label = { id: known, name: translate(await userLocale(userId), "Snoozed") };
  const set = (a: Adapter) => (a.labelSnoozed ? a.labelSnoozed(msgs.map(refOf), on, label) : Promise.resolve(undefined));
  const id = await (adapter ? set(adapter) : withAdapter(account, set));
  if (id && id !== known) {
    await db()
      .update(schema.accounts)
      .set({ syncState: sql`${schema.accounts.syncState} || ${JSON.stringify({ snoozeLabelId: id })}::jsonb` })
      .where(eq(schema.accounts.id, account.id));
  }
}

/**
 * A conversation that's no longer snoozed: what snooze archived at the provider goes back to its
 * Inbox, and Gmail's "Snoozed" label comes off.
 */
export async function releaseSnooze(userId: string, threadId: string, adapter?: Adapter) {
  const thread = await ownedThread(userId, threadId);
  if (thread.snoozedUntil && thread.snoozedUntil > new Date()) return;
  if (thread.snoozeMoved.length) {
    const wanted = new Set(thread.snoozeMoved);
    await applyToMessages(
      userId,
      threadId,
      (all) => all.filter((m) => !!m.messageIdHeader && wanted.has(m.messageIdHeader) && roleOf(m) === "archive"),
      (m) => ({ labels: withRole(m.labels, "inbox") }),
      (a, refs) => a.move(refs, "inbox"),
      {},
      adapter,
    );
  }
  if (thread.snoozedAt) await labelSnoozed(userId, threadId, false, adapter);
  await db().update(schema.threads).set({ snoozeMoved: [], snoozedAt: null }).where(eq(schema.threads.id, threadId));
}

export async function setFollowUp(userId: string, threadId: string, at: Date | null) {
  await ownedThread(userId, threadId);
  await db().update(schema.threads).set({ followUpAt: at }).where(eq(schema.threads.id, threadId));
}

/**
 * Mute: the conversation leaves Inbox now (archived and read), and every reply that comes later does
 * the same, without a notification (the worker's `archiveMutedMail`). Unmuting leaves it where it is.
 */
export async function setMuted(userId: string, threadId: string, muted: boolean, adapter?: Adapter) {
  const thread = await ownedThread(userId, threadId);
  // Muted and "notify me of replies" can't both be: the last one asked for wins.
  await db()
    .update(schema.threads)
    .set({ mutedAt: muted ? (thread.mutedAt ?? new Date()) : null, ...(muted ? { watchedAt: null } : {}) })
    .where(eq(schema.threads.id, threadId));
  if (!muted) return;
  if (thread.folder === "inbox" && !thread.screening) await moveThread(userId, threadId, "archive", adapter);
  if (thread.unread) await setUnread(userId, threadId, false, adapter);
}

/** "Notify me of replies": the next replies notify whatever the mailbox's setting and quiet hours (and it's no longer muted). */
export async function setWatched(userId: string, threadId: string, watched: boolean) {
  await ownedThread(userId, threadId);
  await db()
    .update(schema.threads)
    .set(watched ? { watchedAt: new Date(), mutedAt: null } : { watchedAt: null })
    .where(eq(schema.threads.id, threadId));
}

/** "Not waiting": out of No reply yet until the user writes in the conversation again. */
export async function setNoReplyDismissed(userId: string, threadId: string, dismissed: boolean) {
  await ownedThread(userId, threadId);
  await db().update(schema.threads).set({ noReplyDismissedAt: dismissed ? new Date() : null }).where(eq(schema.threads.id, threadId));
}

/** The user's private note on a conversation; empty removes it. Only here, never at the provider. */
export async function setNote(userId: string, threadId: string, note: string) {
  await ownedThread(userId, threadId);
  const text = note.trim().slice(0, NOTE_MAX);
  await db().update(schema.threads).set({ note: text, noteUpdatedAt: text ? new Date() : null }).where(eq(schema.threads.id, threadId));
  return text;
}

export const NOTE_MAX = 2000;

/** Everything a client can change on a conversation, applied in a fixed order. */
export async function applyThreadPatch(userId: string, threadId: string, patch: ThreadPatchInput, adapter?: Adapter) {
  if (patch.muted !== undefined) await setMuted(userId, threadId, patch.muted, adapter);
  // Moved back to Inbox by hand: it's wanted there, so it's no longer muted.
  else if (patch.folder === "inbox") await db().update(schema.threads).set({ mutedAt: null }).where(and(eq(schema.threads.id, threadId), eq(schema.threads.userId, userId)));
  if (patch.noReplyDismissed !== undefined) await setNoReplyDismissed(userId, threadId, patch.noReplyDismissed);
  if (patch.watched !== undefined) await setWatched(userId, threadId, patch.watched);
  if (patch.snoozedUntil !== undefined) await snoozeThread(userId, threadId, patch.snoozedUntil ? new Date(patch.snoozedUntil) : null, adapter);
  if (patch.followUpAt !== undefined) await setFollowUp(userId, threadId, patch.followUpAt ? new Date(patch.followUpAt) : null);
  if (patch.folder) await moveThread(userId, threadId, patch.folder, adapter);
  if (patch.folderId) await moveToOwnFolder(userId, threadId, patch.folderId, adapter);
  if (patch.unread !== undefined) await setUnread(userId, threadId, patch.unread, adapter);
  if (patch.pinned !== undefined) await setPinned(userId, threadId, patch.pinned, adapter);
}

/**
 * The same change for many conversations (multi-select). One provider connection per mailbox and
 * the conversations one after another, so a big selection doesn't open dozens of IMAP sessions.
 * A failure skips only that conversation; the ones that failed are returned for the client to revert.
 */
export async function patchThreads(userId: string, threadIds: string[], patch: ThreadPatchInput): Promise<string[]> {
  const rows = await db()
    .select({ id: schema.threads.id, accountId: schema.threads.accountId })
    .from(schema.threads)
    .where(and(eq(schema.threads.userId, userId), inArray(schema.threads.id, threadIds)));
  const failed = threadIds.filter((id) => !rows.some((r) => r.id === id));
  const touchesProvider = patch.folder !== undefined || patch.folderId !== undefined || patch.unread !== undefined || patch.pinned !== undefined || patch.muted === true;
  for (const accountId of new Set(rows.map((r) => r.accountId))) {
    const group = rows.filter((r) => r.accountId === accountId);
    const done = new Set<string>();
    const run = async (adapter?: Adapter) => {
      for (const { id } of group) {
        await applyThreadPatch(userId, id, patch, adapter).catch(() => failed.push(id));
        done.add(id);
      }
    };
    try {
      if (touchesProvider) await withAdapter(await ownedAccount(userId, accountId), run);
      else await run();
    } catch {
      failed.push(...group.map((g) => g.id).filter((id) => !done.has(id)));
    }
  }
  return failed;
}

/* ---------------------------------- Drafts ---------------------------------- */

export async function listDrafts(userId: string): Promise<Draft[]> {
  const rows = await db().select().from(schema.drafts).where(eq(schema.drafts.userId, userId)).orderBy(desc(schema.drafts.updatedAt));
  const files = await attachmentsByDraft(userId, rows.map((r) => r.id));
  return rows.map((r) => ({ ...draftDto(r), ...(files.has(r.id) ? { attachments: files.get(r.id) } : {}) }));
}

export interface DraftInput {
  id?: string;
  accountId: string;
  threadId?: string | null;
  to?: string;
  cc?: string;
  bcc?: string;
  subject?: string;
  html?: string;
  agentId?: string | null;
}

export async function saveDraft(userId: string, input: DraftInput, opts: { byUser?: boolean } = {}): Promise<Draft> {
  await ownedAccount(userId, input.accountId);
  if (input.threadId) await ownedThread(userId, input.threadId);
  // Once the user changes an agent's draft it's theirs: no agent may rewrite it behind their back.
  let takeOver = false;
  if (opts.byUser && input.id) {
    const [current] = await db()
      .select()
      .from(schema.drafts)
      .where(and(eq(schema.drafts.id, input.id), eq(schema.drafts.userId, userId)));
    takeOver =
      !!current?.agentId &&
      (["to", "cc", "bcc", "subject", "html"] as const).some((k) => input[k] !== undefined && input[k] !== current[k]);
  }
  const fields = {
    accountId: input.accountId,
    threadId: input.threadId ?? null,
    ...(input.to !== undefined ? { to: input.to } : {}),
    ...(input.cc !== undefined ? { cc: input.cc } : {}),
    ...(input.bcc !== undefined ? { bcc: input.bcc } : {}),
    ...(input.subject !== undefined ? { subject: input.subject } : {}),
    ...(input.html !== undefined ? { html: input.html } : {}),
    ...(input.agentId !== undefined ? { agentId: input.agentId } : {}),
    ...(takeOver ? { agentId: null } : {}),
    updatedAt: new Date(),
  };
  if (input.id) {
    const [updated] = await db()
      .update(schema.drafts)
      .set(fields)
      .where(and(eq(schema.drafts.id, input.id), eq(schema.drafts.userId, userId)))
      .returning();
    if (updated) return draftDto(updated);
  }
  const [created] = await db()
    .insert(schema.drafts)
    .values({ ...(input.id ? { id: input.id } : {}), userId, ...fields })
    .onConflictDoNothing()
    .returning();
  // The app's id is someone else's draft (ids are random, so only a deliberate grab gets here).
  if (!created) throw new HttpError(409, "This draft can't be saved. Copy the text into a new email.", "draft_conflict");
  return draftDto(created);
}

export async function deleteDraft(userId: string, draftId: string) {
  const [row] = await db()
    .delete(schema.drafts)
    .where(and(eq(schema.drafts.id, draftId), eq(schema.drafts.userId, userId)))
    .returning();
  if (row) await db().delete(schema.draftAttachments).where(and(eq(schema.draftAttachments.userId, userId), eq(schema.draftAttachments.draftId, draftId)));
  if (row?.providerDraftId) await forgetProviderDraft(row.accountId, row.providerDraftId);
  return row ? draftDto(row) : null;
}

/** The provider's copy of a draft goes too (the worker removes it). */
async function forgetProviderDraft(accountId: string, ref: string) {
  await db().insert(schema.providerCleanups).values({ accountId, kind: "draft", ref });
}

/* ---------------------------------- Sending --------------------------------- */

/** "Petr <petr@x.cz>, jana@y.cz" → people. Invalid entries throw a 400 the composer can show. */
export function parseRecipients(value: string): Person[] {
  const out: Person[] = [];
  for (const part of value.split(/[,;\n]/).map((s) => s.trim()).filter(Boolean)) {
    const m = part.match(/^(?:"?([^"<]*?)"?\s*)?<([^>]+)>$/);
    const email = (m ? m[2] : part).trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, "“{address}” isn't a valid email address", "invalid_recipient", { address: part });
    out.push({ name: m?.[1]?.trim() || "", email });
  }
  return out;
}

/** An agent's email waits at least this long, whatever the user's Undo setting, so it can be cancelled from the notification. */
export const AGENT_SEND_DELAY_MS = 30_000;

export interface SendOptions {
  /** Scheduled send; omitted = send after the undo window. */
  scheduleAt?: Date;
  track?: boolean;
  followUpDays?: number;
  agentId?: string;
}

/**
 * Turn a draft into an outbox entry. Nothing leaves until `sendAt`, so "Undo" (and cancelling a
 * scheduled send) is just flipping the row to cancelled and restoring the draft.
 */
export async function queueSend(userId: string, draftId: string, opts: SendOptions = {}) {
  const [draft] = await db()
    .select()
    .from(schema.drafts)
    .where(and(eq(schema.drafts.id, draftId), eq(schema.drafts.userId, userId)));
  if (!draft) throw new HttpError(404, "Draft not found", "not_found");
  const account = await ownedAccount(userId, draft.accountId);
  const to = parseRecipients(draft.to);
  const cc = parseRecipients(draft.cc);
  const bcc = parseRecipients(draft.bcc);
  if (!to.length && !cc.length && !bcc.length) throw new HttpError(400, "Add at least one recipient", "no_recipients");
  // An agent fooled by an email must not be able to spray mail: a few an hour, and always a delay to cancel in.
  if (opts.agentId) await limit(...LIMITS.agentSend(opts.agentId, userId, to.length + cc.length + bcc.length));

  const [user] = await db().select({ settings: schema.users.settings }).from(schema.users).where(eq(schema.users.id, userId));
  const [sig] = await db()
    .select()
    .from(schema.signatures)
    .where(and(eq(schema.signatures.accountId, account.id), eq(schema.signatures.isDefault, true)));

  let inReplyTo: string | null = null;
  let references: string[] = [];
  let quotedHtml: string | undefined;
  let quoteHeader: string | undefined;
  if (draft.threadId) {
    const msgs = await threadMessages(draft.threadId);
    const parent = [...msgs].reverse().find((m) => m.messageIdHeader);
    if (parent?.messageIdHeader) {
      inReplyTo = parent.messageIdHeader;
      references = [...parent.references, parent.messageIdHeader].slice(-20);
    }
    if (parent) {
      quotedHtml = parent.bodyHtml ?? undefined;
      const when = parent.date.toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
      quoteHeader = `On ${when}, ${parent.from.name ? `${parent.from.name} <${parent.from.email}>` : parent.from.email} wrote:`;
    }
  }

  // The draft's files go with the send; pasted images become cid: references first.
  const outboxId = `out_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
  const bodyHtml = await moveToOutbox(userId, draft.id, outboxId, draft.html);
  const email = toEmail(bodyHtml, { signatureHtml: sig?.html || undefined, quotedHtml, quoteHeader });
  const undoMs = Math.max((user?.settings.undoSendSeconds ?? 6) * 1000, opts.agentId ? AGENT_SEND_DELAY_MS : 0);
  const sendAt = opts.scheduleAt ?? new Date(Date.now() + undoMs);

  const [row] = await db()
    .insert(schema.outbox)
    .values({
      id: outboxId,
      userId,
      accountId: account.id,
      threadId: draft.threadId,
      draftSnapshot: { id: draft.id, to: draft.to, cc: draft.cc, bcc: draft.bcc, subject: draft.subject, html: draft.html, threadId: draft.threadId },
      to,
      cc,
      bcc,
      subject: draft.subject,
      html: email.html,
      text: email.text,
      inReplyTo,
      references,
      track: opts.track ?? false,
      followUpDays: opts.followUpDays ?? null,
      sendAt,
      scheduled: !!opts.scheduleAt,
      agentId: opts.agentId ?? draft.agentId,
    })
    .returning();
  await db().delete(schema.drafts).where(eq(schema.drafts.id, draft.id));
  if (draft.providerDraftId) await forgetProviderDraft(draft.accountId, draft.providerDraftId);
  return row;
}

/** Undo send / cancel a scheduled send. Returns the restored draft, or null if it already went out. */
export async function cancelSend(userId: string, outboxId: string): Promise<Draft | null> {
  const [row] = await db()
    .update(schema.outbox)
    .set({ status: "cancelled" })
    .where(and(eq(schema.outbox.id, outboxId), eq(schema.outbox.userId, userId), inArray(schema.outbox.status, ["pending", "failed"])))
    .returning();
  if (!row) return null;
  const s = row.draftSnapshot;
  const [draft] = await db()
    .insert(schema.drafts)
    .values({
      // Same id as before, so an open composer tab keeps pointing at it.
      ...(s.id ? { id: s.id } : {}),
      userId,
      accountId: row.accountId,
      threadId: s.threadId ?? null,
      to: s.to,
      cc: s.cc,
      bcc: s.bcc,
      subject: s.subject,
      html: s.html,
      agentId: row.agentId,
    })
    .onConflictDoNothing()
    .returning();
  if (!draft) return null;
  await backToDraft(row.id, draft.id);
  const files = await attachmentsByDraft(userId, [draft.id]);
  return { ...draftDto(draft), ...(files.has(draft.id) ? { attachments: files.get(draft.id) } : {}) };
}

export async function reschedule(userId: string, outboxId: string, sendAt: Date) {
  const [row] = await db()
    .update(schema.outbox)
    .set({ sendAt, status: "pending", error: null })
    .where(and(eq(schema.outbox.id, outboxId), eq(schema.outbox.userId, userId), inArray(schema.outbox.status, ["pending", "failed"])))
    .returning();
  if (!row) throw new HttpError(409, "That message has already been sent", "already_sent");
}

export async function outboxStatus(userId: string, outboxId: string) {
  const [row] = await db()
    .select({ status: schema.outbox.status, error: schema.outbox.error, threadId: schema.outbox.threadId, sendAt: schema.outbox.sendAt })
    .from(schema.outbox)
    .where(and(eq(schema.outbox.id, outboxId), eq(schema.outbox.userId, userId)));
  if (!row) throw new HttpError(404, "Not found", "not_found");
  return row;
}

