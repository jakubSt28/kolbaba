import { sql } from "drizzle-orm";
import type { Accent } from "@/lib/brand";
import type { SidebarLayout } from "@/lib/sidebar-layout";
import {
  bigint,
  boolean,
  customType,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { AttendeeStatus, CalendarSettings, CalendarSourceKind, EventAttendee } from "@/lib/calendar/types";
import type { AgentStep, AwayReply, BadgeMode, HistoryKind, Insight, InsightCategory, LegacyAwayReply, NotifyMode, QuietHours, RuleAction, ThreadSummary } from "@/lib/types";
import type { Sealed } from "../crypto";
import type { Invite } from "../mail/ics";

export type InsightData = Omit<Insight, "key" | "at" | "category">;

/**
 * Multi-tenant from day one: every row that belongs to someone carries `userId`, and every query in
 * the data layer filters by it. Mail content is a cache of the provider (Gmail / IMAP stay the source
 * of truth); app-only state (pins sync back, but snooze, scheduling, follow-ups, tracking) lives here.
 */

const id = (prefix: string) =>
  text()
    .primaryKey()
    .$defaultFn(() => `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`);

const createdAt = () => timestamp({ withTimezone: true, mode: "date" }).notNull().defaultNow();
const ts = () => timestamp({ withTimezone: true, mode: "date" });

const tsvector = customType<{ data: string }>({ dataType: () => "tsvector" });
const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });

export type Person = { name: string; email: string };

export type AttachmentMeta = {
  id: string;
  name: string;
  size: number;
  mime: string;
  /** Content-ID for inline images (cid: references in the HTML). */
  cid?: string;
  inline?: boolean;
};

export type UserSettings = {
  density?: "comfortable" | "compact";
  accent?: Accent;
  trackByDefault?: boolean;
  /** The mailbox the app opens in: an account id. Not set, or "all": all of them. */
  openMailbox?: string;
  /** Load remote images in incoming mail without asking. Off by default (blocks tracking pixels). */
  loadRemoteImages?: boolean;
  /** Why images are hidden was explained (once, on the first email with blocked images), or the user chose in Settings. */
  imagesExplained?: boolean;
  undoSendSeconds?: number;
  /** Light, dark, or following the system ("auto", the default). */
  theme?: "auto" | "light" | "dark";
  /** Smart categories: order, travel, invoice and subscription emails are read by AI. Off until turned on. */
  smartCategories?: boolean;
  /** Smart categories also read emails from people, to show who waits for an answer. Off until turned on. */
  replyReminders?: boolean;
  /** The first email from someone new waits for a yes or no before it reaches Inbox. Off until turned on. */
  screener?: boolean;
  /** "Summarize" in long conversations (sent to OpenAI only when pressed). On unless turned off. */
  summaries?: boolean;
  /** When the screener was turned on (ms): everyone with mail from before then counts as known. */
  screenerSince?: number;
  /** How the sidebar is arranged (src/lib/sidebar-layout.ts). */
  sidebar?: SidebarLayout;
  /** The newest release note this user has seen (src/lib/whats-new.ts). */
  newsSeen?: string;
  /** Features tried, for tips (src/lib/whats-new.ts). */
  tried?: string[];
  /** When the last tip card was shown (ms). */
  tipShownAt?: number;
  /** The "how likely are you to recommend Kolbaba" question was last shown (ms). */
  npsAskedAt?: number;
  /** The "sign in with a passkey next time?" offer was last shown (ms). */
  passkeyOfferedAt?: number;
  /** Kolbaba's stamp album (src/lib/stamps.ts): when each stamp was earned (ms). */
  stamps?: Record<string, number>;
  /** Counts towards stamps: newsletters left, senders turned away, conversations filed. */
  stampCounts?: Record<string, number>;
  /** Days with an empty Inbox in the last week, for Clean Week ("2026-10-13"). */
  zeroDays?: string[];
  /** Postcards collected, by village and season ("Horní Lhota|winter" → "2026-12-21T16", the day and hour it came). */
  postcards?: Record<string, string>;
  /** Stamps turned off in Settings: no album, no "new stamp" cards. */
  stampsOff?: boolean;
  /** When the album was last looked at (ms): stamps newer than that are marked new. */
  stampsSeen?: number;
  /** The last "new stamp" card (ms): at most one a day. */
  stampShownAt?: number;
  /** The address book has taken in sent mail up to here (ms; worker-managed, src/server/contacts.ts). */
  contactsScannedAt?: number;
  /** Swipe on a list row (phone, tablet): finger moving left / right. */
  swipeLeft?: "archive" | "trash" | "pin" | "read" | "snooze" | "none";
  swipeRight?: "archive" | "trash" | "pin" | "read" | "snooze" | "none";
  /** App language: "auto" follows the browser. */
  language?: "auto" | "en" | "cs";
  /** The language the app resolved to (for notifications, which can't ask the browser). */
  locale?: "en" | "cs";
  /** No notifications in these hours (mail still arrives); VIPs and watched conversations come through. */
  quietHours?: QuietHours;
  /** What the number on the app icon counts. "all" unless set. */
  badge?: BadgeMode;
  /** Newsletters and automatic mail fold into one row each in Inbox. Off unless turned on. */
  bundles?: boolean;
  /** A sign-in code shows in the notification itself (readable on a locked screen). On unless turned off. */
  codeInNotification?: boolean;
  /** Out-of-office replies Kolbaba sends while the user is away (src/server/mail/away.ts). */
  awayReplies?: AwayReply[];
  /** The single reply from before there could be several; read as the first of `awayReplies` until those are saved. */
  away?: LegacyAwayReply;
  /** The calendar: when it was first opened, the view, reminders (src/lib/calendar/types.ts). */
  calendar?: CalendarSettings;
};

/* -------------------------------- Feedback -------------------------------- */

/** What people tell us from inside the app: the occasional 0–10 question and ideas for features. */
export const feedback = pgTable(
  "feedback",
  {
    id: id("fbk"),
    // Goes with the account, as the privacy policy promises (the copy emailed to the team stays there).
    userId: text().references(() => users.id, { onDelete: "cascade" }),
    kind: text().$type<"nps" | "idea">().notNull(),
    /** 0–10 for nps. */
    score: integer(),
    text: text().notNull().default(""),
    /** The user is fine with a reply by email. */
    contact: boolean().notNull().default(false),
    locale: text(),
    /** "iPhone · Safari", for context. */
    device: text(),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.kind, t.createdAt)],
);

