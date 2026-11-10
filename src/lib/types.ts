export type MailboxIconName =
  | "mail"
  | "user"
  | "briefcase"
  | "home"
  | "heart"
  | "star"
  | "rocket"
  | "coffee"
  | "sparkles"
  | "globe"
  | "shopping-bag"
  | "graduation-cap"
  | "plane"
  | "palette"
  | "code"
  | "leaf";

export type Provider = "gmail" | "seznam" | "imap";

export interface Account {
  id: string;
  name: string;
  email: string;
  provider: Provider;
  /** Hue (0–360) driving the mailbox colour in both themes. */
  hue: number;
  icon: MailboxIconName;
  /** Custom picture shown instead of the icon (a URL; a data: URL in the prototype). */
  image?: string | null;
  signature: string;
  /** Live mode: sync health; "auth_error" shows a Reconnect prompt. */
  status?: "ok" | "syncing" | "auth_error" | "error";
  statusMessage?: string | null;
  /** Live mode: exposed to connected MCP agents (older setting; each agent now has its own mailboxes). */
  mcpEnabled?: boolean;
  /** Which new mail in it may notify. "all" unless set. */
  notify?: NotifyMode;
  /** Live mode: all older mail is imported too (it continues in the background after the first import). */
  historyComplete?: boolean;
}

export interface Person {
  name: string;
  email: string;
}

export interface Attachment {
  name: string;
  size: string;
  kind: "pdf" | "image" | "doc" | "sheet" | "zip" | "calendar";
  /** Live mode: download URL. */
  url?: string;
  /** The browser shows this file itself; anything else can only be downloaded. */
  opensInBrowser?: boolean;
}

/** Someone in the address book (src/server/contacts.ts). */
export interface Contact {
  id: string;
  name: string;
  /** The first is the one to write to. */
  emails: string[];
  phone: string;
  company: string;
  jobTitle: string;
  links: string[];
  note: string;
  /** Their mail notifies even in quiet hours and in mailboxes set to "Only VIPs". */
  vip?: boolean;
  lastContactedAt?: number;
}

export interface ContactDetail extends Contact {
  /** Recent conversations with them, across mailboxes. */
  threads: { id: string; accountId: string; subject: string; snippet: string; lastMessageAt: number; folder: string }[];
  /** Read from their latest signatures, not saved yet. */
  hints: { phones: string[]; links: string[]; company: string | null };
}

/** Files: one attachment, with the email it came in (src/server/mail/files.ts). */
export interface FileItem extends Attachment {
  /** messageId:attachmentId */
  id: string;
  messageId: string;
  threadId: string;
  accountId: string;
  date: number;
  from: Person;
  subject: string;
  /** Sent by the user. */
  outgoing: boolean;
}

export type FileKindFilter = "all" | "image" | "pdf" | "doc" | "sheet" | "zip";

export interface Message {
  id: string;
  from: Person;
  to: Person[];
  cc?: Person[];
  date: number;
  html: string;
  /** Live mode: plain-text preview; the body (html) is loaded when the thread is opened. */
  snippet?: string;
  bodyLoaded?: boolean;
  /** Remote images held back until the user allows them (blocks tracking pixels). */
  blockedImages?: number;
  /** The server allowed remote content for this body (setting, "Show images" or our own sent mail). */
  remoteImages?: boolean;
  trackers?: string[];
  /** Hidden images that would have told the sender when it was opened, removed (known services and unknown 1×1 pixels). */
  spyPixels?: number;
  /** Links whose tracking parameters (utm_…, mc_eid…) were taken off. */
  cleanedLinks?: number;
  /** From someone not in the address book (never written to): the reader shows the whole address, even on the phone. */
  stranger?: boolean;
  /** The sender's name holds another email address than the one it came from ("PayPal <service@paypal.com>" from elsewhere). */
  nameMismatch?: boolean;
  attachments?: Attachment[];
  /** The calendar invitation in it, once read (at sync or when first opened). */
  invite?: InviteEvent;
  /** Outgoing only: a tracking pixel was embedded, see lib/tracking.ts. */
  tracked?: boolean;
  opens?: OpenEvent[];
}

