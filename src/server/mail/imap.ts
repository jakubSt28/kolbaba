import { ImapFlow, type ExpungeEvent, type FetchMessageObject, type FetchQueryObject, type ImapFlowOptions, type MailboxObject, type SearchObject } from "imapflow";
import { simpleParser } from "mailparser";
import { createTransport } from "nodemailer";
import type { Readable } from "node:stream";
import { tk } from "@/lib/i18n";
import type { FolderRole } from "../db/schema";
import {
  MailAuthError,
  MailNotFoundError,
  type AdapterAccount,
  type AttachmentContent,
  type FlagChange,
  type ListedDraft,
  type MailAdapter,
  type MessageBody,
  type MessageRef,
  type OutgoingMessage,
  type RemoteDraft,
  type RemoteMessage,
  type SavedDraft,
  type SentResult,
  type SyncSink,
} from "./types";
import { buildMessage, smtpAutoSavesSent } from "./imap/compose";
import { smtpTurnedOff, toMailError } from "./imap/errors";
import { refreshMicrosoftToken } from "../microsoft";
import { resolvePublic } from "../autodetect/probe";
import { sendWithGraph } from "./graph";
import { parseInvite, type Invite } from "./ics";
import { detectFolders, normalizeFolderName, ownFolders } from "./imap/folders";
import {
  BODY_PREFETCH_LIMIT,
  EXTRA_HEADERS,
  attachmentsFromStructure,
  decodePart,
  findTextPart,
  locate,
  makeSnippet,
  parseProviderMessageId,
  providerMessageId,
  toRemoteMessage,
  type FolderContext,
  type PrefetchedBody,
} from "./imap/message";
import { backoffDelay, chunk, compactUidSet, missingUids, parseModseq, uidSetParts, uidsBelow, type FolderState } from "./imap/sync";

/**
 * Generic IMAP + SMTP adapter (Seznam, custom-domain hosting, later iCloud/Yahoo).
 *
 * Each call opens its own short-lived connection and always logs out; one sync run reuses a single
 * connection across folders. `watch` keeps a separate long-lived IDLE connection on INBOX.
 */

/** Folders we mirror. Drafts are detected (for moves) but belong to our own composer. Inbox goes first, so a move to Trash is seen leaving before it arrives. */
const SYNCED_ROLES: readonly FolderRole[] = ["inbox", "sent", "archive", "trash", "spam"];
const BATCH_SIZE = 100;
/** Newest messages whose flags we re-check on servers without CONDSTORE. */
const FLAG_WINDOW = 500;
/** Without QRESYNC, a folder whose count adds up is still asked which messages it holds this often. */
const EXPUNGE_CHECK_EVERY_MS = 24 * 3600_000;
/** Remembered flags are trusted this long; then all of the window goes to the database once more. */
const FLAG_MEMORY_MS = 3600_000;

/**
 * Without CONDSTORE every sync re-reads the flags of a folder's newest messages. What they were last
 * time, per folder, so only the ones that changed go to the database. In this process only: after a
 * restart, and every hour, all of them go again, which also mends anything that drifted.
 */
const flagMemory = new Map<string, { at: number; flags: Map<number, string> }>();

/** Tests: start as a fresh process would. */
export function forgetRememberedFlags() {
  flagMemory.clear();
}

/** Upper bound of ids we name when a folder's UIDVALIDITY changes. */
const MAX_FORGET = 100_000;
const DEFAULT_BACKFILL_DAYS = 30;
const SNIPPET_FETCH_BYTES = 4096;
/** Restart IDLE well before the 29-minute limit some servers enforce. */
const IDLE_RESTART_MS = 20 * 60_000;
const WATCH_MAX_BACKOFF_MS = 15 * 60_000;
/** A session that lasted this long counts as healthy and resets the backoff. */
const WATCH_HEALTHY_MS = 60_000;
/** Coalesce bursts (e.g. "mark all read" in another client emits one event per message). */
const NOTIFY_DEBOUNCE_MS = 1_000;

const SYNC_FETCH: FetchQueryObject = {
  uid: true,
  flags: true,
  envelope: true,
  bodyStructure: true,
  internalDate: true,
  size: true,
  headers: EXTRA_HEADERS,
};

export interface ImapAdapterOptions {
  /** Extra imapflow options, for server quirks and for tests (e.g. `disableAutoEnable` to force the no-CONDSTORE path). */
  imap?: Partial<ImapFlowOptions>;
}

export function createImapAdapter(account: AdapterAccount, options: ImapAdapterOptions = {}): MailAdapter {
  return new ImapAdapter(account, options);
}

/** Plaintext is only acceptable to a local bridge/test server; anywhere else STARTTLS is mandatory. */
function isLoopback(host: string): boolean {
  return host === "localhost" || host === "::1" || /^127\./.test(host);
}

/**
 * Where to connect, checked on every connection: a mail server's name that later starts pointing into
 * our own network (DNS rebinding) is refused, not just at the moment the mailbox was added. The server
 * is reached at the checked address, with its name kept for TLS (SNI and the certificate check).
 * Outside production (tests, a local bridge) any address goes.
 */
async function serverAddress(host: string): Promise<{ host: string; servername?: string }> {
  if (process.env.NODE_ENV !== "production") return { host };
  const address = await resolvePublic(host, 10_000);
  if (!address) throw new Error(`Mail server ${host} doesn't resolve to a public address`);
  return address === host ? { host } : { host: address, servername: host };
}

async function readStream(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const part of stream) chunks.push(Buffer.isBuffer(part) ? part : Buffer.from(part));
  return Buffer.concat(chunks);
}