/* -------------------------------- Waitlist -------------------------------- */

/** People who asked for a copy to run on their own server (src/server/selfhost-request.ts); for the admin page. Kept 3 years. */
export const waitlist = pgTable("waitlist", {
  id: id("wtl"),
  /** Lower case: asking twice updates the one row, so the list counts people. */
  email: text().notNull().unique(),
  runsOn: text().$type<"vps" | "home" | "unsure">().notNull(),
  note: text().notNull().default(""),
  lang: text().notNull(),
  /** Where the link they came through said they came from (?ref=tt). The first one stays. */
  ref: text(),
  createdAt: createdAt(),
});

/* ------------------------------ Feature usage ------------------------------ */

/** How often each part of the app was used, per user and day (src/lib/usage.ts); for the admin page. Kept 12 months. */
export const featureUsage = pgTable(
  "feature_usage",
  {
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    feature: text().notNull(),
    day: date({ mode: "string" }).notNull(),
    count: integer().notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.userId, t.feature, t.day] }), index().on(t.day)],
);

/* ----------------------------- Tracking blocked ---------------------------- */

/**
 * Emails whose tracking pixels we held back, once each, when they were opened here: the counter on
 * Kolbaba's postcard ("this week I didn't let 37 emails see when you open them"). No link to the
 * message itself, so the count stays when mail is deleted.
 */
export const trackerBlocks = pgTable(
  "tracker_blocks",
  {
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    messageId: text().notNull(),
    at: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.messageId] }), index().on(t.userId, t.at)],
);

/* ------------------------------ Rate limiting ------------------------------ */

/** Fixed-window attempt counters (src/server/rate-limit.ts). */
export const rateLimits = pgTable("rate_limits", {
  key: text().primaryKey(),
  windowStart: ts().notNull(),
  count: integer().notNull().default(0),
});

/* --------------------------------- Users ---------------------------------- */

export const users = pgTable("users", {
  id: id("usr"),
  email: text().notNull().unique(),
  name: text().notNull().default(""),
  avatarUrl: text(),
  settings: jsonb().$type<UserSettings>().notNull().default({}),
  createdAt: createdAt(),
  /**
   * Kolbaba Plus (src/lib/plus.ts): the AI features. The 14-day trial starts the first time one is
   * used; a gift comes from /admin; a subscription is mirrored from Stripe (src/server/billing.ts).
   */
  trialStartedAt: ts(),
  plusGiftedAt: ts(),
  stripeCustomerId: text().unique(),
  stripeSubscriptionId: text(),
  /** Stripe's status: "active", "trialing" and "past_due" keep Plus on. */
  subscriptionStatus: text(),
  subscriptionInterval: text().$type<"month" | "year">(),
  /** The end of the paid period: the next charge, or the last day when cancelled. */
  subscriptionPeriodEnd: ts(),
  subscriptionCancelsAtEnd: boolean().notNull().default(false),
});

/** WebAuthn credentials (Face ID / Touch ID / security keys). */
export const passkeys = pgTable(
  "passkeys",
  {
    /** Credential ID, base64url. */
    id: text().primaryKey(),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    publicKey: text().notNull(),
    counter: bigint({ mode: "number" }).notNull().default(0),
    transports: jsonb().$type<string[]>().notNull().default([]),
    deviceType: text().notNull().default("singleDevice"),
    backedUp: boolean().notNull().default(false),
    /** Shown in settings, e.g. "iPhone" guessed from the user agent. */
    label: text().notNull().default("Passkey"),
    createdAt: createdAt(),
    lastUsedAt: ts(),
  },
  (t) => [index().on(t.userId)],
);

/** Third-party sign-in to the app itself (Google). Not to be confused with mailbox OAuth. */
export const identities = pgTable(
  "identities",
  {
    provider: text().notNull(),
    subject: text().notNull(),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    email: text().notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.provider, t.subject] })],
);

export const sessions = pgTable(
  "sessions",
  {
    /** sha256 of the cookie token. */
    id: text().primaryKey(),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: ts().notNull(),
    userAgent: text(),
    createdAt: createdAt(),
    lastSeenAt: ts(),
    /** The user confirmed it's them again (passkey) — required shortly before deleting the account. */
    reauthAt: ts(),
  },
  (t) => [index().on(t.userId)],
);

/** Short-lived WebAuthn / OAuth state, keyed by a random id stored in a cookie. */
export const authChallenges = pgTable("auth_challenges", {
  id: text().primaryKey(),
  kind: text().$type<"passkey-register" | "passkey-login" | "google-signin" | "mailbox-oauth" | "email-verify" | "reauth" | "setup-link">().notNull(),
  challenge: text().notNull(),
  userId: text().references(() => users.id, { onDelete: "cascade" }),
  data: jsonb().$type<Record<string, unknown>>().notNull().default({}),
  expiresAt: ts().notNull(),
});

/* -------------------------------- Mailboxes -------------------------------- */

export type ServerConfig = {
  host: string;
  port: number;
  /** true = implicit TLS (993/465), false = STARTTLS. */
  secure: boolean;
  username?: string;
};

export type MailboxCredentials =
  | { kind: "password"; password: string }
  | {
      kind: "oauth";
      refreshToken: string;
      accessToken?: string;
      expiresAt?: number;
      scope?: string;
      /** Who issued it: Google (Gmail) unless said otherwise; Microsoft for Outlook over IMAP. */
      issuer?: "google" | "microsoft";
    };