export interface OpenEvent {
  at: number;
  client: string;
  /** Fetched by Apple's Mail Privacy Protection proxy — proves delivery, not reading. */
  viaApple?: boolean;
}

export type ThreadFolder = "inbox" | "archive" | "sent" | "scheduled" | "trash" | "spam";

export interface Thread {
  id: string;
  accountId: string;
  subject: string;
  messages: Message[];
  unread: boolean;
  pinned: boolean;
  folder: ThreadFolder;
  snoozedUntil?: number;
  /** A snooze ran out at this time: Inbox sorts the conversation as if it had just arrived. */
  wokeAt?: number;
  scheduledAt?: number;
  /** Remind me if nobody replies by this time. */
  followUpAt?: number;
  /** When the user last wrote in it: Sent lists every conversation they wrote in, by this. */
  sentAt?: number;
  /** Sender domain used to fetch a logo for companies. */
  logo?: string;
  kind?: "person" | "newsletter" | "notification";
  /** A warm letter: someone in the address book (people you've written to, or added) wrote in it. */
  warm?: boolean;
  /** Live mode: List-Unsubscribe header for one-click unsubscribe. */
  listUnsubscribe?: string | null;
  /** Its https unsubscribe address works in one click (RFC 8058). */
  listUnsubscribeOneClick?: boolean;
  /** When the user left the list from here. */
  unsubscribedAt?: number;
  /** Live mode: scheduled sends are outbox entries; this is the entry to cancel. */
  outboxId?: string;
  /** Smart categories: what the conversation is about (an order, a trip…), merged from its emails. */
  insight?: Insight;
  /** Screener: the first email from someone new, waiting for a yes or no. */
  screening?: boolean;
  /** One of the user's own folders it lives in. */
  folderId?: string | null;
  /** Muted: new replies skip Inbox (archived and read) and don't notify. */
  muted?: boolean;
  /** The user's private note on it; only in Kolbaba, never sent. */
  note?: string;
  /** No reply yet: the user's last email in it waits for an answer (set by the server's "unanswered" list). */
  awaiting?: boolean;
  /** "Notify me of replies": the next replies notify whatever the mailbox's setting and quiet hours. */
  watched?: boolean;
}

/** One of the user's own folders, across mailboxes (a Gmail label or an IMAP folder at each). */
export interface MailFolder {
  id: string;
  name: string;
  /** 0–360, drawn like mailbox colours. */
  hue: number;
  /** Mailboxes where it already exists at the provider. */
  accountIds: string[];
  /** Unread conversations in it, per mailbox. */
  unread?: Record<string, number>;
  /** All conversations in it, per mailbox. */
  count?: Record<string, number>;
}

/* ---------------------------- Smart categories ---------------------------- */

export type InsightCategory = "order" | "travel" | "invoice" | "subscription" | "security" | "reply";

export type OrderStatus =
  | "placed"
  | "paid"
  | "shipped"
  | "out_for_delivery"
  | "ready_for_pickup"
  | "delivered"
  | "cancelled"
  | "returned"
  | "refunded";

/**
 * What an order, trip, invoice or subscription email says, pulled out by rules (schema.org) or AI.
 * Dates are ISO strings as the email states them ("2026-10-24" or "2026-11-14T07:05", local time).
 */