async function parseBody(source: Buffer): Promise<{ html: string | null; text: string | null; invite?: Invite }> {
  // keepCidLinks: inline images are served as attachments by cid, not inlined as data: URIs.
  const parsed = await simpleParser(source, { keepCidLinks: true, skipImageLinks: true, skipTextToHtml: true });
  const calendar = parsed.attachments.find((a) => a.contentType === "text/calendar" || /\.ics$/i.test(a.filename ?? ""));
  const invite = calendar ? parseInvite(calendar.content.toString("utf8")) : null;
  return { html: parsed.html || null, text: parsed.text ?? null, ...(invite ? { invite } : {}) };
}

function sameFolders(a: Partial<Record<FolderRole, string>>, b: Partial<Record<FolderRole, string>>): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]) as Set<FolderRole>;
  return [...keys].every((k) => a[k] === b[k]);
}

function stateOf(mailbox: MailboxObject): FolderState {
  return {
    uidValidity: mailbox.uidValidity.toString(),
    uidNext: mailbox.uidNext,
    exists: mailbox.exists,
    ...(mailbox.highestModseq !== undefined && !mailbox.noModseq ? { highestModseq: mailbox.highestModseq.toString() } : {}),
  };
}

function openMailbox(client: ImapFlow): MailboxObject {
  if (!client.mailbox) throw new Error("No mailbox selected");
  return client.mailbox;
}

function flagChange(path: string, uidValidity: string, msg: Pick<FetchMessageObject, "uid" | "flags">): FlagChange {
  const flags = msg.flags ?? new Set<string>();
  return {
    providerMessageId: providerMessageId(path, uidValidity, msg.uid),
    imapPath: path,
    imapUid: msg.uid,
    unread: !flags.has("\\Seen"),
    pinned: flags.has("\\Flagged"),
  };
}

class ImapAdapter implements MailAdapter {
  private folders: Partial<Record<FolderRole, string>>;
  private savedFolders: Partial<Record<FolderRole, string>>;
  private folderState: Record<string, FolderState>;
  /** The user's own folders found by the last LIST; synced after the special ones. */
  private own: string[] = [];
  private readonly watchers = new Set<() => Promise<void>>();

  constructor(
    private readonly account: AdapterAccount,
    private readonly options: ImapAdapterOptions = {},
  ) {
    this.folders = { ...account.folders };
    this.savedFolders = { ...account.folders };
    this.folderState = { ...(account.syncState.folders ?? {}) };
  }

  // ---- connections -------------------------------------------------------------------------

  private refreshing: Promise<string> | null = null;

  /**
   * How to sign in: the password, or for Outlook and Microsoft 365 a fresh Microsoft access token
   * (XOAUTH2). Microsoft rotates refresh tokens, so a new one is stored; concurrent connections share
   * one refresh.
   */
  private async secret(): Promise<{ pass: string } | { accessToken: string }> {
    const creds = this.account.credentials;
    if (creds.kind === "password") return { pass: creds.password };
    if (creds.issuer !== "microsoft") throw new MailAuthError(tk("IMAP accounts sign in with a password"), "invalid_credentials");
    if (creds.accessToken && creds.expiresAt && creds.expiresAt - Date.now() > 5 * 60_000) return { accessToken: creds.accessToken };
    this.refreshing ??= (async () => {
      try {
        const fresh = await refreshMicrosoftToken(creds.refreshToken);
        const next = { ...creds, accessToken: fresh.accessToken, expiresAt: fresh.expiresAt, refreshToken: fresh.refreshToken ?? creds.refreshToken };
        this.account.credentials = next;
        await this.account.saveCredentials(next);
        return fresh.accessToken;
      } finally {
        this.refreshing = null;
      }
    })();
    return { accessToken: await this.refreshing };
  }

  private isMicrosoft() {
    const creds = this.account.credentials;
    return creds.kind === "oauth" && creds.issuer === "microsoft";
  }

  private async imapOptions(): Promise<ImapFlowOptions> {
    const imap = this.account.imap;
    if (!imap) throw new Error(`Account ${this.account.id} has no IMAP server`);
    const address = await serverAddress(imap.host);
    return {
      host: address.host,
      ...(address.servername ? { servername: address.servername } : {}),
      port: imap.port,
      secure: imap.secure,
      doSTARTTLS: imap.secure ? undefined : !isLoopback(imap.host),
      auth: { user: imap.username || this.account.email, ...(await this.secret()) },
      // imapflow's default pino logger would print every command; we never want credentials or
      // message content in logs.
      logger: false,
      clientInfo: { name: "Kolbaba" },
      qresync: true,
      connectionTimeout: 30_000,
      greetingTimeout: 16_000,
      socketTimeout: 5 * 60_000,
      ...this.options.imap,
    };
  }

  private async connect(extra: Partial<ImapFlowOptions> = {}): Promise<ImapFlow> {
    const client = new ImapFlow({ ...(await this.imapOptions()), ...extra });
    // Errors also reject the pending command; without a listener an 'error' event crashes the worker.
    client.on("error", () => {});
    try {
      await client.connect();
      return client;
    } catch (err) {
      client.close();
      throw toMailError(err);
    }
  }

  private async withClient<T>(fn: (client: ImapFlow) => Promise<T>): Promise<T> {
    const client = await this.connect();
    try {
      return await fn(client);
    } catch (err) {
      throw toMailError(err);
    } finally {
      await client.logout().catch(() => client.close());
    }
  }

  async verify(): Promise<void> {
    await this.withClient(async () => {});
    const smtp = await this.smtpTransport();
    try {
      await smtp.verify();
    } catch (err) {
      throw toMailError(err);
    } finally {
      smtp.close();
    }
  }

  // ---- folders -----------------------------------------------------------------------------