export type SyncState = {
  /** Gmail: last processed history id. */
  historyId?: string;
  /** Gmail: when the users.watch() registration expires (ms). */
  watchExpiresAt?: number;
  /** IMAP: per mailbox path. */
  folders?: Record<
    string,
    {
      uidValidity: string;
      uidNext?: number;
      highestModseq?: string;
      /** How many messages it held when last synced; left out when that sync couldn't check for deletions. */
      exists?: number;
      /** When the sync last asked which known messages still exist (without QRESYNC). */
      expungeCheckedAt?: number;
    }
  >;
  /** How far back the initial import went. Set once the first import has finished. */
  backfilledUntil?: number;
  /** Gmail: the oldest message date the unfinished first import has reached, so a restart resumes there. */
  importedUntil?: number;
  /** Gmail: how far back the history import (mail older than the first import) has reached. */
  olderBefore?: number;
  /** IMAP: per folder, the lowest UID the history import has reached, valid for that UIDVALIDITY (0 = done). */
  olderBelowUid?: Record<string, { uidValidity: string; uid: number }>;
  /** All mail older than the first import is in too. */
  historyComplete?: boolean;
  /** Gmail: Trash and Spam were imported once (later changes arrive through history). */
  binsImported?: boolean;
  /** Mail that was here before its own folders were known has been filed into them once. */
  foldersFiled?: boolean;
  /** Gmail: the app's "Snoozed" label (not one of the user's folders). */
  snoozeLabelId?: string;
};

export type FolderRole = "inbox" | "sent" | "archive" | "drafts" | "trash" | "spam";

export const accounts = pgTable(
  "accounts",
  {
    id: id("acc"),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Which adapter talks to it. */
    provider: text().$type<"gmail" | "imap">().notNull(),
    /** Human provider label from autodetection, e.g. "Seznam", "iCloud", "Google Workspace". */
    providerLabel: text().notNull().default(""),
    email: text().notNull(),
    /** Display name in the sidebar (editable). */
    name: text().notNull(),
    /** Sender name in From:. */
    fromName: text().notNull().default(""),
    hue: integer().notNull(),
    icon: text().notNull().default("mail"),
    /** Custom picture instead of the icon: a data: URL the client already cropped and compressed (256 px, tens of kB). */
    image: text(),
    imap: jsonb().$type<ServerConfig>(),
    smtp: jsonb().$type<ServerConfig>(),
    /** Detected special-use folders (IMAP paths or Gmail label ids). */
    folders: jsonb().$type<Partial<Record<FolderRole, string>>>().notNull().default({}),
    credentials: jsonb().$type<Sealed>().notNull(),
    syncState: jsonb().$type<SyncState>().notNull().default({}),
    status: text().$type<"ok" | "syncing" | "auth_error" | "error">().notNull().default("syncing"),
    statusMessage: text(),
    lastSyncAt: ts(),
    /** Exposed to connected MCP agents. Superseded by `agents.accountIds` (each agent has its own); kept for older rows. */
    mcpEnabled: boolean().notNull().default(false),
    /** Which new mail may notify: everything, only people, only VIPs, or nothing. */
    notify: text().$type<NotifyMode>().notNull().default("all"),
    /** One sync per mailbox at a time, across the worker and web functions (see withSyncLease). */
    syncLeaseOwner: text(),
    syncLeaseUntil: ts(),
    /** A sync found the mailbox busy; the running one does one more pass before letting go. */
    syncRequested: boolean().notNull().default(false),
    sortOrder: integer().notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex().on(t.userId, t.email), index().on(t.provider)],
);

export const signatures = pgTable(
  "signatures",
  {
    id: id("sig"),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** null = available for every account. */
    accountId: text().references(() => accounts.id, { onDelete: "cascade" }),
    name: text().notNull().default("Signature"),
    html: text().notNull().default(""),
    isDefault: boolean().notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.userId)],
);

/** Templates and snippets, inserted with "/" in the editor. */
export const snippets = pgTable(
  "snippets",
  {
    id: id("snp"),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text().notNull(),
    /** Editor HTML, like a draft body. */
    html: text().notNull().default(""),
    createdAt: createdAt(),
    updatedAt: ts().notNull().defaultNow(),
  },
  (t) => [index().on(t.userId)],
);

/**
 * The address book: people the user writes to come in on their own (src/server/contacts.ts), and the
 * user adds phone, company and links, or merges one person's addresses.
 */
export const contacts = pgTable(
  "contacts",
  {
    id: id("con"),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text().notNull().default(""),
    /** Lowercase addresses; the first is the one to write to. */
    emails: jsonb().$type<string[]>().notNull().default([]),
    phone: text().notNull().default(""),
    company: text().notNull().default(""),
    jobTitle: text().notNull().default(""),
    /** LinkedIn, a website… */
    links: jsonb().$type<string[]>().notNull().default([]),
    note: text().notNull().default(""),
    /** VIP: their mail notifies even in quiet hours, and in mailboxes set to "Only VIPs". */
    vip: boolean().notNull().default(false),
    /** Removed by the user: kept, so the address book doesn't bring them back. */
    hidden: boolean().notNull().default(false),
    lastContactedAt: ts(),
    createdAt: createdAt(),
    updatedAt: ts().notNull().defaultNow(),
  },
  (t) => [index().on(t.userId), index("contacts_emails_gin").using("gin", t.emails)],
);

/**
 * Who may reach Inbox: the screener's yes ("allowed") and no ("blocked", mail goes straight to Archive),
 * and senders blocked from any email ("blocked" with `bin`: their mail goes to Trash). A whole domain is
 * one row with `email` "@domain.cz".
 */
export const senders = pgTable(
  "senders",
  {
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Lowercase address, or "@domain" for everyone at a domain. */
    email: text().notNull(),
    name: text().notNull().default(""),
    status: text().$type<"allowed" | "blocked">().notNull(),
    /** Blocked to Trash rather than Archive. */
    bin: boolean().notNull().default(false),
    decidedAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.email] })],
);

/* ---------------------------------- Rules ---------------------------------- */

/**
 * "Always do this" for new mail (src/server/mail/rules.ts): mail from someone (or with words in the
 * subject) goes to a folder, Archive or Trash, or stays in Inbox, read or just quiet. Matched mail
 * never notifies. Made from a suggestion after the user files a sender's mail by hand, or in Settings.
 */
export const rules = pgTable(
  "rules",
  {
    id: id("rul"),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** One mailbox, or null for all of them. */
    accountId: text().references(() => accounts.id, { onDelete: "cascade" }),
    /** Lowercase sender address, or "@domain"; empty = anyone. */
    fromMatch: text().notNull().default(""),
    /** Words the subject contains (case and accents aside); empty = any subject. */
    subjectMatch: text().notNull().default(""),
    action: text().$type<RuleAction>().notNull(),
    /** For "folder". The rule goes with the folder. */
    folderId: text().references(() => mailFolders.id, { onDelete: "cascade" }),
    markRead: boolean().notNull().default(false),
    /** How many emails it took care of, and when it last did. */
    applied: integer().notNull().default(0),
    lastAppliedAt: ts(),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.userId)],
);