export interface Insight {
  category: InsightCategory;
  /** The same order / booking / invoice / service across several emails. */
  key: string;
  /** Shop, airline, supplier or service. */
  merchant: string | null;
  amount: number | null;
  /** ISO 4217, e.g. "CZK". */
  currency: string | null;
  /** Date of the latest email it comes from (ms). */
  at: number;
  /** Why it's in this category, in a few words ("amount 1 290 Kč, due 25 Oct"). Older readings don't say. */
  why?: string | null;
  /** When the user marked it done: the order arrived or was picked up, the bill is paid (ms). */
  doneAt?: number | null;
  order?: {
    number: string | null;
    /** What was bought, in a few words ("Tom Tailor hoodie", "3 items"). */
    item?: string | null;
    /** "seller": the user sold it (Vinted, Aukro…) and the statuses are about the buyer's parcel. */
    role?: "buyer" | "seller" | null;
    status: OrderStatus | null;
    carrier: string | null;
    trackingNumber: string | null;
    trackingUrl: string | null;
    expectedAt: string | null;
    /** Last day to collect it from a pickup point or box. */
    pickupBy?: string | null;
    returnBy: string | null;
  };
  travel?: {
    kind: "flight" | "train" | "bus" | "hotel" | "rental" | "event" | "other";
    from: string | null;
    to: string | null;
    startsAt: string | null;
    endsAt: string | null;
    bookingCode: string | null;
  };
  invoice?: {
    number: string | null;
    /**
     * The email asks the user to pay it themselves (bank transfer, QR code, a Pay button). False for
     * receipts and for bills paid by card, direct debit or SIPO. Null: older readings that didn't say.
     */
    toPay?: boolean | null;
    dueAt: string | null;
    status: "due" | "paid" | "overdue" | null;
    variableSymbol: string | null;
  };
  subscription?: {
    period: "weekly" | "monthly" | "yearly" | null;
    renewsAt: string | null;
    trialEndsAt: string | null;
    status: "active" | "trial" | "cancelled" | "payment_failed" | null;
  };
  /** A security notice: a new sign-in, a changed password, 2-step verification… (not sign-in codes). */
  security?: {
    kind: "sign_in" | "password" | "two_factor" | "device" | "suspicious" | "other";
    /** "Windows · Chrome", "iPhone 16". */
    device: string | null;
    /** "Brno, Czechia" as the email says it. */
    location: string | null;
    /** The service's own "review activity" / "secure your account" link, if the email has one. */
    actionUrl: string | null;
  };
  /** Someone asks the user something (smart categories with "Awaiting my reply" on). */
  reply?: {
    /** What they want, in a few words. */
    ask: string;
    /** A deadline the email gives. */
    dueAt: string | null;
  };
}

export interface Draft {
  id: string;
  accountId: string;
  to: string;
  cc: string;
  subject: string;
  html: string;
  /** When set, this draft is a reply inside an existing thread. */
  threadId?: string;
  updatedAt: number;
  /** Set when an AI agent wrote this draft through MCP. */
  agentId?: string;
  /** Files attached so far (pasted images are `inline`). */
  attachments?: DraftAttachment[];
}

/** An AI summary of a conversation (src/server/insights/summary.ts), in the reader's language. */
export interface ThreadSummary {
  /** Two or three sentences: what it's about and where it stands. */
  summary: string;
  /** Decisions, numbers, dates worth seeing at a glance. */
  points: string[];
  /** What someone is waiting for from the user, if anything. */
  asks: string[];
}

/** A calendar invitation in a message (src/server/mail/invites.ts). */
/** A calendar invitation's event, as the list and the reader show it. */
export interface InviteEvent {
  /** REQUEST (an invitation), CANCEL, PUBLISH, REPLY… */
  method: string;
  summary: string;
  location: string;
  /** ISO for timed events, YYYY-MM-DD for all-day ones. */
  start: string | null;
  end: string | null;
  allDay: boolean;
  organizer: { name: string; email: string } | null;
  /** The link that joins the call (Teams, Google Meet, Zoom…). */
  joinUrl: string | null;
}

export interface InviteInfo extends InviteEvent {
  attendees: number;
  status: "ACCEPTED" | "TENTATIVE" | "DECLINED" | null;
  canReply: boolean;
}

export interface Snippet {
  id: string;
  name: string;
  html: string;
}

export interface DraftAttachment {
  id: string;
  name: string;
  size: number;
  mime: string;
  inline?: boolean;
}

/** Forwarding: the forwarded email's files, copied into the draft (POST /api/drafts/[id]/attachments/from-message). */
export interface ForwardedFiles {
  attachments: DraftAttachment[];
  /** Pictures in the forwarded text: their address in the email → their address in the draft. */
  images: Record<string, string>;
  /** Files that couldn't come along: too big for one email, or the mail server didn't hand them over. */
  failed: { name: string; reason: "too_large" | "unavailable" }[];
}

/* ------------------------------ Notifications ------------------------------ */

/** Which new mail in a mailbox may notify: everything, people only (no newsletters or automatic mail), VIPs only, or nothing. */
export type NotifyMode = "all" | "people" | "vip" | "none";
export const NOTIFY_MODES: NotifyMode[] = ["all", "people", "vip", "none"];