  /** LIST, classify, create Archive when missing, and persist when something changed. */
  private async discoverFolders(client: ImapFlow, sink?: SyncSink): Promise<Partial<Record<FolderRole, string>>> {
    const list = await client.list();
    const detected = detectFolders(list);
    if (!detected.archive) {
      // imapflow prepends the personal namespace ("INBOX.") and uses the server's delimiter.
      detected.archive = await client.mailboxCreate("Archive").then(
        (res) => res.path,
        () => undefined,
      );
      if (!detected.archive) delete detected.archive;
    }
    this.folders = detected;
    if (sink?.saveFolders && !sameFolders(detected, this.savedFolders)) {
      await sink.saveFolders(detected);
      this.savedFolders = { ...detected };
    }
    const own = ownFolders(list, detected);
    this.own = own.map((f) => f.ref);
    if (sink?.syncOwnFolders) await sink.syncOwnFolders(own);
    return detected;
  }

  private async folderFor(client: ImapFlow, role: FolderRole): Promise<string> {
    if (role === "inbox") return "INBOX";
    const path = this.folders[role] ?? (await this.discoverFolders(client))[role];
    if (!path) throw new Error(`This mailbox has no ${role} folder`);
    return path;
  }

  /** Special folders first (Inbox leading), then the user's own, whose messages have no role. */
  private syncedFolders(folders: Partial<Record<FolderRole, string>>): [FolderRole | null, string][] {
    const seen = new Set<string>();
    const out: [FolderRole | null, string][] = [];
    for (const role of SYNCED_ROLES) {
      const path = folders[role];
      if (path && !seen.has(path)) {
        seen.add(path);
        out.push([role, path]);
      }
    }
    for (const path of this.own) {
      if (!seen.has(path)) {
        seen.add(path);
        out.push([null, path]);
      }
    }
    return out;
  }

  /** RFC 9738 (Yahoo, AOL): a server that acts on at most this many messages per command, and quietly leaves out the rest. */
  private messageLimit(client: ImapFlow): number | null {
    for (const cap of client.capabilities?.keys() ?? []) {
      const m = /^MESSAGELIMIT=(\d+)$/i.exec(cap);
      if (m) return Number(m[1]);
    }
    return null;
  }

  /**
   * UID SEARCH over UIDs `from`…`to`, asked in windows a message limit answers whole (a single
   * question when the server has none). False when any part failed, so it never reads as "nothing".
   *
   * Windows of UIDs when the range is shorter than the folder (new mail), else windows of positions:
   * Yahoo's UIDs run into the millions with wide gaps, and windows of UIDs took minutes of questions
   * about a few thousand messages. Positions go from the top down, so a message deleted meanwhile
   * only moves ones already asked about.
   */
  private async searchUids(client: ImapFlow, query: SearchObject, from: number, to: number): Promise<number[] | false> {
    if (to < from) return [];
    const limit = this.messageLimit(client);
    const exists = openMailbox(client).exists;
    const windows: SearchObject[] = [];
    if (!limit) windows.push({ uid: `${from}:${to}` });
    else if (to - from + 1 <= exists) {
      for (let start = from; start <= to; start += limit) windows.push({ uid: `${start}:${Math.min(to, start + limit - 1)}` });
    } else {
      for (let end = exists; end > 0; end -= limit) windows.push({ seq: `${Math.max(1, end - limit + 1)}:${end}`, uid: `${from}:${to}` });
    }
    const out = new Set<number>();
    for (const window of windows) {
      const found = await client.search({ ...query, ...window }, { uid: true });
      if (!Array.isArray(found)) return false;
      for (const uid of found) out.add(uid);
    }
    return [...out];
  }

  private backfillSince(): Date {
    const until = this.account.syncState.backfilledUntil;
    return new Date(until ?? Date.now() - DEFAULT_BACKFILL_DAYS * 86_400_000);
  }

  private async saveFolderState(sink: SyncSink, path: string, state: FolderState, extra: { backfilledUntil?: number } = {}) {
    this.folderState[path] = state;
    await sink.saveState({ folders: { ...this.folderState }, ...extra });
  }

  // ---- sync --------------------------------------------------------------------------------

  async initialSync(sink: SyncSink, opts: { since: Date }): Promise<void> {
    await this.withClient(async (client) => {
      const folders = await this.discoverFolders(client, sink);
      for (const [role, path] of this.syncedFolders(folders)) {
        const lock = await client.getMailboxLock(path, { readOnly: true });
        try {
          const mailbox = openMailbox(client);
          // Cursors are taken before fetching so mail arriving meanwhile is picked up next time.
          const state = stateOf(mailbox);
          const ctx: FolderContext = { path, uidValidity: state.uidValidity, role };
          const uids = mailbox.exists ? (await this.searchUids(client, { since: opts.since }, 1, mailbox.uidNext - 1)) || [] : [];
          await this.importUids(client, sink, ctx, uids);
          await this.saveFolderState(sink, path, state, { backfilledUntil: opts.since.getTime() });
        } finally {
          lock.release();
        }
      }
    });
  }

  /** History behind the first import, per folder by UID (newest first), so it resumes exactly. */
  async importOlder(sink: SyncSink, opts: { limit: number }): Promise<boolean> {
    return this.withClient(async (client) => {
      const folders = await this.discoverFolders(client, sink);
      const cursors = { ...(this.account.syncState.olderBelowUid ?? {}) };
      let budget = opts.limit;
      let done = true;
      for (const [role, path] of this.syncedFolders(folders)) {
        if (budget <= 0) return false;
        const lock = await client.getMailboxLock(path, { readOnly: true });
        try {
          const mailbox = openMailbox(client);
          const { uidValidity } = stateOf(mailbox);
          const cursor = cursors[path]?.uidValidity === uidValidity ? cursors[path] : undefined;
          if (cursor?.uid === 0) continue;
          let older: number[] = [];
          if (mailbox.exists && (!cursor || cursor.uid > 1)) {
            // First step: everything before the first import's window (SINCE and BEFORE split by date, so nothing falls between).
            older = cursor
              ? (await this.searchUids(client, {}, 1, cursor.uid - 1)) || []
              : (await this.searchUids(client, { before: this.backfillSince() }, 1, mailbox.uidNext - 1)) || [];
          }
          const batch = older.sort((a, b) => b - a).slice(0, budget);
          cursors[path] = { uidValidity, uid: batch.length ? Math.min(...batch) : 0 };
          if (batch.length) {
            await this.importUids(client, sink, { path, uidValidity, role }, batch);
            budget -= batch.length;
            done = false;
          }
          await sink.saveState({ olderBelowUid: { ...cursors } });
        } finally {
          lock.release();
        }
      }
      return done;
    });
  }

