import { and, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { db, schema } from "../db";
import type { FolderRole, Person, SyncState, ThreadFolder } from "../db/schema";
import { folderRefs, ownFolderOf, syncOwnFolders } from "../mail/folders";
import type { FlagChange, ProviderFolder, RemoteMessage, SyncSink } from "../mail/types";
import { senderStatus, shouldScreen, screenerState, type ScreenerState } from "../mail/screener";
import { FREE_MAIL_DOMAINS } from "@/lib/mail-domains";

type MessageRow = typeof schema.messages.$inferSelect;
type ThreadRow = typeof schema.threads.$inferSelect;

export interface NewMail {
  threadId: string;
  messageId: string;
  from: Person;
  subject: string;
  snippet: string;
}


/** Addresses only machines send from. */
const MACHINE_SENDER = /^(no-?reply|do-?not-?reply|notifications?|alerts?|mailer-daemon|postmaster)[@+.-]/i;
/**
 * A shop's or a company's shared address: its automatic mail comes from there, and so do its people's
 * answers (from a helpdesk, or the owner writing back): a shop owner's note from info@ about a
 * delayed order folded away among the notifications.
 */
const SHARED_SENDER = /^(info|support|team|hello)[@+.-]/i;

/**
 * What a new conversation is, from its first email: the user's own or a person's, a newsletter, or
 * automatic mail. From a shared address it's a person's when it answers something (In-Reply-To or
 * References), which automatic mail doesn't do. The sender's name tells nothing: marketing signs as
 * "Jana from Acme" too.
 */
export function threadKind(m: Pick<RemoteMessage, "bulk" | "from" | "inReplyTo" | "references">, outgoing: boolean): ThreadRow["kind"] {
  if (outgoing) return "person";
  if (m.bulk) return "newsletter";
  if (MACHINE_SENDER.test(m.from.email)) return "notification";
  if (SHARED_SENDER.test(m.from.email) && !m.inReplyTo && !m.references.length) return "notification";
  return "person";
}

/** "Re: Fwd: Hello" → "Hello", used when picking the thread subject. */
export function baseSubject(subject: string) {
  return subject.replace(/^\s*((re|fwd?|aw|wg|odp|tr|sv|vs)(\[\d+\])?\s*:\s*)+/i, "").trim();
}

/** Thread folder from where its messages live. Inbox wins: one inbox message keeps the thread in Inbox. */
export function threadFolder(rows: Pick<MessageRow, "labels" | "isOutgoing" | "imapPath">[], roles: (FolderRole | null)[]): ThreadFolder {
  if (roles.includes("inbox")) return "inbox";
  const live = roles.filter((r) => r !== "trash" && r !== "spam");
  if (!live.length) return roles.includes("spam") ? "spam" : "trash";
  if (live.every((r) => r === "sent") || rows.every((m) => m.isOutgoing)) return "sent";
  return "archive";
}

function roleOf(m: Pick<MessageRow, "labels">): FolderRole | null {
  // Roles are stored as a pseudo label "role:<name>" so one column serves Gmail and IMAP alike.
  const tag = m.labels.find((l) => l.startsWith("role:"));
  return tag ? ((tag.slice(5) || null) as FolderRole | null) : null;
}

function withRole(labels: string[], role: FolderRole | null) {
  return [...labels.filter((l) => !l.startsWith("role:")), `role:${role ?? ""}`];
}

/** Same labels in any order: a flag change rebuilds the list, so only the order may differ. */
function sameLabels(a: string[], b: string[]) {
  const x = [...a].sort();
  const y = [...b].sort();
  return x.length === y.length && x.every((l, i) => l === y[i]);
}

/** Equal as JSON whatever the order of keys: what comes back from jsonb has its keys reordered. */
export function sameJson(a: unknown, b: unknown) {
  const sorted = (_: string, v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0))) : v;
  return JSON.stringify(a, sorted) === JSON.stringify(b, sorted);
}

function domainOf(email: string) {
  return email.split("@")[1]?.toLowerCase() ?? "";
}

