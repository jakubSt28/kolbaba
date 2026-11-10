import { translate } from "@/lib/i18n";
import type { AttachmentMeta, FolderRole, MailboxCredentials, Person, ServerConfig, SyncState } from "../db/schema";
import type { Invite } from "./ics";

/**
 * Contract between the sync engine and provider adapters (Gmail API, IMAP/SMTP, later Graph).
 * Adapters only speak the provider protocol and emit normalised messages; threading, the database
 * and app-only state live in the sync engine (src/server/sync).
 */

/** What an adapter needs to know about the mailbox. Credentials are already decrypted. */
export interface AdapterAccount {
  id: string;
  email: string;
  fromName: string;
  provider: "gmail" | "imap";
  imap?: ServerConfig | null;
  smtp?: ServerConfig | null;
  folders: Partial<Record<FolderRole, string>>;
  credentials: MailboxCredentials;
  syncState: SyncState;
  /** Persist refreshed OAuth tokens (the engine re-seals them). */
  saveCredentials(credentials: MailboxCredentials): Promise<void>;
}

/** Where a message lives at the provider, enough to change flags or move it. */
export interface MessageRef {
  providerMessageId: string;
  imapPath?: string | null;
  imapUid?: number | null;
}

export interface RemoteMessage extends MessageRef {
  /** Gmail threadId; IMAP adapters leave it empty and the engine threads by headers. */
  providerThreadId?: string;
  messageIdHeader?: string | null;
  inReplyTo?: string | null;
  references: string[];
  from: Person;
  to: Person[];
  cc: Person[];
  bcc: Person[];
  replyTo: Person[];
  subject: string;
  date: Date;
  snippet: string;
  /** Present when the adapter fetched the body during sync (small messages); otherwise lazy. */
  html?: string | null;
  text?: string | null;
  attachments: AttachmentMeta[];
  /** A calendar invitation, when the adapter had its text during sync (otherwise read on first open). */
  invite?: Invite;
  unread: boolean;
  /** Gmail STARRED / IMAP \Flagged. */
  pinned: boolean;
  /** Which special folder it is in (IMAP), or derived from labels (Gmail). Null = some other folder. */
  role: FolderRole | null;
  labels: string[];
  listUnsubscribe?: string | null;
  /** List-Unsubscribe-Post: List-Unsubscribe=One-Click (RFC 8058). */
  listUnsubscribeOneClick?: boolean;
  /** Headers that hint at bulk mail (List-Id, Precedence) — used to classify newsletters. */
  bulk?: boolean;
}

export interface FlagChange extends MessageRef {
  unread?: boolean;
  pinned?: boolean;
  role?: FolderRole | null;
  labels?: string[];
}

/** One of the user's own folders as the provider has it: a Gmail label or an IMAP folder. */
export interface ProviderFolder {
  /** Gmail label id or IMAP path. */
  ref: string;
  /** As the user sees it ("Projects", "Work/Clients"). */
  name: string;
}

/** The sync engine implements this; adapters call it while syncing. */
export interface SyncSink {
  upsertMessages(messages: RemoteMessage[]): Promise<void>;
  updateFlags(changes: FlagChange[]): Promise<void>;
  removeMessages(providerMessageIds: string[]): Promise<void>;
  /** Persist cursors (historyId, uidValidity/modseq) after each successful batch. */
  saveState(patch: Partial<SyncState>): Promise<void>;
  /** Persist detected special-use folders. */
  saveFolders?(folders: Partial<Record<FolderRole, string>>): Promise<void>;
  /** The user's own folders found at the provider (every sync), matched with the ones in the app. */
  syncOwnFolders?(found: ProviderFolder[]): Promise<void>;
  /** IMAP: drop everything cached from one folder (its UIDVALIDITY changed, so old UIDs mean nothing). */
  forgetFolder?(path: string): Promise<void>;
  /** IMAP: UIDs the cache holds for a folder, so a sync without QRESYNC can detect deletions exactly. */
  knownUids?(path: string): Promise<number[]>;
  /** Which of these provider message ids are here already. */
  knownMessages?(providerMessageIds: string[]): Promise<Set<string>>;
}

export interface MessageBody {
  html: string | null;
  text: string | null;
  attachments: AttachmentMeta[];
  /** The calendar invitation, when its text came along (Gmail sends small parts inline). */
  invite?: Invite;
}

export interface AttachmentContent {
  name: string;
  mime: string;
  content: Buffer;
}

export interface OutgoingMessage {
  from: Person;
  to: Person[];
  cc: Person[];
  bcc: Person[];
  subject: string;
  html: string;
  text: string;
  inReplyTo?: string | null;
  references?: string[];
  /** Gmail threadId to keep the reply in the same conversation. */
  providerThreadId?: string | null;
  attachments?: { filename: string; content: Buffer; contentType: string; cid?: string }[];
  headers?: Record<string, string>;
  /** A calendar part (text/calendar; method=…), e.g. the REPLY to an invitation. */
  icalEvent?: { method: string; content: string };
}

/** A draft at the provider: `ref` is what saveDraft/deleteDraft take, `version` changes with every edit. */
export interface SavedDraft {
  ref: string;
  version: string;
}

export interface ListedDraft extends SavedDraft {
  messageIdHeader: string | null;
}

export interface RemoteDraft extends ListedDraft {
  /** The draft's message, to download its attachments. */
  message: MessageRef;
  providerThreadId: string | null;
  inReplyTo: string | null;
  to: Person[];
  cc: Person[];
  bcc: Person[];
  subject: string;
  html: string | null;
  text: string | null;
  /** Files (not inline images). */
  attachments: AttachmentMeta[];
}