/** How often the user filed a sender's mail into a folder by hand: the third time, Kolbaba offers a rule. */
export const ruleHints = pgTable(
  "rule_hints",
  {
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Lowercase address, or "@domain" for a company's many addresses. */
    sender: text().notNull(),
    folderId: text()
      .notNull()
      .references(() => mailFolders.id, { onDelete: "cascade" }),
    count: integer().notNull().default(0),
    /** The count when we last asked; asked again only after a few more. */
    asked: integer().notNull().default(0),
    updatedAt: ts().notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.sender, t.folderId] })],
);

/** Out-of-office replies sent, one row per mailbox and sender: nobody gets more than one every few days. */
export const awayReplies = pgTable(
  "away_replies",
  {
    accountId: text()
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    /** Lowercase address of who got it. */
    email: text().notNull(),
    sentAt: ts().notNull(),
  },
  (t) => [primaryKey({ columns: [t.accountId, t.email] })],
);

/* --------------------------------- History --------------------------------- */

/** What the user did to their mail (the agents' steps are in agent_events), kept 30 days, with Undo. */
/** How a conversation was before the change: what Undo puts back. */
export type HistorySnapshot = { id: string; folder: ThreadFolder; folderId: string | null; snoozedUntil: number | null; pinned: boolean; muted?: boolean };

export const history = pgTable(
  "history",
  {
    id: id("his"),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text().$type<HistoryKind>().notNull(),
    threadIds: jsonb().$type<string[]>().notNull().default([]),
    /** The first conversation's subject, as it was. */
    subject: text().notNull().default(""),
    count: integer().notNull().default(1),
    /** The folder's name, the snooze time, Trash or Spam… */
    data: jsonb().$type<Record<string, string | number>>().notNull().default({}),
    undo: jsonb().$type<HistorySnapshot[]>().notNull().default([]),
    undoable: boolean().notNull().default(true),
    undoneAt: ts(),
    at: createdAt(),
  },
  (t) => [index().on(t.userId, t.at)],
);

/* ------------------------------- Own folders ------------------------------- */

/**
 * The user's own folders, one list across mailboxes (matched by name). A conversation lives in one of
 * them at most. At the provider each is a Gmail label or an IMAP folder, created there the first time
 * mail from that mailbox goes in; existing labels and folders are picked up by the sync.
 */
export const mailFolders = pgTable(
  "mail_folders",
  {
    id: id("fld"),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text().notNull(),
    /** 0–360, drawn like mailbox colours. */
    hue: integer().notNull(),
    /** Where it is at each mailbox's provider, by account id: Gmail label id or IMAP path. */
    refs: jsonb().$type<Record<string, string>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("mail_folders_user_name_idx").on(t.userId, sql`lower(${t.name})`)],
);

/* -------------------------------- Calendars -------------------------------- */

/** How Kolbaba signs in to a calendar account of its own (one that didn't come with a mailbox's password). */
export type CalendarCredentials =
  | { kind: "oauth"; issuer: "google" | "microsoft"; refreshToken: string; accessToken?: string; expiresAt?: number; scope?: string }
  | { kind: "password"; username: string; password: string };

/**
 * Where calendars come from: a Google or Microsoft account, a CalDAV account, a link to an .ics file
 * that updates by itself ("feed"), or Kolbaba's own ("local": one per user, holding the calendars made
 * here and imported files). Calendars stay at their provider; what's here is a copy to show quickly.
 */
export const calendarSources = pgTable(
  "calendar_sources",
  {
    id: id("cso"),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text().$type<CalendarSourceKind>().notNull(),
    /** The mailbox it came with: its calendars go when the mailbox is disconnected. Null: added on its own. */
    accountId: text().references(() => accounts.id, { onDelete: "cascade" }),
    /** Whose calendars these are (the sign-in address), or the host a feed comes from. */
    label: text().notNull().default(""),
    /** CalDAV: the calendar home. Feed: the .ics address. */
    url: text(),
    /** Sealed CalendarCredentials. Null: CalDAV with the mailbox's own password, a feed, Kolbaba's own calendars. */
    credentials: jsonb().$type<Sealed>(),
    status: text().$type<"ok" | "auth_error" | "error">().notNull().default("ok"),
    statusMessage: text(),
    /** When the list of its calendars was last read from the provider. */
    listedAt: ts(),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.userId)],
);

export const calendars = pgTable(
  "calendars",
  {
    id: id("cal"),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sourceId: text()
      .notNull()
      .references(() => calendarSources.id, { onDelete: "cascade" }),
    /** Google calendar id, Graph calendar id or CalDAV collection URL; a random one for feeds and Kolbaba's own. */
    providerId: text().notNull(),
    name: text().notNull(),
    /** 0–360, drawn like mailbox colours. */
    hue: integer().notNull(),
    /** Ticked in the list: its events show. */
    visible: boolean().notNull().default(true),
    readOnly: boolean().notNull().default(false),
    /** The account's main calendar: new events go here unless another is picked. */
    primary: boolean().notNull().default(false),
    /** The window of events copied here, and when it was last read from the provider. */
    syncedFrom: ts(),
    syncedTo: ts(),
    syncedAt: ts(),
    /** Feed: what the last download said about itself, to skip an unchanged file. `searchedAt`: when the wide window that search looks in was last read (ms). */
    syncState: jsonb().$type<{ etag?: string; lastModified?: string; searchedAt?: number }>().notNull().default({}),
    sortOrder: integer().notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.userId), uniqueIndex().on(t.sourceId, t.providerId)],
);

/**
 * Kolbaba's own calendars, imported files and feeds: one iCalendar object per event (a repeating
 * one together with its exceptions), the way a CalDAV server keeps them.
 */
export const calendarObjects = pgTable(
  "calendar_objects",
  {
    id: id("cob"),
    calendarId: text()
      .notNull()
      .references(() => calendars.id, { onDelete: "cascade" }),
    uid: text().notNull(),
    ics: text().notNull(),
    /** When it first starts and last ends (null: repeats without end), so a window reads only what can fall in it. */
    firstAt: ts(),
    lastAt: ts(),
    updatedAt: ts().notNull().defaultNow(),
  },
  (t) => [uniqueIndex().on(t.calendarId, t.uid)],
);