/**
 * Writes provider changes into the cache and keeps thread aggregates (folder, unread, snippet…) in
 * sync. App-only thread state (snooze, follow-up) survives; a reply from someone else clears a
 * pending follow-up reminder and wakes a snoozed thread, like Gmail does.
 */
export class DbSyncSink implements SyncSink {
  /** New unread inbox mail found during an incremental sync — the worker turns these into push notifications. */
  readonly newMail: NewMail[] = [];

  constructor(
    private account: { id: string; userId: string; email: string },
    /** false during the initial import, so old mail doesn't buzz the phone. */
    private collectNew = false,
  ) {}

  async upsertMessages(batch: RemoteMessage[]) {
    if (!batch.length) return;
    const touched = new Set<string>();
    const ids = batch.map((m) => m.providerMessageId);
    const existing = await db()
      .select({ id: schema.messages.id, providerMessageId: schema.messages.providerMessageId, threadId: schema.messages.threadId })
      .from(schema.messages)
      .where(and(eq(schema.messages.accountId, this.account.id), inArray(schema.messages.providerMessageId, ids)));
    const known = new Map(existing.map((e) => [e.providerMessageId, e]));
    // A message we sent was recorded right away under a "local:" id; its real copy adopts that row instead of
    // duplicating it. Asked once per batch, not per message: an import would otherwise ask thousands of times.
    const placeholders = new Map<string, { id: string; threadId: string }>();
    if (batch.some((m) => !known.has(m.providerMessageId) && m.messageIdHeader)) {
      const rows = await db()
        .select({ id: schema.messages.id, messageIdHeader: schema.messages.messageIdHeader, threadId: schema.messages.threadId })
        .from(schema.messages)
        .where(and(eq(schema.messages.accountId, this.account.id), sql`${schema.messages.providerMessageId} like 'local:%'`));
      for (const p of rows) if (p.messageIdHeader) placeholders.set(p.messageIdHeader, p);
    }

    for (const m of batch) {
      const prev = known.get(m.providerMessageId);
      // Ours when it sits in Sent, or Gmail labelled it SENT (only mail the account really sent gets that).
      // A From: with the user's own address proves nothing (anyone can write it): mail like that arriving
      // in Inbox or Spam is incoming, so a forged one still notifies and doesn't pose as sent mail.
      const fromSelf = m.from.email.toLowerCase() === this.account.email.toLowerCase();
      const isOutgoing = m.role === "sent" || m.labels.includes("SENT") || (fromSelf && m.role !== "inbox" && m.role !== "spam");
      const values = {
        messageIdHeader: m.messageIdHeader ?? null,
        inReplyTo: m.inReplyTo ?? null,
        references: m.references,
        from: m.from,
        to: m.to,
        cc: m.cc,
        bcc: m.bcc,
        replyTo: m.replyTo,
        subject: m.subject,
        date: m.date,
        snippet: m.snippet,
        attachments: m.attachments,
        unread: m.unread,
        imapPath: m.imapPath ?? null,
        imapUid: m.imapUid ?? null,
        labels: withRole([...m.labels, ...(m.pinned ? ["\\Flagged"] : [])], m.role),
        isOutgoing,
        ...(m.html !== undefined ? { bodyHtml: m.html } : {}),
        ...(m.text !== undefined ? { bodyText: m.text } : {}),
        ...(m.invite ? { invite: m.invite } : {}),
      };

      if (prev) {
        await db().update(schema.messages).set(values).where(eq(schema.messages.id, prev.id));
        touched.add(prev.threadId);
        continue;
      }

      const placeholder = m.messageIdHeader ? placeholders.get(m.messageIdHeader) : undefined;
      if (placeholder) {
        await db()
          .update(schema.messages)
          .set({ ...values, providerMessageId: m.providerMessageId })
          .where(eq(schema.messages.id, placeholder.id));
        placeholders.delete(m.messageIdHeader!);
        touched.add(placeholder.threadId);
        continue;
      }

      const thread = await this.findOrCreateThread(m);
      const [row] = await db()
        .insert(schema.messages)
        .values({
          ...values,
          userId: this.account.userId,
          accountId: this.account.id,
          threadId: thread.id,
          providerMessageId: m.providerMessageId,
        })
        .onConflictDoNothing()
        .returning({ id: schema.messages.id });
      touched.add(thread.id);
      if (m.listUnsubscribe) {
        await db()
          .update(schema.threads)
          .set({ listUnsubscribe: m.listUnsubscribe, listUnsubscribeOneClick: !!m.listUnsubscribeOneClick })
          .where(eq(schema.threads.id, thread.id));
      }

      if (row && !isOutgoing) {
        // Only a newer message is a reply; an older one (history import) mustn't clear a reminder or wake a snooze.
        if (m.date >= thread.lastMessageAt) await this.onIncoming(thread);
        // A screened conversation doesn't buzz the phone; it waits quietly for a decision.
        // Nor does a muted one, or mail from someone the user blocked.
        if (this.collectNew && m.unread && m.role === "inbox" && !thread.screening && !thread.mutedAt && (await senderStatus(this.account.userId, m.from.email)) !== "blocked") {
          this.newMail.push({ threadId: thread.id, messageId: row.id, from: m.from, subject: m.subject, snippet: m.snippet });
        }
      }
    }
    await this.refreshThreads([...touched]);
  }