  async incrementalSync(sink: SyncSink): Promise<void> {
    await this.withClient(async (client) => {
      const folders = await this.discoverFolders(client, sink);
      for (const [role, path] of this.syncedFolders(folders)) {
        await this.syncFolder(client, sink, path, role);
      }
    });
  }

  private async syncFolder(client: ImapFlow, sink: SyncSink, path: string, role: FolderRole | null): Promise<void> {
    const prev = this.folderState[path] as FolderState | undefined;
    // VANISHED (QRESYNC) arrives as 'expunge' events during the CHANGEDSINCE fetch.
    const vanished = new Set<number>();
    const onExpunge = (e: ExpungeEvent) => {
      if (e.path === path && e.vanished && e.uid) vanished.add(e.uid);
    };
    client.on("expunge", onExpunge);
    const lock = await client.getMailboxLock(path, { readOnly: true });
    try {
      const mailbox = openMailbox(client);
      const next = stateOf(mailbox);
      const ctx: FolderContext = { path, uidValidity: next.uidValidity, role };

      if (!prev || prev.uidValidity !== next.uidValidity) {
        // New folder, or the server renumbered it: old ids are meaningless, re-import the window
        // (and the history behind it, whose cursor belonged to the old UIDVALIDITY).
        if (prev) await this.forgetFolder(sink, path, prev);
        await sink.saveState({ historyComplete: false });
        const uids = mailbox.exists ? (await this.searchUids(client, { since: this.backfillSince() }, 1, mailbox.uidNext - 1)) || [] : [];
        await this.importUids(client, sink, ctx, uids);
        await this.saveFolderState(sink, path, next);
        return;
      }

      const prevNext = prev.uidNext ?? mailbox.uidNext;
      let added = 0;
      if (mailbox.exists && mailbox.uidNext > prevNext) {
        const found = await this.searchUids(client, {}, prevNext, mailbox.uidNext - 1);
        // A failed search leaves the cursor where it was, so the mail comes next time.
        if (found === false) return;
        const fresh = found.filter((uid) => uid >= prevNext);
        added = fresh.length;
        await this.importUids(client, sink, ctx, fresh);
      }

      const changes: FlagChange[] = [];
      const prevModseq = parseModseq(prev.highestModseq);
      const condstore = client.enabled.has("CONDSTORE") && prevModseq !== null && mailbox.highestModseq !== undefined && !mailbox.noModseq;
      const qresync = condstore && client.enabled.has("QRESYNC") && mailbox.exists > 0;

      if (condstore && mailbox.highestModseq! > prevModseq!) {
        // With a message limit, by sequence number in windows it answers whole.
        const limit = this.messageLimit(client);
        const ranges = limit ? Array.from({ length: Math.ceil(mailbox.exists / limit) }, (_, i) => `${i * limit + 1}:${Math.min(mailbox.exists, (i + 1) * limit)}`) : ["1:*"];
        for (const range of ranges) {
          for await (const msg of client.fetch(range, { uid: true, flags: true }, limit ? { changedSince: prevModseq! } : { uid: true, changedSince: prevModseq! })) {
            if (msg.uid < prevNext) changes.push(flagChange(path, ctx.uidValidity, msg));
          }
        }
      }
      let state = next;
      let rememberFlags: (() => void) | undefined;
      if (!qresync) {
        const recent = mailbox.exists
          ? await client.fetchAll(`${Math.max(1, mailbox.exists - FLAG_WINDOW + 1)}:*`, { uid: true, flags: true })
          : [];
        if (!condstore) rememberFlags = this.changedFlags(path, ctx.uidValidity, recent, prevNext, changes);
        // New mail aside, the folder holds as many messages as last time: nothing was deleted, so neither
        // the database (every UID it knows) nor the server needs asking. Once a day it's asked anyway.
        const counted = prev.exists !== undefined && next.exists !== undefined && next.exists - added === prev.exists;
        if (counted && Date.now() - (prev.expungeCheckedAt ?? 0) < EXPUNGE_CHECK_EVERY_MS) {
          state = { ...next, expungeCheckedAt: prev.expungeCheckedAt };
        } else {
          const gone = await this.expungedUids(client, sink, path, recent, prevNext);
          // Unanswered: no count is kept, so the next sync asks again instead of trusting it.
          if (gone === false) state = { ...next, exists: undefined };
          else {
            for (const uid of gone) vanished.add(uid);
            state = { ...next, expungeCheckedAt: Date.now() };
          }
        }
      }

      if (changes.length) await sink.updateFlags(changes);
      rememberFlags?.();
      if (vanished.size) await sink.removeMessages([...vanished].map((uid) => providerMessageId(path, ctx.uidValidity, uid)));
      await this.saveFolderState(sink, path, state);
    } finally {
      lock.release();
      client.off("expunge", onExpunge);
    }
  }

  /**
   * The newest messages whose flags differ from what this process last saw in the folder (all of
   * them when it hasn't, or not lately) go into `changes`. Returns what to remember once they're saved.
   */
  private changedFlags(path: string, uidValidity: string, recent: FetchMessageObject[], prevNext: number, changes: FlagChange[]) {
    const key = `${this.account.id}|${path}|${uidValidity}`;
    const last = flagMemory.get(key);
    const known = last && Date.now() - last.at < FLAG_MEMORY_MS ? last : null;
    const seen = new Map<number, string>();
    for (const msg of recent) {
      const change = flagChange(path, uidValidity, msg);
      const flags = `${change.unread ? 1 : 0}${change.pinned ? 1 : 0}`;
      seen.set(msg.uid, flags);
      if (msg.uid < prevNext && known?.flags.get(msg.uid) !== flags) changes.push(change);
    }
    return () => flagMemory.set(key, { at: known?.at ?? Date.now(), flags: seen });
  }