/** Events of the copied window, one row per occurrence (a repeating event is many rows). */
export const calendarEvents = pgTable(
  "calendar_events",
  {
    id: id("evt"),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    calendarId: text()
      .notNull()
      .references(() => calendars.id, { onDelete: "cascade" }),
    /** The occurrence at its provider (src/server/calendar/types.ts ProviderEvent). */
    providerId: text().notNull(),
    seriesId: text(),
    uid: text(),
    etag: text(),
    title: text().notNull().default(""),
    location: text().notNull().default(""),
    description: text().notNull().default(""),
    /** All-day events: midnight UTC of the first day and of the day after the last. */
    startAt: ts().notNull(),
    endAt: ts().notNull(),
    allDay: boolean().notNull().default(false),
    timeZone: text(),
    /** The series' rule ("FREQ=WEEKLY;BYDAY=TU"); null for a single event. */
    recurrence: text(),
    organizer: jsonb().$type<Person | null>(),
    attendees: jsonb().$type<EventAttendee[]>().notNull().default([]),
    myStatus: text().$type<AttendeeStatus>(),
    joinUrl: text(),
    url: text(),
    canEdit: boolean().notNull().default(true),
    /** The start a reminder already went out for: a moved event reminds again. */
    remindedFor: ts(),
    updatedAt: ts().notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex().on(t.calendarId, t.providerId),
    index().on(t.userId, t.startAt),
    // Reminders: the worker looks at what starts in the next hour, across everyone.
    index().on(t.startAt),
  ],
);

/**
 * An event's own reminder time, where it differs from the user's usual one. Kept here, not at the
 * provider, so it works the same for every kind of calendar and for events the user can't change.
 */