  async updateFlags(changes: FlagChange[]) {
    if (!changes.length) return;
    // Servers without CONDSTORE (Seznam) report their newest messages on every sync, changed or not:
    // read only what a flag change needs (never the bodies) and write only what actually changed.
    const rows = await db()
      .select({
        id: schema.messages.id,
        threadId: schema.messages.threadId,
        providerMessageId: schema.messages.providerMessageId,
        labels: schema.messages.labels,
        unread: schema.messages.unread,
        imapPath: schema.messages.imapPath,
        imapUid: schema.messages.imapUid,
      })
      .from(schema.messages)
      .where(
        and(
          eq(schema.messages.accountId, this.account.id),
          inArray(
            schema.messages.providerMessageId,
            changes.map((c) => c.providerMessageId),
          ),
        ),
      );
    const byId = new Map(rows.map((r) => [r.providerMessageId, r]));
    const touched = new Set<string>();
    for (const c of changes) {
      const row = byId.get(c.providerMessageId);
      if (!row) continue;
      let labels = c.labels ? withRole(c.labels, roleOf(row)) : row.labels;
      if (c.role !== undefined) labels = withRole(labels, c.role);
      if (c.pinned !== undefined) {
        labels = labels.filter((l) => l !== "\\Flagged" && l !== "STARRED");
        if (c.pinned) labels.push("\\Flagged");
      }
      const patch = {
        ...(sameLabels(labels, row.labels) ? {} : { labels }),
        ...(c.unread !== undefined && c.unread !== row.unread ? { unread: c.unread } : {}),
        ...(c.imapPath !== undefined && c.imapPath !== row.imapPath ? { imapPath: c.imapPath } : {}),
        ...(c.imapUid !== undefined && c.imapUid !== row.imapUid ? { imapUid: c.imapUid } : {}),
      };
      if (!Object.keys(patch).length) continue;
      await db().update(schema.messages).set(patch).where(eq(schema.messages.id, row.id));
      touched.add(row.threadId);
    }
    await this.refreshThreads([...touched]);
  }

  async removeMessages(providerMessageIds: string[]) {
    if (!providerMessageIds.length) return;
    const removed = await db()
      .delete(schema.messages)
      .where(and(eq(schema.messages.accountId, this.account.id), inArray(schema.messages.providerMessageId, providerMessageIds)))
      .returning({ threadId: schema.messages.threadId });
    await this.refreshThreads([...new Set(removed.map((r) => r.threadId))]);
  }

  async saveState(patch: Partial<SyncState>) {
    const [row] = await db()
      .select({ syncState: schema.accounts.syncState })
      .from(schema.accounts)
      .where(eq(schema.accounts.id, this.account.id));
    const current = row?.syncState ?? {};
    const next: SyncState = { ...current, ...patch };
    if (patch.folders) next.folders = { ...current.folders, ...patch.folders };
    // Every folder of every sync saves its cursor; most often it hasn't moved.
    if (sameJson(next, current)) return;
    await db().update(schema.accounts).set({ syncState: next }).where(eq(schema.accounts.id, this.account.id));
  }