/** What the number on the app icon counts. */
export type BadgeMode = "all" | "people" | "none";
export const BADGE_MODES: BadgeMode[] = ["all", "people", "none"];

/** No notifications between `from` and `to` ("22:00", "07:00") in the user's time zone. */
export interface QuietHours {
  on: boolean;
  from: string;
  to: string;
  /** IANA zone, e.g. "Europe/Prague" (the server has to know whose night it is). */
  tz: string;
}

/* ---------------------------------- Rules ---------------------------------- */

/** What a rule does with new mail it matches; "inbox" leaves it there (read, or just without a notification). */
export type RuleAction = "folder" | "archive" | "trash" | "inbox";

/** "Always do this" for new mail (src/server/mail/rules.ts). Matched mail never notifies. */
export interface MailRule {
  id: string;
  /** One mailbox, or null for all. */
  accountId: string | null;
  /** Sender address, or "@domain" for everyone there; empty = anyone. */
  from: string;
  /** Words the subject contains; empty = any subject. */
  subject: string;
  action: RuleAction;
  folderId: string | null;
  markRead: boolean;
  /** Emails it took care of so far, and when it last did. */
  applied: number;
  lastAppliedAt: number | null;
}

/** Kolbaba offers a rule: the user filed this sender's mail into this folder by hand a few times. */
export interface RuleSuggestion {
  /** Address, or "@domain". */
  sender: string;
  name: string;
  folderId: string;
}

/* ------------------------------- Newsletters ------------------------------- */

/** One sender of newsletters over the last three months (src/server/mail/lists.ts). */
export interface MailingList {
  /** Lowercase address. */
  email: string;
  name: string;
  /** Company domain for its logo. */
  logo: string | null;
  /** Emails in the last 90 days, and in the last 30. */
  total: number;
  recent: number;
  /** How many of them were opened (read). */
  read: number;
  lastAt: number;
  lastSubject: string;
  /** Conversations from them still in Inbox. */
  inInbox: number;
  /** The newest conversation that says how to leave (one click or an email), if any. */
  unsubscribeThreadId: string | null;
  /** When the user left the list here. */
  unsubscribedAt: number | null;
  /** The newest conversation from them, to look at. */
  latestThreadId: string;
}

/* ------------------------------ Out of office ------------------------------ */

/**
 * An out-of-office reply the user keeps (src/server/mail/away.ts, src/lib/away.ts). There can be several
 * ("Holiday", "Conference"): each on for some mailboxes, or saved and off, ready for next time.
 */
export interface AwayReply {
  id: string;
  /** What the user calls it; empty = "Out of office". */
  name: string;
  /** Answering (from `from` until `until`) in its mailboxes. Off: kept for next time. */
  on: boolean;
  /** From when (ms); null = from the moment it's turned on. */
  from: number | null;
  /** Until when (ms, the end of that day); null = until turned off. */
  until: number | null;
  subject: string;
  /** Plain text. */
  message: string;
  /** The mailboxes it answers in. A mailbox answers with one reply at a time. */
  accountIds: string[];
  /** Only people the user has written to before (the address book): strangers and lists get nothing. */
  onlyKnown: boolean;
}

/** The single reply from before there could be several (settings.away, 19 Oct 2026). */
export type LegacyAwayReply = Omit<AwayReply, "id" | "name" | "accountIds"> & { accountIds: string[] | null };

/* ------------------------------- My history ------------------------------- */

export type HistoryKind =
  | "archived"
  | "deleted"
  | "spam"
  | "inbox"
  | "restored"
  | "not_spam"
  | "filed"
  | "snoozed"
  | "unsnoozed"
  | "pinned"
  | "unpinned"
  | "deleted_forever"
  | "emptied"
  | "muted"
  | "unmuted"
  | "blocked";

/** One thing the user did to their mail, kept 30 days (src/server/history.ts). */
export interface HistoryEntry {
  id: string;
  at: number;
  kind: HistoryKind;
  /** The first conversation's subject. */
  subject: string;
  count: number;
  threadIds: string[];
  /** folder (name), until (ms), bin ("trash" | "spam"). */
  data: Record<string, string | number>;
  undoable: boolean;
  undone: boolean;
}