export const calendarReminders = pgTable(
  "calendar_reminders",
  {
    id: id("crm"),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    calendarId: text()
      .notNull()
      .references(() => calendars.id, { onDelete: "cascade" }),
    /** One occurrence (calendar_events.providerId) or a whole series (seriesId); the occurrence's own wins. */
    key: text().notNull(),
    /** Minutes before the start; null: no reminder for this event. */
    minutes: integer(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex().on(t.calendarId, t.key)],
);

/* --------------------------------- Threads --------------------------------- */

export type ThreadFolder = "inbox" | "archive" | "sent" | "scheduled" | "trash" | "spam";

export const threads = pgTable(
  "threads",
  {
    id: id("thr"),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accountId: text()
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    /** Gmail threadId, or for IMAP the Message-ID of the root message. */
    providerThreadId: text().notNull(),
    subject: text().notNull().default(""),
    snippet: text().notNull().default(""),
    participants: jsonb().$type<Person[]>().notNull().default([]),
    lastMessageAt: ts().notNull(),
    /** The user's newest email in it (Trash and Spam aside): Sent lists every conversation they wrote in, by this. */
    lastSentAt: ts(),
    messageCount: integer().notNull().default(0),
    hasAttachments: boolean().notNull().default(false),
    unread: boolean().notNull().default(false),
    /** Gmail star / IMAP \Flagged. */
    pinned: boolean().notNull().default(false),
    folder: text().$type<ThreadFolder>().notNull().default("inbox"),
    snoozedUntil: ts(),
    /** When a snooze ran out: the conversation sorts by this moment in Inbox, so it's back on top. */
    wokeAt: ts(),
    /**
     * Snooze reaches the provider too: the conversation is archived there until it wakes, then these
     * messages (Message-IDs, which survive IMAP moves) go back to its Inbox.
     */
    snoozeMoved: jsonb().$type<string[]>().notNull().default([]),
    /**
     * When it was snoozed; set until what the snooze did at the provider is undone (Gmail's "Snoozed"
     * label, the moves above), and it tells a fresh snooze from one moved back to Inbox elsewhere.
     */
    snoozedAt: ts(),
    followUpAt: ts(),
    kind: text().$type<"person" | "newsletter" | "notification">().notNull().default("person"),
    /** Screener: the first email from someone new, waiting for the user's yes or no (not in Inbox yet). */
    screening: boolean().notNull().default(false),
    /** One of the user's own folders it lives in (its messages carry that label or sit in that IMAP folder). */
    folderId: text().references(() => mailFolders.id, { onDelete: "set null" }),
    logoDomain: text(),
    listUnsubscribe: text(),
    /** The newest mail from the list said List-Unsubscribe-Post (RFC 8058): its https address works in one click. */
    listUnsubscribeOneClick: boolean().notNull().default(false),
    /** The user left the list from this conversation. */
    unsubscribedAt: ts(),
    /** Muted: new replies skip Inbox (archived and read, src/server/mail/mute.ts) and don't notify. */
    mutedAt: ts(),
    /** The user's private note on the conversation (never sent, not at the provider). */
    note: text().notNull().default(""),
    noteUpdatedAt: ts(),
    /** "Not waiting" in No reply yet: hidden there until the user writes in it again (src/server/mail/unanswered.ts). */
    noReplyDismissedAt: ts(),
    /** "Notify me of replies": the next replies notify whatever the mailbox's setting and quiet hours. */
    watchedAt: ts(),
    /** The user's rules looked at it up to here (src/server/mail/rules.ts); a newer message gets looked at again. */
    ruledAt: ts(),
    updatedAt: ts().notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex().on(t.accountId, t.providerThreadId),
    index().on(t.userId, t.folder, t.lastMessageAt),
    // Lists read only the page they show: each index below matches one list's filter and order
    // (src/server/mail/service.ts listThreads), so a big Inbox isn't read and sorted whole every refresh.
    index("threads_inbox_sort_idx")
      .on(t.userId, sql`greatest(${t.lastMessageAt}, ${t.wokeAt})`)
      .where(sql`${t.folder} = 'inbox' and not ${t.screening} and ${t.mutedAt} is null and ${t.messageCount} > 0`),
    index("threads_folder_sort_idx")
      .on(t.folderId, sql`greatest(${t.lastMessageAt}, ${t.wokeAt})`)
      .where(sql`${t.folderId} is not null`),
    index("threads_pinned_idx").on(t.userId, t.lastMessageAt).where(sql`${t.pinned}`),
    index("threads_sent_idx").on(t.userId, t.lastSentAt).where(sql`${t.lastSentAt} is not null`),
    index("threads_screening_idx").on(t.userId, t.lastMessageAt).where(sql`${t.screening}`),
    // Own folders' numbers in the sidebar, counted from the index alone.
    index("threads_folder_counts_idx")
      .on(t.userId, t.folderId, t.accountId, t.unread, t.folder, t.messageCount, t.snoozedUntil)
      .where(sql`${t.folderId} is not null`),
    // The Home Screen badge: unread conversations in Inbox, counted from the index alone.
    index("threads_inbox_unread_idx")
      .on(t.userId, t.kind, t.snoozedUntil)
      .where(sql`${t.folder} = 'inbox' and ${t.unread} and not ${t.screening} and ${t.mutedAt} is null and ${t.messageCount} > 0`),
    index().on(t.snoozedUntil).where(sql`${t.snoozedUntil} is not null`),
    index().on(t.followUpAt).where(sql`${t.followUpAt} is not null`),
    // The worker's rounds (worker/jobs.ts): each looks only at the few conversations it may act on.
    index("threads_snooze_release_idx").on(t.snoozedUntil).where(sql`${t.snoozedAt} is not null or ${t.snoozeMoved} <> '[]'::jsonb`),
    index("threads_muted_inbox_idx").on(t.userId).where(sql`${t.mutedAt} is not null and ${t.folder} = 'inbox'`),
    index("threads_empty_idx").on(t.accountId, t.updatedAt).where(sql`${t.messageCount} = 0`),
  ],
);

export const messages = pgTable(
  "messages",
  {
    id: id("msg"),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accountId: text()
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    threadId: text()
      .notNull()
      .references(() => threads.id, { onDelete: "cascade" }),
    /** Gmail message id, or `${mailboxPath}:${uidValidity}:${uid}` for IMAP. */
    providerMessageId: text().notNull(),
    /** RFC 5322 Message-ID header, used for threading and dedupe across folders. */
    messageIdHeader: text(),
    inReplyTo: text(),
    references: jsonb().$type<string[]>().notNull().default([]),
    from: jsonb().$type<Person>().notNull(),
    to: jsonb().$type<Person[]>().notNull().default([]),
    cc: jsonb().$type<Person[]>().notNull().default([]),
    bcc: jsonb().$type<Person[]>().notNull().default([]),
    replyTo: jsonb().$type<Person[]>().notNull().default([]),
    subject: text().notNull().default(""),
    date: ts().notNull(),
    snippet: text().notNull().default(""),
    /** Raw (unsanitised) HTML; sanitised at read time so rule changes apply retroactively. Null until fetched. */
    bodyHtml: text(),
    bodyText: text(),
    attachments: jsonb().$type<AttachmentMeta[]>().notNull().default([]),
    unread: boolean().notNull().default(false),
    /** IMAP location for flag changes / moves. */
    imapPath: text(),
    imapUid: bigint({ mode: "number" }),
    /** Gmail label ids. */
    labels: jsonb().$type<string[]>().notNull().default([]),
    isOutgoing: boolean().notNull().default(false),
    /** Set on messages we sent with a pixel (see tracked_messages). */
    trackingId: text(),
    /**
     * Full-text words, without diacritics ("nabidka" finds "nabídka"). Addresses, domains and links
     * come apart into words first (info@nasereality.test → info nasereality test), so a part of one finds it,
     * as in Gmail; whole, they'd be one word only its start matches. toTsQuery splits the same way.
     */
    search: tsvector().generatedAlwaysAs(
      sql`to_tsvector('simple', immutable_unaccent(translate(coalesce(subject,'') || ' ' || coalesce("from"->>'name','') || ' ' || coalesce("from"->>'email','') || ' ' || coalesce(snippet,'') || ' ' || left(coalesce(body_text,''), 20000), '@./<>', '     ')))`,
    ),
    /** Smart categories looked at this message (whatever they found). Null = still to do. */
    insightCheckedAt: ts(),
    /** Our answer to the calendar invitation in this message, once given here. */
    rsvp: text().$type<"ACCEPTED" | "TENTATIVE" | "DECLINED">(),
    /** The calendar invitation in it, read at sync or on first open, so the list can show when it is. */
    invite: jsonb().$type<Invite>(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex().on(t.accountId, t.providerMessageId),
    index().on(t.threadId, t.date),
    index().on(t.accountId, t.messageIdHeader),
    index("messages_search_idx").using("gin", t.search),
    index("messages_insight_todo_idx").on(t.userId, t.date).where(sql`${t.insightCheckedAt} is null`),
    // One user's mail without reading everyone's: files, newsletters, out of office, the screener, progress counts.
    index("messages_user_date_idx").on(t.userId, t.date),
    // Whom the user wrote to (address book, contacts scan).
    index("messages_outgoing_idx").on(t.userId, t.date).where(sql`${t.isOutgoing}`),
    // Which UIDs a folder holds, from the index alone (IMAP sync, src/server/sync/sink.ts knownUids).
    index("messages_folder_uid_idx").on(t.accountId, t.imapPath, t.imapUid),
    // Threading by References (sink.ts findOrCreateThread) without reading the whole mailbox.
    index("messages_references_gin").using("gin", t.references.op("jsonb_path_ops")),
    // Sent mail still under its "local:" id until the real copy syncs (sink.ts upsertMessages): a handful of rows.
    index("messages_placeholder_idx").on(t.accountId).where(sql`${t.providerMessageId} like 'local:%'`),
  ],
);

/**
 * What the AI features cost, per user, day (UTC) and kind of call: "triage" (Jev sorting mail),
 * "extract" (OpenAI filling in a card), "summary". The daily caps read it, so a deploy or a restart
 * of the worker doesn't reset them, and /admin shows it.
 */
export const aiUsage = pgTable(
  "ai_usage",
  {
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    day: date({ mode: "string" }).notNull(),
    kind: text().$type<"triage" | "extract" | "summary">().notNull(),
    calls: integer().notNull().default(0),
    inputTokens: bigint({ mode: "number" }).notNull().default(0),
    cachedTokens: bigint({ mode: "number" }).notNull().default(0),
    outputTokens: bigint({ mode: "number" }).notNull().default(0),
    /** Estimated from list prices (src/server/ai-usage.ts), in millionths of a dollar. */
    costMicros: bigint({ mode: "number" }).notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.userId, t.day, t.kind] }), index().on(t.day)],
);