export interface SentResult {
  messageIdHeader: string;
  /** Gmail message id / IMAP Sent-folder ref, when known. */
  providerMessageId?: string;
  providerThreadId?: string;
}

/**
 * Thrown when the provider rejects the credentials; the UI shows a reconnect / app-password hint.
 * The message is English with `{placeholders}` (marked with tk()); `text` + `vars` translate it.
 */
export class MailAuthError extends Error {
  /** The English text before its placeholders are filled: the key it's translated by. */
  readonly text: string;
  /** What an IMAP/SMTP server actually answered, for the logs: "wrong password" is only our reading of it. */
  serverReply?: string;

  constructor(
    message: string,
    /** "scope_denied": the user unticked Gmail access on Google's consent screen. */
    public reason: "app_password_required" | "oauth_revoked" | "invalid_credentials" | "imap_disabled" | "scope_denied",
    public vars?: Record<string, string>,
  ) {
    super(translate("en", message, vars));
    this.text = message;
    this.name = "MailAuthError";
  }
}

export interface MailAdapter {
  /** Log in / call a cheap endpoint. Throws MailAuthError on bad credentials. */
  verify(): Promise<void>;
  /** Import recent mail (newest first) down to `since`, then set cursors. */
  initialSync(sink: SyncSink, opts: { since: Date }): Promise<void>;
  /** Apply everything that changed since the saved cursors. */
  incrementalSync(sink: SyncSink): Promise<void>;
  /**
   * Import up to `limit` messages older than everything imported so far (the history behind the first
   * import), newest first, keeping its own cursor in the sync state. Resolves true once nothing is left.
   */
  importOlder?(sink: SyncSink, opts: { limit: number }): Promise<boolean>;
  /**
   * Keep a live connection and call `onChange` when the mailbox changes (IMAP IDLE).
   * Gmail has no live connection (push comes via Pub/Sub), so it doesn't implement this.
   * Returns a stop function.
   */
  watch?(onChange: () => void): Promise<() => Promise<void>>;
  fetchBody(ref: MessageRef): Promise<MessageBody>;
  fetchAttachment(ref: MessageRef, attachmentId: string): Promise<AttachmentContent>;
  setFlags(refs: MessageRef[], flags: { unread?: boolean; pinned?: boolean }): Promise<void>;
  /** Move to a special folder: archive, back to inbox, trash, spam. */
  move(refs: MessageRef[], to: FolderRole): Promise<void>;
  /**
   * Delete for good (from Trash or Spam). Gmail doesn't implement it: permanent deletion needs the full
   * `https://mail.google.com/` scope, and Gmail empties its Trash after 30 days on its own.
   */
  deleteForever?(refs: MessageRef[]): Promise<void>;
  /** Send and make sure a copy lands in Sent (Gmail does it itself; IMAP appends). */
  send(message: OutgoingMessage): Promise<SentResult>;
  /**
   * Mirror a draft into the provider's drafts (Gmail drafts, the IMAP Drafts folder) so other clients
   * see it. Replaces `previous` when given. Returns the new ref, or null when there's nowhere to put it.
   */
  saveDraft?(message: OutgoingMessage, previous?: string | null): Promise<SavedDraft | null>;
  /**
   * The provider's drafts, for drafts started in other clients: every draft's ref and version, and
   * the contents of those whose version isn't in `known` (ref → version), up to `limit` of them.
   */
  listDrafts?(known: Map<string, string>, limit: number): Promise<{ drafts: ListedDraft[]; changed: RemoteDraft[] }>;
  /**
   * Mail matching `query` at the provider that isn't here yet (the history import hasn't got to it),
   * imported now, at most `limit` messages. Returns how many came in.
   */
  searchOlder?(sink: SyncSink, query: string, limit: number): Promise<number>;
  /** Remove a mirrored draft (sent or discarded here). Gone already is fine. */
  deleteDraft?(ref: string): Promise<void>;
  /**
   * Own folders. Create one (an existing one of that name is fine): its ref, and for IMAP its state
   * right after creation, so a sync picks up everything moved in rather than only recent mail.
   */
  createFolder?(name: string): Promise<{ ref: string; state?: { uidValidity: string; uidNext: number } }>;
  /** Rename; returns the new ref (IMAP paths change, Gmail label ids don't). */
  renameFolder?(ref: string, name: string): Promise<string>;
  /** Delete the folder. Its mail goes to Archive (Gmail: the label goes, the mail stays in All Mail). */
  deleteFolder?(ref: string): Promise<void>;
  /** Into an own folder, out of Inbox and the other own folders (`leave`: their refs, for Gmail). */
  moveToFolder?(refs: MessageRef[], ref: string, leave: string[]): Promise<void>;
  /** Gmail: take own-folder labels off (a move to Inbox or Archive leaves them on otherwise). */
  leaveFolders?(refs: MessageRef[], folderRefs: string[]): Promise<void>;
  /**
   * Gmail: the app's "Snoozed" label on or off these messages, made under `name` if there's no `id`
   * yet (or it was deleted in Gmail). Returns the label's id to keep.
   */
  labelSnoozed?(refs: MessageRef[], on: boolean, label: { id?: string; name: string }): Promise<string | undefined>;
  /** Gmail: the signature set up in Gmail for this address (HTML), or null without one. */
  signature?(): Promise<string | null>;
  close(): Promise<void>;
}

/** The message is gone at the provider (deleted or moved by another client since the last sync). */
export class MailNotFoundError extends Error {
  constructor(message = "This message no longer exists") {
    super(message);
    this.name = "MailNotFoundError";
  }
}