  /**
   * Expunge detection without QRESYNC. With the sink's cached UIDs it's exact: ask the server which of
   * them still exist. Otherwise guess from the re-checked window of newest messages. False when the
   * server didn't answer, which must never read as "everything was deleted".
   */
  private async expungedUids(client: ImapFlow, sink: SyncSink, path: string, recent: FetchMessageObject[], prevNext: number): Promise<number[] | false> {
    if (!sink.knownUids) return missingUids(recent.map((m) => m.uid), prevNext, FLAG_WINDOW);
    const known = (await sink.knownUids(path)).filter((uid) => uid < prevNext);
    if (!known.length) return [];
    if (!openMailbox(client).exists) return known;
    // Under a message limit a longer question would be answered in part, and the rest would look deleted;
    // a big folder full of gaps is asked in parts short enough for any server.
    const present = new Set<number>();
    const step = this.messageLimit(client) ?? known.length;
    const sorted = [...known].sort((a, b) => a - b);
    for (let i = 0; i < sorted.length; i += step) {
      for (const uid of uidSetParts(sorted.slice(i, i + step))) {
        const found = await client.search({ uid }, { uid: true });
        if (!Array.isArray(found)) return false;
        for (const u of found) present.add(u);
      }
    }
    return known.filter((uid) => !present.has(uid));
  }

  private async forgetFolder(sink: SyncSink, path: string, prev: FolderState): Promise<void> {
    if (sink.forgetFolder) return sink.forgetFolder(path);
    // Older sinks: name every id the folder could have had.
    for (const uids of chunk(uidsBelow(prev.uidNext, MAX_FORGET), 5000)) {
      await sink.removeMessages(uids.map((uid) => providerMessageId(path, prev.uidValidity, uid)));
    }
  }

  /** Fetch and upsert in batches, newest first, so the inbox fills from the top. */
  private async importUids(client: ImapFlow, sink: SyncSink, ctx: FolderContext, uids: number[]): Promise<void> {
    const sorted = [...new Set(uids)].sort((a, b) => b - a);
    for (const batch of chunk(sorted, BATCH_SIZE)) {
      const messages = await this.fetchMessages(client, ctx, batch);
      if (messages.length) await sink.upsertMessages(messages);
    }
  }

  private async fetchMessages(client: ImapFlow, ctx: FolderContext, uids: number[]): Promise<RemoteMessage[]> {
    const rows = await client.fetchAll(compactUidSet(uids), SYNC_FETCH, { uid: true });
    const small = rows.filter((r) => r.size !== undefined && r.size <= BODY_PREFETCH_LIMIT).map((r) => r.uid);
    const sources = new Map<number, Buffer>();
    if (small.length) {
      // No IMAP commands may run inside this loop (imapflow would deadlock), so only collect.
      for await (const msg of client.fetch(compactUidSet(small), { uid: true, source: true }, { uid: true })) {
        if (msg.source) sources.set(msg.uid, msg.source);
      }
    }

    const out: RemoteMessage[] = [];
    for (const row of rows) {
      const source = sources.get(row.uid);
      let body: PrefetchedBody;
      if (source) {
        const parsed = await parseBody(source).catch(() => null);
        body = parsed ? { ...parsed, snippet: makeSnippet(parsed.text, parsed.html) } : { snippet: "" };
      } else {
        body = { snippet: await this.fetchSnippet(client, row).catch(() => "") };
      }
      out.push(toRemoteMessage(row, ctx, body));
    }
    return out.sort((a, b) => (b.imapUid ?? 0) - (a.imapUid ?? 0));
  }

  /** For large messages: the first few KB of the text part are enough for a preview. */
  private async fetchSnippet(client: ImapFlow, row: FetchMessageObject): Promise<string> {
    const part = findTextPart(row.bodyStructure);
    if (!part) return "";
    const msg = await client.fetchOne(String(row.uid), { uid: true, bodyParts: [{ key: part.part, maxLength: SNIPPET_FETCH_BYTES }] }, { uid: true });
    if (!msg || !msg.bodyParts?.size) return "";
    const raw = msg.bodyParts.get(part.part) ?? [...msg.bodyParts.values()][0];
    // A BINARY fetch arrives with the transfer encoding already removed.
    const encoding = msg.binaryParts?.size ? "binary" : part.encoding;
    const text = decodePart(raw, encoding, part.charset);
    return part.type === "text/html" ? makeSnippet(null, text) : makeSnippet(text);
  }

  // ---- message operations ------------------------------------------------------------------

  /**
   * Open the ref's folder and check its UIDVALIDITY still matches the id, so a stale ref can never
   * touch a different message that inherited the UID.
   */
  private async lockMessage(client: ImapFlow, ref: MessageRef, readOnly: boolean) {
    const { path, uid } = locate(ref);
    const lock = await client.getMailboxLock(path, { readOnly }).catch((err: { mailboxMissing?: boolean }) => {
      throw err?.mailboxMissing ? new MailNotFoundError(`Folder ${path} no longer exists`) : err;
    });
    const parsed = parseProviderMessageId(ref.providerMessageId);
    if (parsed && parsed.path === path && parsed.uidValidity !== openMailbox(client).uidValidity.toString()) {
      lock.release();
      throw new MailNotFoundError(`Message ${ref.providerMessageId} no longer exists (UIDVALIDITY changed)`);
    }
    return { lock, path, uid };
  }