/**
 * Smart categories: what an order, trip, invoice or subscription email says (one row per email that
 * is one). Emails about the same thing share `groupKey`; the app merges them into one card.
 */
export const insights = pgTable(
  "insights",
  {
    id: id("ins"),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accountId: text()
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    threadId: text()
      .notNull()
      .references(() => threads.id, { onDelete: "cascade" }),
    messageId: text()
      .notNull()
      .unique()
      .references(() => messages.id, { onDelete: "cascade" }),
    category: text().$type<InsightCategory>().notNull(),
    groupKey: text().notNull(),
    /** The Insight without key and date (see src/lib/types.ts). */
    data: jsonb().$type<InsightData>().notNull(),
    /** "schema.org" markup in the email, the AI model that read it, or "jev" (sorted only: older mail, no details). */
    source: text().notNull(),
    /** Date of the email. */
    at: ts().notNull(),
    /** The user marked the card done (arrived, picked up, paid). Set on every row of the group. */
    doneAt: ts(),
    /** "Doesn't belong here": hidden, and kept so a new reading can't bring it back (and as a measure of quality). */
    dismissedAt: ts(),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.userId, t.category, t.at), index().on(t.threadId), index().on(t.userId, t.groupKey)],
);

/**
 * What smart categories learned about a sender, per user: after a few emails in a row that were
 * nothing, the next ones aren't sent for sorting (src/server/insights/memory.ts).
 */
export const senderMemory = pgTable(
  "sender_memory",
  {
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** The sender's address, lowercase. */
    sender: text().notNull(),
    /** Emails in a row that sorting found nothing in. */
    nothing: integer().notNull().default(0),
    /** Emails skipped since the last one that was sorted anyway. */
    skipped: integer().notNull().default(0),
    updatedAt: timestamp({ withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.sender] })],
);

/** Emails to the operator about the AI providers (credit gone, an outage), at most one per key and half a day. */
export const opsAlerts = pgTable("ops_alerts", {
  key: text().primaryKey(),
  sentAt: timestamp({ withTimezone: true, mode: "date" }).notNull(),
});

/** A conversation summed up by AI, on request; reused until the conversation gets another message. */
export const threadSummaries = pgTable("thread_summaries", {
  threadId: text()
    .primaryKey()
    .references(() => threads.id, { onDelete: "cascade" }),
  userId: text()
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  /** How many messages it covered; more since then = stale. */
  messageCount: integer().notNull(),
  locale: text().notNull(),
  data: jsonb().$type<ThreadSummary>().notNull(),
  createdAt: createdAt(),
});

/* ------------------------------ Drafts & sending ----------------------------- */

export const drafts = pgTable(
  "drafts",
  {
    id: id("drf"),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accountId: text()
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    /** Reply inside an existing thread. */
    threadId: text().references(() => threads.id, { onDelete: "set null" }),
    to: text().notNull().default(""),
    cc: text().notNull().default(""),
    bcc: text().notNull().default(""),
    subject: text().notNull().default(""),
    /** Editor HTML (TipTap); converted to email-safe HTML only when sending. */
    html: text().notNull().default(""),
    /** Set when an MCP agent wrote it ("Drafted by …"). */
    agentId: text(),
    /** Draft mirrored to the provider's Drafts folder, so other clients see it. */
    providerDraftId: text(),
    /** Which edit of that provider draft this matches (Gmail: its message id; IMAP: the ref): a new one means it changed there. */
    providerVersion: text(),
    /** The `updatedAt` the provider copy matches; older than `updatedAt` = the worker mirrors it again. */
    providerSyncedAt: ts(),
    createdAt: createdAt(),
    updatedAt: ts().notNull().defaultNow(),
  },
  (t) => [index().on(t.userId, t.updatedAt)],
);

/** Provider copies to remove (a mirrored draft that was sent or discarded). The worker works through them. */
export const providerCleanups = pgTable("provider_cleanups", {
  id: id("pcl"),
  accountId: text()
    .notNull()
    .references(() => accounts.id, { onDelete: "cascade" }),
  kind: text().$type<"draft">().notNull(),
  ref: text().notNull(),
  attempts: integer().notNull().default(0),
  createdAt: createdAt(),
});

/**
 * Files attached while writing (and pasted images, `inline` with a Content-ID). They belong to the draft
 * while it's written and move to the outbox entry when it's queued, so Undo and scheduled sends keep them.
 * Uploaded in chunks (a web function takes at most 4.5 MB per request); deleted once the email is out.
 */
export const draftAttachments = pgTable(
  "draft_attachments",
  {
    id: id("att"),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    draftId: text(),
    outboxId: text(),
    name: text().notNull(),
    mime: text().notNull(),
    /** The whole file; `received` grows chunk by chunk until it matches. */
    size: integer().notNull(),
    received: integer().notNull().default(0),
    inline: boolean().notNull().default(false),
    cid: text(),
    content: bytea().notNull(),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.draftId), index().on(t.outboxId)],
);

/**
 * Outbox: every send goes through here. Undo-send is a row whose `sendAt` is a few seconds away,
 * scheduled send is the same row further in the future. The worker picks rows up when they're due.
 */
export const outbox = pgTable(
  "outbox",
  {
    id: id("out"),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accountId: text()
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    threadId: text().references(() => threads.id, { onDelete: "set null" }),
    /** Kept so "cancel" can restore the draft exactly as it was. */
    draftSnapshot: jsonb()
      .$type<{ id?: string; to: string; cc: string; bcc: string; subject: string; html: string; threadId?: string | null }>()
      .notNull(),
    to: jsonb().$type<Person[]>().notNull(),
    cc: jsonb().$type<Person[]>().notNull().default([]),
    bcc: jsonb().$type<Person[]>().notNull().default([]),
    subject: text().notNull(),
    /** Final email-safe HTML incl. signature (tracking pixel is added at send time). */
    html: text().notNull(),
    text: text().notNull(),
    inReplyTo: text(),
    references: jsonb().$type<string[]>().notNull().default([]),
    track: boolean().notNull().default(false),
    followUpDays: integer(),
    sendAt: ts().notNull(),
    /** true = user-visible scheduled send (shows in Scheduled), false = undo window only. */
    scheduled: boolean().notNull().default(false),
    status: text().$type<"pending" | "sending" | "sent" | "failed" | "cancelled">().notNull().default("pending"),
    attempts: integer().notNull().default(0),
    error: text(),
    /** Id of the resulting message row once sent. */
    messageId: text(),
    agentId: text(),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.status, t.sendAt), index().on(t.userId, t.status)],
);