  async forgetFolder(path: string) {
    const removed = await db()
      .delete(schema.messages)
      .where(and(eq(schema.messages.accountId, this.account.id), eq(schema.messages.imapPath, path)))
      .returning({ threadId: schema.messages.threadId });
    await this.refreshThreads([...new Set(removed.map((r) => r.threadId))]);
  }

  async knownUids(path: string) {
    const rows = await db()
      .select({ uid: schema.messages.imapUid })
      .from(schema.messages)
      .where(and(eq(schema.messages.accountId, this.account.id), eq(schema.messages.imapPath, path)));
    return rows.map((r) => r.uid).filter((u): u is number => u !== null);
  }

  async knownMessages(providerMessageIds: string[]) {
    if (!providerMessageIds.length) return new Set<string>();
    const rows = await db()
      .select({ id: schema.messages.providerMessageId })
      .from(schema.messages)
      .where(and(eq(schema.messages.accountId, this.account.id), inArray(schema.messages.providerMessageId, providerMessageIds)));
    return new Set(rows.map((r) => r.id));
  }

  async saveFolders(folders: Partial<Record<FolderRole, string>>) {
    await db().update(schema.accounts).set({ folders }).where(eq(schema.accounts.id, this.account.id));
  }

  private refsCache: Promise<Map<string, string>> | null = null;
  /** Own folders' Gmail label ids / IMAP paths at this mailbox → folder id. */
  private ownFolderRefs() {
    return (this.refsCache ??= folderRefs(this.account.id));
  }

  async syncOwnFolders(found: ProviderFolder[]) {
    const { linked, unlinked } = await syncOwnFolders(this.account, found);
    this.refsCache = null;
    const [row] = await db()
      .select({ provider: schema.accounts.provider, syncState: schema.accounts.syncState })
      .from(schema.accounts)
      .where(eq(schema.accounts.id, this.account.id));
    if (!row) return;
    // Mail synced before the folders were known (mailboxes connected before own folders existed) is filed once, all of it.
    const refs = row.syncState.foldersFiled ? linked : [...(await this.ownFolderRefs()).keys()];
    if (refs.length || unlinked.length) await this.refile(refs, unlinked);
    const patch: Partial<SyncState> = {};
    if (!row.syncState.foldersFiled) patch.foldersFiled = true;
    // An IMAP folder that showed up after the history import came in from the last month only: fetch the rest of it too.
    if (row.provider === "imap" && linked.length && row.syncState.historyComplete) patch.historyComplete = false;
    if (Object.keys(patch).length) await this.saveState(patch);
  }

  /** Conversations with mail in these folders, or filed in ones this mailbox no longer has: file them again. */
  private async refile(refs: string[], unlinked: string[]) {
    const ids = new Set<string>();
    if (refs.length) {
      const rows = await db()
        .selectDistinct({ id: schema.messages.threadId })
        .from(schema.messages)
        .where(
          and(
            eq(schema.messages.accountId, this.account.id),
            or(
              inArray(schema.messages.imapPath, refs),
              sql`${schema.messages.labels} ?| array[${sql.join(
                refs.map((r) => sql`${r}`),
                sql`, `,
              )}]::text[]`,
            ),
          ),
        );
      for (const r of rows) ids.add(r.id);
    }
    if (unlinked.length) {
      const rows = await db()
        .select({ id: schema.threads.id })
        .from(schema.threads)
        .where(and(eq(schema.threads.accountId, this.account.id), inArray(schema.threads.folderId, unlinked)));
      for (const r of rows) ids.add(r.id);
    }
    await this.refreshThreads([...ids]);
  }