  async fetchBody(ref: MessageRef): Promise<MessageBody> {
    return this.withClient(async (client) => {
      const { lock, path, uid } = await this.lockMessage(client, ref, true);
      try {
        const msg = await client.fetchOne(String(uid), { uid: true, source: true, bodyStructure: true }, { uid: true });
        if (!msg || !msg.source) throw new MailNotFoundError(`Message ${uid} not found in ${path}`);
        const { html, text, invite } = await parseBody(msg.source);
        return { html, text, attachments: attachmentsFromStructure(msg.bodyStructure), ...(invite ? { invite } : {}) };
      } finally {
        lock.release();
      }
    });
  }

  async fetchAttachment(ref: MessageRef, attachmentId: string): Promise<AttachmentContent> {
    if (!/^\d+(\.\d+)*$/.test(attachmentId)) throw new Error(`Invalid attachment id ${attachmentId}`);
    return this.withClient(async (client) => {
      const { lock, path, uid } = await this.lockMessage(client, ref, true);
      try {
        const msg = await client.fetchOne(String(uid), { uid: true, bodyStructure: true }, { uid: true });
        const meta = msg ? attachmentsFromStructure(msg.bodyStructure).find((a) => a.id === attachmentId) : undefined;
        if (!meta) throw new MailNotFoundError(`Attachment ${attachmentId} not found in ${path}:${uid}`);
        const download = await client.download(String(uid), attachmentId, { uid: true });
        if (!download.content) throw new MailNotFoundError(`Attachment ${attachmentId} not found in ${path}:${uid}`);
        return { name: meta.name, mime: meta.mime, content: await readStream(download.content) };
      } finally {
        lock.release();
      }
    });
  }

  /** Refs grouped by folder; refs whose UIDVALIDITY is stale are dropped. */
  private async forEachFolder(client: ImapFlow, refs: MessageRef[], fn: (path: string, uids: number[]) => Promise<void>) {
    const byPath = new Map<string, MessageRef[]>();
    for (const ref of refs) {
      const { path } = locate(ref);
      byPath.set(path, [...(byPath.get(path) ?? []), ref]);
    }
    for (const [path, group] of byPath) {
      const lock = await client.getMailboxLock(path);
      try {
        const validity = openMailbox(client).uidValidity.toString();
        const uids = group
          .filter((ref) => {
            const parsed = parseProviderMessageId(ref.providerMessageId);
            return !parsed || parsed.path !== path || parsed.uidValidity === validity;
          })
          .map((ref) => locate(ref).uid);
        if (uids.length) await fn(path, uids);
      } finally {
        lock.release();
      }
    }
  }

  async setFlags(refs: MessageRef[], flags: { unread?: boolean; pinned?: boolean }): Promise<void> {
    if (!refs.length || (flags.unread === undefined && flags.pinned === undefined)) return;
    await this.withClient((client) =>
      this.forEachFolder(client, refs, async (_path, uids) => {
        const range = compactUidSet(uids);
        if (flags.unread !== undefined) {
          if (flags.unread) await client.messageFlagsRemove(range, ["\\Seen"], { uid: true });
          else await client.messageFlagsAdd(range, ["\\Seen"], { uid: true });
        }
        if (flags.pinned !== undefined) {
          if (flags.pinned) await client.messageFlagsAdd(range, ["\\Flagged"], { uid: true });
          else await client.messageFlagsRemove(range, ["\\Flagged"], { uid: true });
        }
      }),
    );
  }

  async move(refs: MessageRef[], to: FolderRole): Promise<void> {
    if (!refs.length) return;
    await this.withClient(async (client) => {
      const target = await this.folderFor(client, to);
      await this.forEachFolder(client, refs, async (path, uids) => {
        if (path === target) return;
        // imapflow uses UID MOVE when available, else COPY + STORE \Deleted + (UID) EXPUNGE.
        await client.messageMove(compactUidSet(uids), target, { uid: true });
      });
    });
  }

  // ---- own folders -------------------------------------------------------------------------

  async createFolder(name: string): Promise<{ ref: string; state?: { uidValidity: string; uidNext: number } }> {
    return this.withClient(async (client) => {
      const existing = (await client.list()).find((f) => normalizeFolderName(f.name) === normalizeFolderName(name) && f.path.toUpperCase() !== "INBOX");
      if (existing) return { ref: existing.path };
      // imapflow prepends the personal namespace ("INBOX.") and uses the server's delimiter.
      const { path } = await client.mailboxCreate(name);
      const status = await client.status(path, { uidValidity: true, uidNext: true });
      if (!status || status.uidValidity === undefined) return { ref: path };
      return { ref: path, state: { uidValidity: status.uidValidity.toString(), uidNext: status.uidNext ?? 1 } };
    });
  }

  async renameFolder(ref: string, name: string): Promise<string> {
    return this.withClient(async (client) => {
      const folder = (await client.list()).find((f) => f.path === ref);
      if (!folder) throw new MailNotFoundError(`Folder ${ref} no longer exists`);
      const parts = folder.delimiter ? ref.split(folder.delimiter) : [ref];
      parts[parts.length - 1] = name;
      const target = parts.join(folder.delimiter || "");
      const res = await client.mailboxRename(ref, target);
      return res.newPath ?? target;
    });
  }

  async deleteFolder(ref: string): Promise<void> {
    await this.withClient(async (client) => {
      const archive = await this.folderFor(client, "archive");
      const lock = await client.getMailboxLock(ref).catch((err: { mailboxMissing?: boolean }) => {
        if (err?.mailboxMissing) return null;
        throw err;
      });
      if (!lock) return;
      try {
        // Nothing is lost with the folder: what's in it goes to Archive first.
        if (openMailbox(client).exists) await client.messageMove("1:*", archive);
      } finally {
        lock.release();
      }
      await client.mailboxDelete(ref);
    });
  }

  async moveToFolder(refs: MessageRef[], ref: string): Promise<void> {
    if (!refs.length) return;
    await this.withClient((client) =>
      this.forEachFolder(client, refs, async (path, uids) => {
        if (path !== ref) await client.messageMove(compactUidSet(uids), ref, { uid: true });
      }),
    );
  }