/* ------------------------------- Read tracking ------------------------------- */

export const trackedMessages = pgTable(
  "tracked_messages",
  {
    /** Random token embedded in the pixel URL. */
    id: text().primaryKey(),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accountId: text()
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    messageId: text().references(() => messages.id, { onDelete: "set null" }),
    outboxId: text(),
    threadId: text(),
    subject: text().notNull().default(""),
    recipients: jsonb().$type<Person[]>().notNull().default([]),
    /** Opens before this moment are our own preview/sending pipeline and are ignored. */
    armedAt: ts().notNull(),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.userId)],
);

export const openEvents = pgTable(
  "open_events",
  {
    id: id("opn"),
    trackedId: text()
      .notNull()
      .references(() => trackedMessages.id, { onDelete: "cascade" }),
    at: ts().notNull().defaultNow(),
    /** Coarse label like "iPhone · Gmail"; no IP or location is ever stored. */
    client: text().notNull(),
    viaApple: boolean().notNull().default(false),
    viaGoogleProxy: boolean().notNull().default(false),
  },
  (t) => [index().on(t.trackedId, t.at)],
);

/* ---------------------------------- Push ---------------------------------- */

export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: id("psh"),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    endpoint: text().notNull().unique(),
    p256dh: text().notNull(),
    auth: text().notNull(),
    userAgent: text(),
    /** The session that turned it on: signing that device out remotely stops its notifications too. */
    sessionId: text(),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.userId)],
);

/* ------------------------------- MCP / agents ------------------------------ */

/** OAuth clients created through dynamic client registration (RFC 7591). Not tied to a user yet. */
export const oauthClients = pgTable("oauth_clients", {
  id: text().primaryKey(),
  secretHash: text(),
  redirectUris: jsonb().$type<string[]>().notNull(),
  clientName: text().notNull().default("AI agent"),
  logoUri: text(),
  clientUri: text(),
  createdAt: createdAt(),
});

export type AgentPermission = "read" | "draft" | "full";

/** A user's grant to one OAuth client. Shown in AI activity as "N agents connected". */
export const agents = pgTable(
  "agents",
  {
    id: id("agt"),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    clientId: text()
      .notNull()
      .references(() => oauthClients.id, { onDelete: "cascade" }),
    /** Model/agent name, e.g. "Claude" (from MCP clientInfo when known). */
    name: text().notNull(),
    /** Host app, e.g. "Claude Code". */
    app: text().notNull(),
    /** Domain or URL used for the logo. */
    logo: text(),
    permission: text().$type<AgentPermission>().notNull().default("draft"),
    /** The mailboxes this agent may see; every agent has its own. */
    accountIds: jsonb().$type<string[]>().notNull().default([]),
    /** The agent may read the calendar, and change it as far as `permission` goes. Off until the user turns it on. */
    calendar: boolean().notNull().default(false),
    enabled: boolean().notNull().default(true),
    clientInfo: jsonb().$type<{ name?: string; version?: string; title?: string }>(),
    lastActiveAt: ts(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex().on(t.userId, t.clientId)],
);

export const oauthCodes = pgTable("oauth_codes", {
  /** sha256 of the code. */
  id: text().primaryKey(),
  clientId: text().notNull(),
  userId: text()
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  agentId: text()
    .notNull()
    .references(() => agents.id, { onDelete: "cascade" }),
  redirectUri: text().notNull(),
  codeChallenge: text().notNull(),
  scope: text().notNull().default(""),
  resource: text(),
  expiresAt: ts().notNull(),
});

export const oauthTokens = pgTable(
  "oauth_tokens",
  {
    /** sha256 of the token. */
    id: text().primaryKey(),
    kind: text().$type<"access" | "refresh">().notNull(),
    agentId: text()
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    clientId: text().notNull(),
    scope: text().notNull().default(""),
    expiresAt: ts().notNull(),
    revokedAt: ts(),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.agentId)],
);

/** One agent run, titled by the `intent` the agent passes with its tool calls. */
export const agentSessions = pgTable(
  "agent_sessions",
  {
    id: id("ags"),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    agentId: text()
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    /** MCP transport session id, so steps of one run group together. */
    mcpSessionId: text(),
    title: text().notNull(),
    startedAt: createdAt(),
    lastAt: ts().notNull().defaultNow(),
  },
  (t) => [index().on(t.userId, t.lastAt), index().on(t.agentId, t.mcpSessionId)],
);

export type AgentAction =
  | "search"
  | "list"
  | "read"
  | "draft"
  | "send"
  | "schedule"
  | "archive"
  | "mark_read"
  | "mark_unread"
  | "snooze"
  | "pin"
  | "label"
  | "move"
  | "trash"
  | "unsubscribe"
  | "note"
  | "remind"
  | "screen"
  | "event_create"
  | "event_update"
  | "event_delete";

export const agentEvents = pgTable(
  "agent_events",
  {
    id: id("age"),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sessionId: text()
      .notNull()
      .references(() => agentSessions.id, { onDelete: "cascade" }),
    agentId: text()
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    at: ts().notNull().defaultNow(),
    action: text().$type<AgentAction>().notNull(),
    /** Short English sentence; **bold** marks the object of the action. */
    summary: text().notNull(),
    /** The same step as data, phrased by the app in the reader's language. Null on older rows. */
    step: jsonb().$type<AgentStep>(),
    accountId: text(),
    threadId: text(),
    /** What Undo needs to restore (previous folder, draft id, outbox id…). */
    undo: jsonb().$type<Record<string, unknown>>(),
    undone: boolean().notNull().default(false),
  },
  (t) => [index().on(t.userId, t.at)],
);