  /**
   * Gmail hands us its threadId. For IMAP we thread by headers: a message joins the thread that
   * already holds any message it references (or that references it). Otherwise it starts a thread
   * keyed by the root Message-ID, so a late-arriving parent still finds its replies.
   */
  private async findOrCreateThread(m: RemoteMessage): Promise<ThreadRow> {
    const accountId = this.account.id;
    let candidates: string[];
    if (m.providerThreadId) {
      candidates = [m.providerThreadId];
    } else {
      candidates = [...new Set([...m.references, m.inReplyTo, m.messageIdHeader].filter((x): x is string => !!x))];
    }

    if (candidates.length) {
      const [byKey] = await db()
        .select()
        .from(schema.threads)
        .where(and(eq(schema.threads.accountId, accountId), inArray(schema.threads.providerThreadId, candidates)))
        .limit(1);
      if (byKey) return byKey;

      if (!m.providerThreadId) {
        const [byMessage] = await db()
          .select({ threadId: schema.messages.threadId })
          .from(schema.messages)
          .where(
            and(
              eq(schema.messages.accountId, accountId),
              or(
                inArray(schema.messages.messageIdHeader, candidates),
                m.messageIdHeader ? sql`${schema.messages.references} @> ${JSON.stringify([m.messageIdHeader])}::jsonb` : undefined,
              ),
            ),
          )
          .limit(1);
        if (byMessage) {
          const [t] = await db().select().from(schema.threads).where(eq(schema.threads.id, byMessage.threadId));
          if (t) return t;
        }
      }
    }

    const key = m.providerThreadId ?? m.references[0] ?? m.inReplyTo ?? m.messageIdHeader ?? m.providerMessageId;
    // Screener: someone new starting a conversation waits for a yes or no (never during an import).
    const outgoing = m.from.email.toLowerCase() === this.account.email.toLowerCase() || m.role === "sent";
    const screening = this.collectNew && !outgoing && m.role === "inbox" && (await shouldScreen(this.account.userId, m.from, await this.screener()));
    const [created] = await db()
      .insert(schema.threads)
      .values({
        userId: this.account.userId,
        accountId,
        providerThreadId: key,
        subject: baseSubject(m.subject) || m.subject,
        lastMessageAt: m.date,
        kind: threadKind(m, outgoing),
        screening,
      })
      .onConflictDoNothing()
      .returning();
    if (created) return created;
    const [raced] = await db()
      .select()
      .from(schema.threads)
      .where(and(eq(schema.threads.accountId, accountId), eq(schema.threads.providerThreadId, key)));
    return raced;
  }

  private screenerCache: Promise<ScreenerState> | null = null;
  private screener() {
    return (this.screenerCache ??= screenerState(this.account.userId));
  }

  private async onIncoming(thread: ThreadRow) {
    const patch: Partial<ThreadRow> = {};
    if (thread.followUpAt) patch.followUpAt = null;
    if (thread.snoozedUntil && thread.snoozedUntil > new Date()) patch.snoozedUntil = null;
    if (Object.keys(patch).length) await db().update(schema.threads).set(patch).where(eq(schema.threads.id, thread.id));
  }