  async deleteForever(refs: MessageRef[]): Promise<void> {
    if (!refs.length) return;
    await this.withClient((client) =>
      this.forEachFolder(client, refs, async (_path, uids) => {
        // STORE \Deleted + (UID) EXPUNGE, only for these UIDs.
        await client.messageDelete(compactUidSet(uids), { uid: true });
      }),
    );
  }

  // ---- sending -----------------------------------------------------------------------------

  private async smtpTransport() {
    const smtp = this.account.smtp;
    if (!smtp) throw new Error(`Account ${this.account.id} has no SMTP server`);
    const user = smtp.username || this.account.imap?.username || this.account.email;
    const secret = await this.secret();
    const address = await serverAddress(smtp.host);
    return createTransport({
      host: address.host,
      ...(address.servername ? { servername: address.servername } : {}),
      port: smtp.port,
      secure: smtp.secure,
      requireTLS: !smtp.secure && !isLoopback(smtp.host),
      auth: "accessToken" in secret ? { type: "OAuth2", user, accessToken: secret.accessToken } : { user, pass: secret.pass },
      connectionTimeout: 30_000,
      greetingTimeout: 30_000,
      socketTimeout: 60_000,
      logger: false,
    });
  }

  async send(message: OutgoingMessage): Promise<SentResult> {
    const built = await buildMessage(message);
    const transport = await this.smtpTransport();
    try {
      await transport.sendMail({ envelope: built.envelope, raw: built.raw });
    } catch (err) {
      // Microsoft 365 organisations can turn SMTP off (535 5.7.139): the same message goes through Graph.
      if (this.isMicrosoft() && smtpTurnedOff(err)) {
        await sendWithGraph(this.account, built.sentCopy);
        return { messageIdHeader: built.messageId };
      }
      throw toMailError(err);
    } finally {
      transport.close();
    }

    let sentId: string | undefined;
    if (!smtpAutoSavesSent(this.account.smtp?.host)) {
      // The mail is already out: a failed copy must not fail the send, or a retry would send it twice.
      sentId = await this.appendToSent(built.sentCopy).catch((err: unknown) => {
        console.warn(`[imap] ${this.account.id}: sent, but saving to Sent failed: ${err instanceof Error ? err.message : err}`);
        return undefined;
      });
    }
    return { messageIdHeader: built.messageId, ...(sentId ? { providerMessageId: sentId } : {}) };
  }

  private async appendToSent(raw: Buffer): Promise<string | undefined> {
    return this.withClient(async (client) => {
      let path = this.folders.sent ?? (await this.discoverFolders(client)).sent;
      if (!path) {
        path = (await client.mailboxCreate("Sent")).path;
        this.folders.sent = path;
      }
      const res = await client.append(path, raw, ["\\Seen"], new Date());
      // APPENDUID (UIDPLUS) lets the engine link the sent row to the IMAP copy right away.
      return res && res.uid && res.uidValidity !== undefined ? providerMessageId(res.destination, res.uidValidity.toString(), res.uid) : undefined;
    });
  }

  // ---- drafts ------------------------------------------------------------------------------

  /** A copy in the Drafts folder (flagged \Draft), replacing the previous one. Nothing without a Drafts folder. */
  async saveDraft(message: OutgoingMessage, previous?: string | null): Promise<SavedDraft | null> {
    const built = await buildMessage(message);
    return this.withClient(async (client) => {
      const path = this.folders.drafts ?? (await this.discoverFolders(client)).drafts;
      if (!path) return null;
      // The Bcc stays on the draft (it isn't sent from here), like other clients keep it.
      const res = await client.append(path, built.sentCopy, ["\\Draft", "\\Seen"], new Date());
      if (previous) await this.removeDraft(client, previous).catch(() => {});
      // Without UIDPLUS there's no UID back; the Message-ID finds the copy later.
      const ref =
        res && res.uid && res.uidValidity !== undefined ? providerMessageId(res.destination, res.uidValidity.toString(), res.uid) : `mid:${built.messageId}`;
      // An edited IMAP draft is a new message with a new UID: the ref is its version too.
      return { ref, version: ref };
    });
  }

  async searchOlder(sink: SyncSink, query: string, limit: number): Promise<number> {
    return this.withClient(async (client) => {
      const folders = await this.discoverFolders(client, sink);
      let imported = 0;
      for (const [role, path] of this.syncedFolders(folders)) {
        if (imported >= limit) break;
        const lock = await client.getMailboxLock(path, { readOnly: true });
        try {
          const mailbox = openMailbox(client);
          if (!mailbox.exists) continue;
          const found = (await this.searchUids(client, { text: query }, 1, mailbox.uidNext - 1)) || [];
          const known = new Set(sink.knownUids ? await sink.knownUids(path) : []);
          const fresh = found.filter((uid) => !known.has(uid)).sort((a, b) => b - a).slice(0, limit - imported);
          if (fresh.length) {
            await this.importUids(client, sink, { path, uidValidity: stateOf(mailbox).uidValidity, role }, fresh);
            imported += fresh.length;
          }
        } finally {
          lock.release();
        }
      }
      return imported;
    });
  }