/* ------------------------------- MCP agents ------------------------------- */

export type AgentPermission = "read" | "draft" | "full";

/** An MCP client the user connected (identified by OAuth client registration + MCP clientInfo). */
export interface Agent {
  id: string;
  name: string;
  app: string;
  /** Domain used to show the client's logo. */
  logo: string;
  permission: AgentPermission;
  /** The mailboxes it may see. */
  accountIds: string[];
  enabled: boolean;
  lastActiveAt: number;
}

export type AgentAction = "search" | "list" | "read" | "draft" | "send" | "schedule" | "archive" | "mark_read" | "snooze" | "pin" | "trash" | "unsubscribe" | "note" | "screen";

/** One run of an agent, titled with the intent the agent passes along with its tool calls. */
export interface AgentSession {
  id: string;
  agentId: string;
  title: string;
}

export interface AgentEvent {
  id: string;
  sessionId: string;
  at: number;
  action: AgentAction;
  /** Short English sentence; **bold** marks the object of the action. Older steps have only this. */
  summary: string;
  /** What was done, as data; the app phrases it in the reader's language (src/lib/agent-steps.ts). */
  step?: AgentStep;
  accountId?: string;
  threadId?: string;
  undoable?: boolean;
  undone?: boolean;
}

/** Dates are ISO 8601. `to` is the first recipient, `more` how many others. */
export type AgentStep =
  | { kind: "searched"; query: string }
  | { kind: "mailboxes" }
  | { kind: "listed"; folder: string }
  | { kind: "read" | "edited_draft" | "deleted_draft"; subject: string }
  | { kind: "drafted_reply"; who: string }
  | { kind: "drafted"; subject: string | null }
  | { kind: "sent" | "scheduled"; subject: string; to: string; more: number; at?: string }
  | { kind: "archived" | "moved_to_inbox" | "marked_read" | "marked_unread" | "pinned" | "unpinned"; subject: string }
  | { kind: "snoozed"; subject: string; until: string }
  | { kind: "filed"; subject: string; folder: string }
  | { kind: "trashed" | "unsubscribed" | "noted"; subject: string }
  | { kind: "reminder"; subject: string; at: string | null }
  | { kind: "screened"; who: string; allowed: boolean }
  | { kind: "attachment"; name: string };

export type FolderId =
  | "inbox"
  // No reply yet: the user's emails nobody answered (src/server/mail/unanswered.ts).
  | "unanswered"
  | "pinned"
  | "snoozed"
  | "scheduled"
  | "drafts"
  | "sent"
  | "archive"
  | "trash"
  | "spam"
  // Smart categories: views across folders (Inbox and Archive), filtered by the mailbox like everything else.
  | "orders"
  | "travel"
  | "invoices"
  | "subscriptions"
  | "security"
  | "replies"
  // Screener: first emails from new senders, waiting for a yes or no.
  | "screener"
  // Files: every attachment, across folders (src/components/files-view.tsx).
  | "files"
  // The address book (src/components/contacts.tsx).
  | "contacts"
  // Newsletters: who sends what and how much of it gets read, to leave several at once (src/components/lists-view.tsx).
  | "lists"
  // One of the user's own folders.
  | `folder:${string}`;

/** "all" = unified inbox across every connected account. */
export type MailboxScope = "all" | string;

export type Tab =
  | { id: string; kind: "thread"; threadId: string; preview: boolean }
  | { id: string; kind: "draft"; draftId: string; preview: false }
  /** `email`: an address to start from (the one they signed up with), already being looked up. */
  | { id: string; kind: "add-account"; preview: false; email?: string }
  | { id: string; kind: "activity"; preview: false }
  | { id: string; kind: "contact"; contactId: string; preview: false };

export type Density = "comfortable" | "compact";

/** Light, dark, or following the system. */
export type Theme = "auto" | "light" | "dark";

/** What a swipe on a list row does (phone and tablet). Set per direction in Settings. */
export type SwipeAction = "archive" | "trash" | "pin" | "read" | "snooze" | "none";
export const SWIPE_ACTIONS: SwipeAction[] = ["archive", "trash", "pin", "read", "snooze", "none"];

export type { Accent } from "./brand";