  /** Recompute thread aggregates from its messages; drop threads that lost every message. */
  async refreshThreads(threadIds: string[]) {
    for (const threadId of threadIds) {
      const rows = await db()
        .select({
          subject: schema.messages.subject,
          from: schema.messages.from,
          to: schema.messages.to,
          cc: schema.messages.cc,
          date: schema.messages.date,
          snippet: schema.messages.snippet,
          unread: schema.messages.unread,
          labels: schema.messages.labels,
          isOutgoing: schema.messages.isOutgoing,
          imapPath: schema.messages.imapPath,
          attachments: schema.messages.attachments,
          messageIdHeader: schema.messages.messageIdHeader,
        })
        .from(schema.messages)
        .where(eq(schema.messages.threadId, threadId))
        .orderBy(schema.messages.date);

      if (!rows.length) {
        // Keep the empty shell for now: an IMAP move shows up as "gone from INBOX" before "new in
        // Archive", and the thread (with its snooze, follow-up and open tabs) must survive that.
        // Shells that stay empty are swept by `sweepEmptyThreads`.
        await db().update(schema.threads).set({ messageCount: 0, updatedAt: new Date() }).where(eq(schema.threads.id, threadId));
        continue;
      }

      const roles = rows.map(roleOf);
      const live = rows.filter((_, i) => roles[i] !== "trash" && roles[i] !== "spam");
      const visible = live.length ? live : rows;
      const last = visible[visible.length - 1];
      const people = new Map<string, Person>();
      for (const m of visible) {
        for (const p of [m.from, ...m.to, ...m.cc]) {
          if (p.email.toLowerCase() !== this.account.email.toLowerCase() && !people.has(p.email.toLowerCase())) {
            people.set(p.email.toLowerCase(), p);
          }
        }
      }
      const lastIncoming = [...visible].reverse().find((m) => !m.isOutgoing);
      const lastSent = [...live].reverse().find((m) => m.isOutgoing);
      const folder = threadFolder(rows, roles);
      const folderId = ownFolderOf(live, await this.ownFolderRefs());
      // The user answered: whoever was waiting for a reply in this conversation got it.
      const lastOutgoing = [...rows].reverse().find((m) => m.isOutgoing);
      if (lastOutgoing) {
        await db()
          .update(schema.insights)
          .set({ doneAt: new Date() })
          .where(
            and(
              eq(schema.insights.threadId, threadId),
              eq(schema.insights.category, "reply"),
              isNull(schema.insights.doneAt),
              lt(schema.insights.at, lastOutgoing.date),
            ),
          );
      }
      const senderDomain = lastIncoming ? domainOf(lastIncoming.from.email) : "";
      const t = schema.threads;
      // Snoozed here but moved back to Inbox in another client (Gmail, Seznam's web…): the snooze is over.
      // Not right after snoozing, while the provider may still be catching up with the move to Archive.
      const backEarly =
        folder === "inbox"
          ? sql`(${t.snoozedUntil} > now() and jsonb_array_length(${t.snoozeMoved}) > 0 and ${t.folderId} is null and coalesce(${t.snoozedAt}, 'epoch'::timestamptz) < now() - interval '2 minutes')`
          : sql`false`;

      await db()
        .update(schema.threads)
        .set({
          subject: baseSubject(visible[0].subject) || visible[0].subject,
          snippet: last.snippet,
          participants: [...people.values()].slice(0, 12),
          lastMessageAt: last.date,
          lastSentAt: lastSent?.date ?? null,
          messageCount: new Set(visible.map((m, i) => m.messageIdHeader ?? `#${i}`)).size,
          hasAttachments: visible.some((m) => m.attachments.some((a) => !a.inline)),
          unread: visible.some((m) => m.unread && !m.isOutgoing),
          pinned: visible.some((m) => m.labels.includes("\\Flagged") || m.labels.includes("STARRED")),
          // Snoozed: archived at the provider until it wakes, but still an Inbox conversation here.
          folder: sql`case when ${schema.threads.snoozedUntil} > now() and ${folder} = 'archive' then 'inbox' else ${folder} end`,
          // (Its "Snoozed" label comes off with the next release round, `releaseSnoozes` in the worker.)
          snoozedUntil: sql`case when ${backEarly} then null else ${t.snoozedUntil} end`,
          snoozeMoved: sql`case when ${backEarly} then '[]'::jsonb else ${t.snoozeMoved} end`,
          folderId,
          logoDomain: senderDomain && !FREE_MAIL_DOMAINS.has(senderDomain) ? senderDomain : null,
          updatedAt: new Date(),
        })
        .where(eq(schema.threads.id, threadId));
    }
  }
}

/** Delete threads that lost every message and stayed empty for a while (see refreshThreads). */
export async function sweepEmptyThreads(accountId: string, olderThanMs = 3600_000) {
  await db()
    .delete(schema.threads)
    .where(
      and(
        eq(schema.threads.accountId, accountId),
        // Written out for threads_empty_idx: every sync asks, and only empty shells should be read.
        sql`${schema.threads.messageCount} = 0`,
        lt(schema.threads.updatedAt, new Date(Date.now() - olderThanMs)),
      ),
    );
}

export { roleOf, withRole };