  async listDrafts(known: Map<string, string>, limit: number): Promise<{ drafts: ListedDraft[]; changed: RemoteDraft[] }> {
    return this.withClient(async (client) => {
      const path = this.folders.drafts ?? (await this.discoverFolders(client)).drafts;
      if (!path) return { drafts: [], changed: [] };
      const lock = await client.getMailboxLock(path, { readOnly: true });
      try {
        const mailbox = openMailbox(client);
        if (!mailbox.exists) return { drafts: [], changed: [] };
        const uidValidity = mailbox.uidValidity.toString();
        const listed: RemoteMessage[] = [];
        for await (const msg of client.fetch("1:*", SYNC_FETCH, { uid: false })) {
          if (msg.flags?.has("\\Deleted")) continue;
          listed.push(toRemoteMessage(msg, { path, uidValidity, role: "drafts" }));
        }
        const drafts = listed.map((m) => ({ ref: m.providerMessageId, version: m.providerMessageId, messageIdHeader: m.messageIdHeader ?? null }));
        const changed: RemoteDraft[] = [];
        for (const m of listed) {
          if (changed.length >= limit) break;
          // Known by its UID, or a copy we wrote without one coming back (found by its Message-ID).
          if (known.has(m.providerMessageId) || (m.messageIdHeader && known.has(`mid:${m.messageIdHeader}`))) continue;
          const full = await client.fetchOne(String(m.imapUid), { uid: true, source: true }, { uid: true });
          const body = full && full.source ? await parseBody(full.source) : { html: null, text: null };
          changed.push({
            ref: m.providerMessageId,
            version: m.providerMessageId,
            messageIdHeader: m.messageIdHeader ?? null,
            message: { providerMessageId: m.providerMessageId, imapPath: path, imapUid: m.imapUid },
            providerThreadId: null,
            inReplyTo: m.inReplyTo ?? null,
            to: m.to,
            cc: m.cc,
            bcc: m.bcc,
            subject: m.subject,
            html: body.html,
            text: body.text,
            attachments: m.attachments.filter((a) => !a.inline),
          });
        }
        return { drafts, changed };
      } finally {
        lock.release();
      }
    });
  }

  async deleteDraft(ref: string): Promise<void> {
    await this.withClient((client) => this.removeDraft(client, ref));
  }

  private async removeDraft(client: ImapFlow, ref: string) {
    const parsed = ref.startsWith("mid:") ? null : parseProviderMessageId(ref);
    const path = parsed?.path ?? this.folders.drafts ?? (await this.discoverFolders(client)).drafts;
    if (!path) return;
    const lock = await client.getMailboxLock(path);
    try {
      if (parsed) {
        // A different UIDVALIDITY means the folder was rebuilt: that UID is someone else now.
        if (openMailbox(client).uidValidity.toString() !== parsed.uidValidity) return;
        await client.messageDelete(String(parsed.uid), { uid: true });
      } else {
        const uids = await client.search({ header: { "message-id": ref.slice(4) } }, { uid: true });
        if (uids && uids.length) await client.messageDelete(compactUidSet(uids), { uid: true });
      }
    } finally {
      lock.release();
    }
  }

  // ---- live updates ------------------------------------------------------------------------

  async watch(onChange: () => void): Promise<() => Promise<void>> {
    let stopped = false;
    let client: ImapFlow | null = null;
    let debounce: ReturnType<typeof setTimeout> | null = null;
    let wake: (() => void) | null = null;

    const notify = () => {
      if (stopped || debounce) return;
      debounce = setTimeout(() => {
        debounce = null;
        if (!stopped) onChange();
      }, NOTIFY_DEBOUNCE_MS);
    };
    const sleep = (ms: number) =>
      new Promise<void>((resolve) => {
        const timer = setTimeout(done, ms);
        function done() {
          clearTimeout(timer);
          wake = null;
          resolve();
        }
        wake = done;
      });

    let firstResult: (err: unknown) => void = () => {};
    const first = new Promise<unknown>((resolve) => (firstResult = resolve));

    const loop = async () => {
      let failures = 0;
      let connectedBefore = false;
      while (!stopped) {
        // Signing in may need a fresh token first (Outlook); a failed refresh is a failed connection.
        let options: ImapFlowOptions;
        try {
          options = await this.imapOptions();
        } catch (err) {
          firstResult(err);
          failures = Math.max(failures + 1, err instanceof MailAuthError ? 10 : 0);
          if (!stopped) await sleep(backoffDelay(failures, WATCH_MAX_BACKOFF_MS));
          continue;
        }
        // This connection does nothing but wait, so enter IDLE right away instead of after 15 s.
        const c = new ImapFlow({ ...options, maxIdleTime: IDLE_RESTART_MS, missingIdleCommand: "NOOP", autoIdleDelay: 500 });
        client = c;
        c.on("error", () => {});
        c.on("exists", notify);
        c.on("expunge", notify);
        c.on("flags", notify);
        const closed = new Promise<void>((resolve) => c.once("close", resolve));
        const startedAt = Date.now();
        try {
          await c.connect();
          await c.mailboxOpen("INBOX", { readOnly: true });
          firstResult(null);
          // Whatever happened while we were disconnected is only visible to a sync.
          if (connectedBefore) notify();
          connectedBefore = true;
          // imapflow IDLEs on its own once the connection is quiet and restarts it every maxIdleTime.
          await closed;
          failures = Date.now() - startedAt > WATCH_HEALTHY_MS ? 0 : failures + 1;
        } catch (err) {
          const mapped = toMailError(err);
          firstResult(mapped);
          failures++;
          // Wrong password won't fix itself soon; retry slowly in case it is changed elsewhere.
          if (mapped instanceof MailAuthError) failures = Math.max(failures, 10);
        } finally {
          c.removeAllListeners();
          c.on("error", () => {});
          c.close();
          client = null;
        }
        if (!stopped) await sleep(backoffDelay(failures, WATCH_MAX_BACKOFF_MS));
      }
    };

    const running = loop();
    const stop = async () => {
      if (stopped) return;
      stopped = true;
      this.watchers.delete(stop);
      if (debounce) clearTimeout(debounce);
      wake?.();
      const c = client;
      if (c) {
        const timeout = new Promise<void>((resolve) => setTimeout(resolve, 10_000).unref());
        await Promise.race([c.logout().catch(() => {}), timeout]);
        c.close();
      }
      await running;
    };
    this.watchers.add(stop);

    const firstError = await first;
    if (firstError instanceof MailAuthError) {
      await stop();
      throw firstError;
    }
    return stop;
  }

  async close(): Promise<void> {
    await Promise.all([...this.watchers].map((stop) => stop()));
  }
}
