"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { agentSessions, buildAgentEvents, buildAgents, buildDrafts, buildThreads, initialAccounts, ME_NAME } from "./mock-data";
import {
  api,
  ApiError,
  cancelDraftSave,
  claimDevice,
  fetchBootstrap,
  fetchThread,
  fetchThreads,
  LIVE,
  mergeThread,
  patchThread as apiPatchThread,
  patchThreads as apiPatchThreads,
  readSnapshot,
  saveDraftNow,
  saveDraftSoon,
  writeSnapshotSoon,
  type Bootstrap,
  type ThreadPatch,
} from "./live";
import { resolveLocale, t, tk, tn, type LanguageSetting } from "./i18n";
import { awayName, awayRepliesOf, placeAway } from "./away";
import { CATEGORY_VIEWS, isCategoryView } from "./insights";
import { parseSearch, searchFrom, type ParsedSearch } from "./search";
import { TRIAL_DAYS, type PlusInterval, type PlusState } from "./plus";
import type { SidebarLayout } from "./sidebar-layout";
import { LATEST_NOTE, RELEASE_NOTES } from "./whats-new";
import { randomClient } from "./tracking";
import { folderFeature, track } from "./usage";
import { haptic } from "./haptics";
import { markLeaving } from "./leaving";
import { inboxZeroStamps, sendStamps, STAMPS, yearAndADay, type StampCounter, type StampId } from "./stamps";
import { postcardKey } from "./postcard";
import { isOffline, readQueue, writeQueue, type QueuedSend, type SendOptions } from "./offline-outbox";
import { disablePush } from "./push-client";
import { normalizeFrom } from "./rules";
import { trackForwardCopy, withForwardedImages } from "./forward-files";
import type {
  Accent,
  Account,
  AwayReply,
  BadgeMode,
  Agent,
  AgentEvent,
  AgentPermission,
  AgentSession,
  Density,
  Draft,
  ForwardedFiles,
  FolderId,
  MailboxScope,
  MailFolder,
  MailRule,
  NotifyMode,
  QuietHours,
  RuleAction,
  RuleSuggestion,
  Contact,
  Person,
  Snippet,
  SwipeAction,
  Tab,
  OpenEvent,
  Theme,
  Thread,
  ThreadFolder,
} from "./types";
import { DAY, formatFuture, htmlToText, randomId, uid } from "./utils";

/** The small gesture a toast plays for what just happened (components/signature.tsx). */
export type Signature = "send" | "schedule" | "archive" | "trash" | "spam" | "inbox" | "snooze" | "wake" | "pin" | "folder" | "snip" | "done";

export interface Toast {
  id: string;
  message: string;
  sig?: Signature;
  undo?: () => void;
  /** ms; 0 = sticky until dismissed */
  duration: number;
  /** Show a draining bar — used for the undo-send window. */
  countdown?: boolean;
  icon?: "eye" | "key" | "new" | "wifi-off" | "rule" | "palmtree";
  /** A button other than Undo, e.g. "Copy" for a verification code. */
  action?: { label: string; run: () => void };
  /** Out of sight while a composer is on screen, and back when it's gone (it waits; it isn't dropped). */
  notWhileWriting?: boolean;
}

export type ListItem =
  | { type: "thread"; id: string; thread: Thread }
  | { type: "draft"; id: string; draft: Draft };

/** How long "Undo send" can take an email back (Settings → Mail), in seconds. */
export const UNDO_SEND_CHOICES = [6, 10, 20, 30] as const;

export interface MailState {
  accounts: Account[];
  threads: Record<string, Thread>;
  drafts: Record<string, Draft>;
  scope: MailboxScope;
  folder: FolderId;
  query: string;
  unreadOnly: boolean;
  selectedId: string | null;
  tabs: Tab[];
  activeTabId: string | null;
  density: Density;
  accent: Accent;
  paletteOpen: boolean;
  toasts: Toast[];
  drawerOpen: boolean;
  agents: Agent[];
  agentSessions: AgentSession[];
  agentEvents: AgentEvent[];

  /** Live mode: false until the first data (cache or network) arrived. Mock mode is always ready. */
  ready: boolean;
  user: { id: string; email: string; name: string; avatarUrl: string | null; googleEmail?: string | null; admin?: boolean; since?: number } | null;
  /** Live mode: server-side search hits for `query` (null = no search running). */
  searchIds: string[] | null;
  /** Searching the providers for mail not imported yet (see searchOlder). */
  searchingOlder: boolean;
  /** "Search older mail too": what the providers find for the current query comes in, then the search runs again. */
  searchOlder: () => Promise<void>;
  syncing: boolean;
  /** Live mode: show remote images without asking (server setting). */
  loadRemoteImages: boolean;
  /** Load images automatically, from Settings or from the explanation; open conversations show theirs right away. */
  setLoadRemoteImages: (on: boolean) => void;
  /** Why images are hidden was explained already (or the user chose in Settings). */
  imagesExplained: boolean;
  /** Why images are hidden is open (images-explainer.tsx). */
  imagesExplainerOpen: boolean;
  /** Open the explanation; the first time it opens, it counts as explained. */
  explainImages: () => void;
  closeImagesExplainer: () => void;
  init: () => Promise<void>;
  refresh: () => Promise<void>;
  /** Live mode: re-read mailbox status (e.g. to notice that a first import finished). */
  refreshAccounts: () => Promise<void>;
  loadThread: (id: string, opts?: { images?: boolean }) => Promise<void>;
  /** Open a conversation that may not be in any list loaded here (from Files, a contact). */
  openThreadById: (id: string, opts?: { newTab?: boolean }) => Promise<void>;
  /** The address book (src/server/contacts.ts), loaded when it's opened. */
  contacts: Contact[];
  loadContacts: () => Promise<void>;
  openContact: (id: string) => void;
  /** "Show contact" for an address in an email: its contact, made now if there's none. */
  openContactFor: (person: Person) => Promise<void>;
  createContact: (input: Partial<Contact>) => Promise<Contact | null>;
  saveContact: (id: string, patch: Partial<Contact>) => Promise<Contact | null>;
  deleteContact: (id: string) => void;
  mergeContacts: (intoId: string, fromId: string) => Promise<void>;
  /** A new email to this address. */
  writeTo: (email: string) => void;

  setScope: (scope: MailboxScope) => void;
  /** The mailbox the app opens in (Settings → Mailboxes). */
  openMailbox: MailboxScope;
  setOpenMailbox: (scope: MailboxScope) => void;
  setFolder: (folder: FolderId) => void;
  setQuery: (query: string) => void;
  toggleUnreadOnly: () => void;
  select: (id: string | null) => void;
  /** Multi-select (⌘/Ctrl-click, Shift-click). Empty = the usual single open conversation. */
  checked: string[];
  checkAnchor: string | null;
  /** `order` is the list as the user sees it, so a Shift range matches the screen. */
  /** "tap" is touch selection: toggle just this one (no Finder-style adding of the open conversation). */
  checkThread: (id: string, mode: "toggle" | "range" | "tap", order: string[]) => void;
  checkAll: (order: string[]) => void;
  clearChecked: () => void;
  archiveMany: (ids: string[]) => void;
  /** The user's own folders, across mailboxes. */
  folders: MailFolder[];
  createFolder: (name: string, hue?: number) => Promise<MailFolder>;
  updateFolder: (id: string, patch: { name?: string; hue?: number }) => Promise<void>;
  /** The folder goes (here and at the providers); its mail goes to Archive. */
  deleteFolder: (id: string) => Promise<void>;
  /** File conversations in one of the user's own folders (with Undo). */
  moveToFolder: (ids: string[], folderId: string) => void;
  /** Delete = move to Trash (Undo brings it back). */
  trashMany: (ids: string[]) => void;
  spamMany: (ids: string[]) => void;
  /** Restore from Trash, "Not spam", or unarchive. */
  moveManyToInbox: (ids: string[]) => void;
  /** For good, from Trash or Spam. The UI confirms first; there's no Undo. */
  deleteForever: (ids: string[]) => Promise<void>;
  emptyBin: (folder: "trash" | "spam") => Promise<void>;
  setUnreadMany: (ids: string[], unread: boolean) => void;
  setPinnedMany: (ids: string[], pinned: boolean) => void;
  snoozeMany: (ids: string[], until: number) => void;
  /** Mute: out of Inbox now, and new replies skip it (archived, read, no notification). */
  setMuted: (id: string, muted: boolean, nextId?: string | null) => void;
  /** Block someone from any email: what they (or anyone at their domain) send goes to Trash. */
  blockSender: (sender: Person, opts?: { domain?: boolean }) => Promise<void>;
  /** "Remind me if nobody replies" on a conversation already sent (null takes it off). */
  remindIfNoReply: (id: string, at: number | null) => void;
  /** "Not waiting": out of No reply yet until the user writes there again. */
  notWaiting: (id: string) => void;
  /** The user's private note on a conversation ("" removes it). */
  saveNote: (id: string, note: string) => Promise<void>;

  openThread: (id: string, opts?: { newTab?: boolean }) => void;
  openDraft: (id: string) => void;
  /** `email` fills in the address and starts looking it up (ignored when the tab is already open). */
  openAddAccount: (email?: string) => void;
  /** Activity: "me" is My history, "agents" what AI agents did. */
  openActivity: (view?: "me" | "agents") => void;
  activityView: "me" | "agents";
  setAgentEnabled: (id: string, enabled: boolean) => void;
  setAgentPermission: (id: string, permission: AgentPermission) => void;
  /** Disconnect an agent for good: its access and its activity go. */
  removeAgent: (id: string) => void;
  undoAgentEvent: (id: string) => void;
  closeTab: (tabId: string) => void;
  activateTab: (tabId: string) => void;
  cycleTab: (delta: number) => void;
  keepTab: (tabId: string) => void;

  archive: (id: string, nextId?: string | null) => void;
  trash: (id: string, nextId?: string | null) => void;
  spam: (id: string, nextId?: string | null) => void;
  moveToInbox: (id: string) => void;
  togglePin: (id: string) => void;
  setUnread: (id: string, unread: boolean) => void;
  snooze: (id: string, until: number, nextId?: string | null) => void;
  unsnooze: (id: string) => void;
  cancelScheduled: (id: string) => void;

  compose: (accountId?: string) => string;
  reply: (threadId: string, mode?: "reply" | "replyAll" | "forward") => string;
  updateDraft: (id: string, patch: Partial<Draft>) => void;

  /** Templates and snippets for "/" in the editor. */
  snippets: Snippet[];
  /** Creates (no id) or changes a snippet. Resolves to the saved one. */
  saveSnippet: (snippet: { id?: string; name: string; html: string }) => Promise<Snippet>;
  deleteSnippet: (id: string) => void;
  discardDraft: (id: string) => void;
  /** Deletes drafts from the Drafts list (a swipe or a selection); Undo brings them back without opening them. */
  discardDrafts: (ids: string[]) => void;
  sendDraft: (id: string, opts?: { scheduleAt?: number; followUpDays?: number; track?: boolean }) => void;
  recordOpen: (threadId: string, messageId: string, event: OpenEvent) => void;

  updateAccount: (id: string, patch: Partial<Account>) => void;
  /** A cropped, compressed picture (data: URL), or null to go back to the icon. */
  setAccountImage: (id: string, dataUrl: string | null) => Promise<void>;
  addAccount: (account: Omit<Account, "id">) => void;
  /** Disconnect a mailbox: the server deletes our copy first, then it leaves the UI. */
  removeAccount: (id: string) => Promise<void>;

  setDensity: (d: Density) => void;
  /** How long Undo send waits before an email leaves, in seconds. */
  undoSendSeconds: number;
  setUndoSendSeconds: (seconds: number) => void;
  /** Light, dark, or following the system. */
  theme: Theme;
  setTheme: (theme: Theme) => void;
  /** "?" lists every keyboard shortcut. */
  shortcutsOpen: boolean;
  setShortcutsOpen: (open: boolean) => void;
  swipeLeft: SwipeAction;
  swipeRight: SwipeAction;
  setSwipe: (side: "left" | "right", action: SwipeAction) => void;
  /** Kolbaba Plus (src/lib/plus.ts): smart categories, Awaiting my reply and summaries. Null until loaded (and in mock mode). */
  plus: PlusState | null;
  /** Paying for Plus works (Stripe is set up). */
  billing: boolean;
  /** This copy runs on the person's own server (selfhost/README.md): no Plus to buy, no feedback to us, no Terms of ours. */
  selfHosted: boolean;
  /** Smart features can run: false only on a self-hosted copy without an OpenAI key. */
  aiAvailable: boolean;
  refreshPlus: (opts?: { stripe?: boolean }) => Promise<void>;
  /** Off to Stripe Checkout. Stays here with a message (shown where the button is) when it can't. */
  subscribePlus: (interval: PlusInterval) => Promise<string | null>;
  /** Off to Stripe's page for the card, invoices and cancelling, or a message why not. */
  managePlus: () => Promise<string | null>;
  /** Without Plus (trial over): a toast that leads to Settings, so nothing just silently fails. */
  askForPlus: () => void;
  /** Order, travel, invoice and subscription emails are read by AI (OpenAI). Opt-in, part of Plus. */
  smartCategories: boolean;
  setSmartCategories: (on: boolean) => void;
  /** "Doesn't belong here": the card leaves its category (with Undo). */
  dismissInsight: (key: string) => void;
  /** Emails from people are read by AI too, to show who waits for an answer. A second opt-in. */
  replyReminders: boolean;
  setReplyReminders: (on: boolean) => void;
  /** First emails from new senders wait for a yes or no. Opt-in. */
  screener: boolean;
  setScreener: (on: boolean) => void;
  /** "Summarize" in long conversations. On unless turned off. */
  summaries: boolean;
  setSummaries: (on: boolean) => void;
  /** How the sidebar is arranged: section and item order, what's put away into "More". */
  sidebar: SidebarLayout;
  setSidebar: (layout: SidebarLayout) => void;
  /** What's new and tips: the window (on which tab), what's been seen and tried. */
  newsOpen: false | "news" | "tips";
  setNewsOpen: (tab: false | "news" | "tips") => void;
  /** Kolbaba's collection: the stamp album and the postcards. */
  collectionOpen: false | "stamps" | "postcards";
  setCollectionOpen: (tab: false | "stamps" | "postcards") => void;
  newsSeen: string | null;
  markNewsSeen: () => void;
  tried: string[];
  /** A feature was used (palette, snooze…): its tip is done. */
  markTried: (id: string) => void;
  tipShownAt: number | null;
  markTipShown: () => void;
  /** The sidebar is being rearranged (drag handles and show / put away switches). */
  sidebarEditing: boolean;
  setSidebarEditing: (editing: boolean) => void;
  /** Yes or no to a new sender: their waiting mail goes to Inbox, or to Archive (as will what follows). */
  screenSender: (sender: { email: string; name: string }, status: "allowed" | "blocked") => void;
  trackByDefault: boolean;
  setTrackByDefault: (v: boolean) => void;
  setAccent: (a: Accent) => void;
  /** "auto" follows the browser (Czech for Czech and Slovak, English otherwise). */
  language: LanguageSetting;
  setLanguage: (language: LanguageSetting) => void;
  settingsOpen: boolean;
  /** Opens Settings, optionally at a section ("mail" for snippets…). */
  setSettingsOpen: (open: boolean, section?: string) => void;
  settingsSection: string | null;
  /** Feedback: "idea" opens Suggest an improvement, "nps" the 0–10 card. */
  feedback: "idea" | "nps" | null;
  setFeedback: (mode: "idea" | "nps" | null) => void;
  /** The server says it's time for the occasional 0–10 question. */
  npsPrompt: boolean;
  /** Kolbaba's stamp album (src/lib/stamps.ts): when each was earned (ms). */
  stamps: Record<string, number>;
  /** Counts towards stamps (newsletters left, senders turned away, conversations filed). */
  stampCounts: Record<string, number>;
  /** Days with an empty Inbox in the last week, for Clean Week. */
  zeroDays: string[];
  /** Postcards collected, by village and season ("Horní Lhota|winter" → "2026-12-21T16", when it came). */
  postcards: Record<string, string>;
  /** Stamps on (the default) or off in Settings. */
  stampsOn: boolean;
  setStampsOn: (on: boolean) => void;
  /** The album was last looked at: newer stamps are marked new. */
  stampsSeen: number;
  markStampsSeen: () => void;
  /** The last "new stamp" card; there's at most one a day. */
  stampShownAt: number;
  /** Earned stamps whose card hasn't shown yet. */
  stampQueue: StampId[];
  earnStamps: (ids: StampId[]) => void;
  countStamp: (counter: StampCounter, by?: number) => void;
  /** Inbox is empty right now (the postcard is showing). */
  noteInboxZero: () => void;
  dismissStampCard: () => void;
  /** Kolbaba's counters (emails whose tracking was held back…), loaded when something shows them. */
  stats: { trackersWeek: number; trackersTotal: number } | null;
  loadStats: () => Promise<void>;
  /** Hide the 0–10 card; `remember` tells the server it was dismissed (an answer already counts). */
  dismissNps: (remember: boolean) => void;
  /**
   * Smart categories: the user says an order arrived (or was picked up) or a bill is paid, which
   * the email can't know. Applies to the whole card (every email with that key).
   */
  setInsightDone: (key: string, done: boolean) => void;
  /** Leave the mailing list a conversation came from (one-click or the list's email). Says what else from them is still here. */
  unsubscribe: (id: string) => Promise<{ sender: Person; inbox: number; total: number } | null>;
  /** After unsubscribing: everything still here from that sender to Archive (from Inbox) or Trash, with Undo. */
  cleanUpSender: (sender: Person, to: "archive" | "trash") => Promise<void>;
  setPaletteOpen: (open: boolean) => void;
  setDrawerOpen: (open: boolean) => void;
  pushToast: (t: Omit<Toast, "id" | "duration"> & { duration?: number }) => string;
  dismissToast: (id: string) => void;

  /** Notifications: quiet hours (no buzzing at night, mail still arrives) and what the icon's number counts. */
  quietHours: QuietHours;
  setQuietHours: (quiet: QuietHours) => void;
  badgeMode: BadgeMode;
  setBadgeMode: (mode: BadgeMode) => void;
  /** A sign-in code shows in the notification itself, also on a locked screen. */
  codeInNotification: boolean;
  setCodeInNotification: (on: boolean) => void;
  /** Which new mail in a mailbox may notify. */
  setNotifyMode: (accountId: string, mode: NotifyMode) => void;
  /** VIP addresses (lowercase): their mail notifies even in quiet hours and in "Only VIPs" mailboxes. */
  vips: string[];
  setVip: (person: Person, vip: boolean) => Promise<void>;
  /** "Notify me of replies" in a conversation. */
  setWatched: (id: string, watched: boolean) => void;
  /** Which mailboxes one agent may see. */
  setAgentMailboxes: (id: string, accountIds: string[]) => void;
  /** Newsletters and automatic mail fold into one row each in Inbox (src/lib/bundles.ts). */
  bundles: boolean;
  setBundles: (on: boolean) => void;
  /** Bundles opened in this session ("newsletter", "notification"). */
  openBundles: string[];
  toggleBundle: (key: string) => void;
  /** Inbox's pinned card unfolded in this session: all pinned conversations, not just the newest few (src/lib/bundles.ts). */
  pinnedOpen: boolean;
  togglePinnedOpen: () => void;
  /** Rules for new mail (Settings → Mail), loaded when Settings opens them. */
  rules: MailRule[] | null;
  loadRules: () => Promise<void>;
  /** Create (or with `id`, change) a rule; `applyNow` also files what's in Inbox already. Returns an error to show, or null. */
  saveRule: (input: RuleInput, opts?: { id?: string; applyNow?: boolean }) => Promise<string | null>;
  deleteRule: (id: string) => void;
  /** Kolbaba noticed a habit: "Always move mail from Alza to Shopping?" */
  offerRule: (suggestion: RuleSuggestion) => void;
  /** Out-of-office replies (Settings → Mail): each on for some mailboxes, or saved for next time. */
  awayReplies: AwayReply[];
  /** Add or change one; a reply turned on takes its mailboxes from the others (src/lib/away.ts). Returns an error to show, or null. */
  saveAway: (reply: AwayReply) => Promise<string | null>;
  deleteAway: (id: string) => void;
  /** Turn every reply off (the banner over Inbox). */
  stopAway: () => void;
  /** Emails sent without a signal, waiting on this device (src/lib/offline-outbox.ts). */
  offline: QueuedSend[];
  /** Send what's waiting, if there's a connection now. */
  flushOffline: () => Promise<void>;
  /** Take a waiting email back into Drafts instead. */
  unqueueOffline: (draftId: string) => void;
}

/** What Settings' rule editor sends (src/server/mail/rules.ts checks it). */
export interface RuleInput {
  accountId: string | null;
  from: string;
  subject: string;
  action: RuleAction;
  folderId: string | null;
  markRead: boolean;
}


/** The icon's number: unread conversations in Inbox, only people's ones, or none. */
export function badgeTotal(threads: Record<string, Thread>, mode: BadgeMode) {
  if (mode === "none") return 0;
  const now = Date.now();
  return Object.values(threads).filter((t) => t.unread && inFolder(t, "inbox", now) && (mode === "all" || (t.kind ?? "person") === "person")).length;
}

const browserZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Prague";
  } catch {
    return "Europe/Prague";
  }
};

/** A send of the offline queue is under way (one at a time). */
let flushing = false;

const pendingSends = new Map<string, ReturnType<typeof setTimeout>>();
let initStarted = false;
const accountTimers = new Map<string, ReturnType<typeof setTimeout>>();
/** Dragging reorders many times a second; the server gets the arrangement once it settles. */
let sidebarTimer: ReturnType<typeof setTimeout> | undefined;
let triedTimer: ReturnType<typeof setTimeout> | undefined;
let statsAt = 0;
/** No reply yet comes along with Inbox (for its count in the sidebar), at most this often. */
let unansweredAt = 0;
let stampCountTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * Conversations changed here (archived, undone, pinned…) whose change the server may not have yet.
 * A list or a conversation fetched before it landed would put the old state back: an archived row
 * popping back in, an Undo undone a moment later. Until then, what was done here wins.
 */
const inFlight = new Map<string, number>();
const landedAt = new Map<string, number>();

/** A change to these is on its way to the server; call what this returns once it's answered. */
function sending(ids: string[]) {
  for (const id of ids) inFlight.set(id, (inFlight.get(id) ?? 0) + 1);
  return () => {
    const now = Date.now();
    for (const id of ids) {
      const left = (inFlight.get(id) ?? 1) - 1;
      if (left > 0) inFlight.set(id, left);
      else inFlight.delete(id);
      landedAt.set(id, now);
    }
  };
}

/** Whether what the server said about this conversation, asked at `since`, may predate a change made here. */
const unsettled = (id: string, since: number) => inFlight.has(id) || (landedAt.get(id) ?? 0) > since;

/** The server's copy, with where it is and how it's marked as it was set here. */
function keepLocal(server: Thread, local: Thread): Thread {
  const { unread, pinned, folder, folderId, snoozedUntil, followUpAt } = local;
  return { ...server, unread, pinned, folder, folderId, snoozedUntil, followUpAt };
}

/** A draft being written here: open in a composer, or changed in the last couple of minutes. */
export function draftInUse(s: Pick<MailState, "tabs">, d: Draft, now = Date.now()) {
  return now - d.updatedAt < 120_000 || s.tabs.some((t) => (t.kind === "draft" && t.draftId === d.id) || (t.kind === "thread" && !!d.threadId && t.threadId === d.threadId));
}

/** A composer is on screen: the open tab is a draft, or the open conversation has a reply being written. */
export function composing(s: Pick<MailState, "tabs" | "activeTabId" | "drafts">) {
  const tab = s.tabs.find((t) => t.id === s.activeTabId);
  if (tab?.kind === "draft") return true;
  return tab?.kind === "thread" && Object.values(s.drafts).some((d) => d.threadId === tab.threadId);
}

/** Drafts open in a composer that the server hasn't seen yet must survive a drafts refresh. */
/**
 * The server's drafts (some started or finished in other clients) merged with these: one being written
 * here (open, or changed in the last couple of minutes) keeps its local version; one the server no
 * longer has (sent or discarded elsewhere) goes, unless it's being written here.
 */
function mergeDrafts(s: Pick<MailState, "drafts" | "tabs">, server: Draft[]): Record<string, Draft> {
  const now = Date.now();
  const busy = (d: Draft) => draftInUse(s, d, now);
  const out: Record<string, Draft> = {};
  for (const d of server) {
    const mine = s.drafts[d.id];
    out[d.id] = mine && (busy(mine) || mine.updatedAt > d.updatedAt) ? mine : d;
  }
  for (const [id, d] of Object.entries(s.drafts)) if (!out[id] && busy(d)) out[id] = d;
  return out;
}

const byId = <T extends { id: string }>(items: T[]) =>
  Object.fromEntries(items.map((i) => [i.id, i])) as Record<string, T>;

function parseRecipients(value: string, contacts: Person[]): Person[] {
  return value
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((email) => {
      const known = contacts.find((c) => c.email.toLowerCase() === email.toLowerCase());
      return known ?? { name: email.split("@")[0], email };
    });
}

export function getContacts(threads: Record<string, Thread>, accounts: Account[]): Person[] {
  const mine = new Set(accounts.map((a) => a.email));
  const seen = new Map<string, Person>();
  for (const t of Object.values(threads)) {
    for (const m of t.messages) {
      for (const person of [m.from, ...m.to, ...(m.cc ?? [])]) {
        if (!mine.has(person.email) && !seen.has(person.email)) seen.set(person.email, person);
      }
    }
  }
  return [...seen.values()];
}

export function lastMessage(t: Thread) {
  return t.messages[t.messages.length - 1];
}

/** List order: back from snooze, or a reminder that came due, counts as just arrived (same as the server). */
export function sortTime(t: Thread, now = Date.now()) {
  const due = t.followUpAt && t.followUpAt <= now ? t.followUpAt : 0;
  // A snooze that ran out here before the server's wake-up arrived.
  const woke = t.snoozedUntil && t.snoozedUntil <= now ? t.snoozedUntil : (t.wokeAt ?? 0);
  return Math.max(lastMessage(t)?.date ?? 0, woke, due);
}

/** The email a list row stands for: in Sent the user's own newest one (a reply may have come since), elsewhere the newest. */
export function listedMessage(t: Thread, folder: string) {
  const mine = folder === "sent" && t.sentAt ? t.messages.find((m) => m.date === t.sentAt) : undefined;
  return mine ?? lastMessage(t);
}

/** Who to show in the list: the latest sender who isn't me (or the recipient for sent mail). */
export function threadCounterpart(t: Thread, accounts: Account[]): Person {
  const mine = new Set(accounts.map((a) => a.email));
  for (let i = t.messages.length - 1; i >= 0; i--) {
    const m = t.messages[i];
    if (!mine.has(m.from.email)) return m.from;
  }
  return lastMessage(t).to[0] ?? lastMessage(t).from;
}

export function inFolder(t: Thread, folder: FolderId, now = Date.now()) {
  const snoozed = !!t.snoozedUntil && t.snoozedUntil > now;
  switch (folder) {
    case "inbox":
      // A due "remind me if nobody replies" brings the conversation back (same rule as the server). Muted ones never show.
      return !t.screening && !t.muted && ((t.folder === "inbox" && !snoozed) || (!!t.followUpAt && t.followUpAt <= now));
    case "screener":
      return !!t.screening && t.folder === "inbox";
    case "unanswered":
      // The server decides what waits for a reply (src/server/mail/unanswered.ts); here it only leaves.
      return !!t.awaiting && !t.muted && !isBin(t.folder) && t.folder !== "scheduled";
    case "pinned":
      return t.pinned && (t.folder === "inbox" || t.folder === "archive");
    case "snoozed":
      return snoozed;
    case "scheduled":
      return t.folder === "scheduled";
    case "sent":
      // Also a reply in a conversation that's in Inbox or Archive, like Gmail's Sent.
      return t.folder === "sent" || (!!t.sentAt && (t.folder === "inbox" || t.folder === "archive"));
    case "archive":
      // Archive is where mail without a folder of its own goes; filed mail is in its folder.
      return t.folder === "archive" && !t.folderId;
    case "trash":
    case "spam":
      return t.folder === folder;
    case "drafts":
    case "files":
    case "contacts":
    case "lists":
      return false;
    case "orders":
    case "travel":
    case "invoices":
    case "subscriptions":
    case "security":
    case "replies":
      return t.insight?.category === CATEGORY_VIEWS[folder] && (t.folder === "inbox" || t.folder === "archive" || t.folder === "sent");
    default:
      return !!t.folderId && t.folderId === ownFolderId(folder) && !isBin(t.folder) && !snoozed;
  }
}

/** The own folder and mailbox a conversation counts towards as unread ("fld_…|acc_…"), if it does. */
function unreadIn(t: Thread, now: number): string | null {
  const snoozed = !!t.snoozedUntil && t.snoozedUntil > now;
  return t.folderId && t.unread && !isBin(t.folder) && !snoozed ? `${t.folderId}|${t.accountId}` : null;
}

function shiftUnread(folders: MailFolder[], from: string | null, to: string | null): MailFolder[] {
  const step = (unread: Record<string, number>, key: string | null, folderId: string, by: number) => {
    if (!key) return unread;
    const [f, account] = key.split("|");
    return f === folderId ? { ...unread, [account]: Math.max(0, (unread[account] ?? 0) + by) } : unread;
  };
  return folders.map((f) => ({ ...f, unread: step(step(f.unread ?? {}, from, f.id, -1), to, f.id, 1) }));
}

/** Unread conversations in an own folder, for the mailbox picked in the switcher. */
export function folderUnread(folder: MailFolder, scope: MailboxScope): number {
  const unread = folder.unread ?? {};
  return scope === "all" ? Object.values(unread).reduce((a, b) => a + b, 0) : (unread[scope] ?? 0);
}

/** Whether an own folder holds any mail (for the papers in its icon): the server's count, or what's loaded here. */
export function folderHasMail(folder: MailFolder, scope: MailboxScope, threads: Record<string, Thread>): boolean {
  const count = folder.count ?? {};
  const server = scope === "all" ? Object.values(count).some((n) => n > 0) : (count[scope] ?? 0) > 0;
  return server || Object.values(threads).some((t) => t.folderId === folder.id && !isBin(t.folder) && (scope === "all" || t.accountId === scope));
}

/** "folder:fld_…" → "fld_…"; null for every other view. */
export function ownFolderId(folder: FolderId | string): string | null {
  return folder.startsWith("folder:") ? folder.slice(7) : null;
}

/** With one mailbox picked, its own folders (and ones not at any mailbox yet); with all, every one. */
export function folderInScope(folder: MailFolder, scope: MailboxScope): boolean {
  return scope === "all" || !folder.accountIds.length || folder.accountIds.includes(scope);
}

/** Where Undo (or a restore) puts a conversation back. Sent-only conversations go back through Archive, which files them under Sent again. */
function restoreTarget(folder: ThreadFolder): NonNullable<ThreadPatch["folder"]> {
  if (folder === "trash" || folder === "spam" || folder === "archive") return folder;
  return folder === "sent" ? "archive" : "inbox";
}

export const isBin = (folder: FolderId | ThreadFolder) => folder === "trash" || folder === "spam";

/**
 * What Drafts lists: new emails, and replies too (an agent's reply would otherwise be findable only
 * by its conversation, while Drafts in other clients shows it). Not a reply with nothing written yet:
 * pressing Reply alone leaves that in the conversation.
 */
export const inDrafts = (d: Draft) => !d.threadId || !!htmlToText(d.html).trim();

export function selectListItems(
  s: Pick<MailState, "threads" | "drafts" | "scope" | "folder" | "query" | "unreadOnly"> & { searchIds?: string[] | null },
): ListItem[] {
  const q = s.query.trim().toLowerCase();
  const inScope = (accountId: string) => s.scope === "all" || s.scope === accountId;

  if (s.folder === "drafts") {
    return Object.values(s.drafts)
      .filter((d) => inDrafts(d) && inScope(d.accountId))
      .filter((d) => !q || `${d.subject} ${d.to} ${htmlToText(d.html)}`.toLowerCase().includes(q))
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((d) => ({ type: "draft", id: d.id, draft: d }));
  }

  const now = Date.now();
  const search = q ? parseSearch(searchFrom(s.query, s.folder)) : null;
  // "in:all" (the All folders chip, and any search from Inbox): every folder but Trash, Spam and the screener's waiting room.
  const here = (t: Thread) => (search?.everywhere ? !isBin(t.folder) && t.folder !== "scheduled" && !t.screening : inFolder(t, s.folder, now));
  return Object.values(s.threads)
    .filter((t) => inScope(t.accountId) && here(t))
    .filter((t) => !s.unreadOnly || t.unread)
    .filter((t) => {
      if (!search) return true;
      if (s.searchIds) return s.searchIds.includes(t.id);
      return matchesSearch(t, search);
    })
    .sort((a, b) => {
      if (s.folder === "scheduled") return (a.scheduledAt ?? 0) - (b.scheduledAt ?? 0);
      if (s.folder === "snoozed") return (a.snoozedUntil ?? 0) - (b.snoozedUntil ?? 0);
      if (isCategoryView(s.folder)) return (b.insight?.at ?? 0) - (a.insight?.at ?? 0);
      if (s.folder === "sent" && !search?.everywhere) return (b.sentAt ?? sortTime(b, now)) - (a.sentAt ?? sortTime(a, now));
      return sortTime(b, now) - sortTime(a, now);
    })
    .map((t) => ({ type: "thread", id: t.id, thread: t }));
}

/** The prototype's search (live mode asks the server): words anywhere, operators on their fields. */
function matchesSearch(t: Thread, p: ParsedSearch) {
  const has = (hay: string, v: string) => hay.toLowerCase().includes(v);
  const person = (x: Person) => `${x.name} ${x.email}`;
  const hay = `${t.subject} ${t.messages.map((m) => `${person(m.from)} ${m.snippet ?? ""} ${htmlToText(m.html)}`).join(" ")}`.toLowerCase();
  const date = lastMessage(t)?.date ?? 0;
  return (
    p.text.toLowerCase().split(/\s+/).filter(Boolean).every((w) => hay.includes(w)) &&
    p.from.every((v) => t.messages.some((m) => has(person(m.from), v))) &&
    p.to.every((v) => t.messages.some((m) => [...m.to, ...(m.cc ?? [])].some((x) => has(person(x), v)))) &&
    p.subject.every((v) => has(t.subject, v)) &&
    (!p.hasAttachment || t.messages.some((m) => m.attachments?.length)) &&
    (!p.unread || t.unread) &&
    (!p.pinned || t.pinned) &&
    (!p.before || date < p.before.getTime()) &&
    (!p.after || date >= p.after.getTime())
  );
}

export function unreadCount(threads: Record<string, Thread>, scope: MailboxScope) {
  const now = Date.now();
  return Object.values(threads).filter(
    (t) => t.unread && (scope === "all" || t.accountId === scope) && inFolder(t, "inbox", now),
  ).length;
}

/** The conversation in the active tab, if a conversation is what's open. */
function openThreadId(s: Pick<MailState, "tabs" | "activeTabId">) {
  const tab = s.tabs.find((t) => t.id === s.activeTabId);
  return tab?.kind === "thread" ? tab.threadId : null;
}

export const useMail = create<MailState>()(
  persist(
    (set, get) => {
      const toast: MailState["pushToast"] = (t) => {
        const id = uid("toast");
        // On a phone, the finger feels it too: a firmer tap for sending, a soft one for the rest.
        if (t.sig) haptic(t.sig === "send" || t.sig === "schedule" ? "success" : "soft");
        set((s) => ({ toasts: [...s.toasts.slice(-2), { duration: 4000, ...t, id }] }));
        return id;
      };

      // Own folders' unread numbers follow what happens here, until the next refresh brings the server's.
      const patchThread = (id: string, patch: Partial<Thread>) =>
        set((s) => {
          const prev = s.threads[id];
          if (!prev) return s;
          const next = { ...prev, ...patch };
          const now = Date.now();
          const was = unreadIn(prev, now);
          const is = unreadIn(next, now);
          return { threads: { ...s.threads, [id]: next }, ...(was !== is ? { folders: shiftUnread(s.folders, was, is) } : {}) };
        });

      /**
       * Live mode: send a thread change to the server; if it fails, put the previous version back
       * and say why. Mock mode: no-op.
       */
      const remote = (id: string, patch: ThreadPatch, prev: Thread | undefined) => {
        if (!LIVE || !prev || prev.outboxId) return;
        const landed = sending([id]);
        apiPatchThread(id, patch)
          .catch((err: ApiError) => {
            set((s) => ({ threads: { ...s.threads, [id]: prev } }));
            toast({ message: err.message });
          })
          .finally(landed);
      };

      /**
       * One change for a multi-selection: optimistic, one request, one toast whose Undo puts every
       * conversation back. Archive and snooze also close their tabs and end the selection.
       */
      const bulk = (
        prevs: Thread[],
        local: Partial<Thread> | ((t: Thread) => Partial<Thread>),
        patch: ThreadPatch,
        say: (n: number) => string,
        opts: { keepOpen?: boolean; sig?: Signature } = {},
      ) => {
        if (!prevs.length) return;
        const ids = prevs.map((t) => t.id);
        if (opts.sig) markLeaving(ids, opts.sig);
        const restore = (which: string[]) =>
          set((s) => ({ threads: { ...s.threads, ...Object.fromEntries(prevs.filter((t) => which.includes(t.id)).map((t) => [t.id, t])) } }));
        for (const t of prevs) patchThread(t.id, typeof local === "function" ? local(t) : local);
        const send = (targets: Thread[], p: ThreadPatch) => {
          const live = targets.filter((t) => !t.outboxId);
          if (!LIVE || !live.length) return;
          const landed = sending(live.map((t) => t.id));
          apiPatchThreads(live.map((t) => t.id), p)
            .then(({ failed, suggestion }) => {
              // Filed this sender's mail by hand a few times: offer to always do it.
              if (suggestion) setTimeout(() => get().offerRule(suggestion), 900);
              if (!failed.length) return;
              restore(failed);
              toast({ message: t("Couldn't update {failed} of {total}. Try again.", { failed: failed.length, total: live.length }) });
            })
            .catch((err: ApiError) => {
              restore(live.map((t) => t.id));
              toast({ message: err.message });
            })
            .finally(landed);
        };
        send(prevs, patch);
        if (!opts.keepOpen) {
          set((s) => {
            const tabs = s.tabs.filter((t) => !(t.kind === "thread" && ids.includes(t.threadId)));
            return {
              tabs,
              activeTabId: tabs.some((t) => t.id === s.activeTabId) ? s.activeTabId : null,
              selectedId: s.selectedId && ids.includes(s.selectedId) ? null : s.selectedId,
              checked: [],
              checkAnchor: null,
            };
          });
        }
        const n = ids.length;
        toast({
          message: say(n),
          sig: opts.sig,
          undo: () => {
            restore(ids);
            // Each conversation goes back to its own previous state, so they may need different patches.
            const groups = new Map<string, { patch: ThreadPatch; threads: Thread[] }>();
            for (const t of prevs) {
              const back: ThreadPatch = {};
              // Filed mail goes back into its own folder; everything else to where it was.
              if (t.folderId && (patch.folder || patch.folderId)) back.folderId = t.folderId;
              else if (patch.folder || patch.folderId || (patch.snoozedUntil && t.folder === "archive" && !t.folderId)) back.folder = restoreTarget(t.folder);
              if (patch.unread !== undefined) back.unread = t.unread;
              if (patch.pinned !== undefined) back.pinned = t.pinned;
              if (patch.snoozedUntil !== undefined || patch.folder) back.snoozedUntil = t.snoozedUntil ?? null;
              if (patch.folder === "archive") back.followUpAt = t.followUpAt ?? null;
              const key = JSON.stringify(back);
              groups.set(key, { patch: back, threads: [...(groups.get(key)?.threads ?? []), t] });
            }
            for (const g of groups.values()) send(g.threads, { ...g.patch, undo: true });
          },
        });
      };

      /** A list from the server, asked for at `since`: changes made here that it may not know of yet stay. */
      const mergeIn = (threads: Record<string, Thread>, incoming: Thread[], since: number) => {
        for (const t of incoming) {
          const local = threads[t.id];
          threads[t.id] = mergeThread(local, local && unsettled(t.id, since) ? keepLocal(t, local) : t);
        }
      };

      const replaceThreads = (incoming: Thread[], drop: (t: Thread) => boolean, since: number) =>
        set((s) => {
          const threads = { ...s.threads };
          const ids = new Set(incoming.map((t) => t.id));
          for (const t of Object.values(threads)) if (drop(t) && !ids.has(t.id) && !unsettled(t.id, since)) delete threads[t.id];
          mergeIn(threads, incoming, since);
          return { threads };
        });

      /**
       * The No reply yet list from the server: those conversations wait, others here that waited no
       * longer do. Unlike other lists, nothing is dropped: the same conversations also live in Inbox or Sent.
       */
      const markAwaiting = (incoming: Thread[], scope: MailboxScope, since: number) =>
        set((s) => {
          const threads = { ...s.threads };
          const ids = new Set(incoming.map((t) => t.id));
          for (const t of Object.values(threads)) {
            if (t.awaiting && !ids.has(t.id) && (scope === "all" || t.accountId === scope) && !unsettled(t.id, since)) threads[t.id] = { ...t, awaiting: false };
          }
          mergeIn(threads, incoming, since);
          return { threads };
        });

      /**
       * One letter matches nearly everything: until there are two, the mail already here is searched
       * instead (selectListItems). Operators like `is:unread` are longer than that anyway.
       */
      const serverSearchable = (query: string) => query.trim().length >= 2;
      // Each search takes a number. An answer that a newer search replaced, or for words no longer in the
      // box (the next search is waiting for typing to pause), is dropped: it can't cover a newer one.
      let searchSeq = 0;
      const runSearch = async (query: string) => {
        const seq = ++searchSeq;
        const { scope, folder } = get();
        // In Files, Contacts and Newsletters the search box searches those.
        if (!serverSearchable(query) || folder === "files" || folder === "contacts" || folder === "lists") return set({ searchIds: null });
        try {
          const since = Date.now();
          const { threads } = await fetchThreads({ scope, folder, query: searchFrom(query, folder) });
          if (seq !== searchSeq || get().query.trim() !== query.trim()) return;
          set((s) => {
            const merged = { ...s.threads };
            mergeIn(merged, threads, since);
            return { threads: merged, searchIds: threads.map((t) => t.id) };
          });
        } catch {
          if (seq === searchSeq) set({ searchIds: null });
        }
      };
      let searchTimer: ReturnType<typeof setTimeout> | undefined;

      /** A Plus feature may be turned on: there's Plus or a trial, or the trial is still unused (turning it on starts it). */
      const plusAllows = () => {
        const plus = get().plus;
        return !LIVE || !plus || plus.level !== "none" || !plus.trialUsed;
      };

      /** Turn a Plus feature on or off; the first one on starts the trial, which deserves a word. */
      const turnPlusFeature = async (patch: { smartCategories?: boolean; replyReminders?: boolean }, revert: () => void) => {
        const startsTrial = Object.values(patch).some(Boolean) && get().plus?.level === "none" && !get().plus?.trialUsed;
        try {
          await api.patch("/api/settings", patch);
        } catch (err) {
          revert();
          if ((err as ApiError).code === "plus") get().askForPlus();
          else toast({ message: (err as Error).message });
          return;
        }
        if (!startsTrial) return;
        await get().refreshPlus();
        toast({ message: t("Kolbaba Plus is yours for {n} days, free. No card needed.", { n: TRIAL_DAYS }), duration: 6000 });
      };

      /**
       * Signed in with a code from email (no Google, no passkey): a quiet offer to save a passkey, so
       * next time it's Face ID or a fingerprint instead of opening the inbox. Not on the first day (the
       * welcome and the first mailbox come first), again after two months at the earliest, and never
       * on a device that can't do it.
       */
      const offerPasskey = async (boot: Bootstrap) => {
        const offeredAt = boot.settings.passkeyOfferedAt ?? 0;
        if (boot.user.hasPasskey || boot.user.googleEmail || Date.now() - offeredAt < 60 * 86_400_000) return;
        if (!boot.accounts.length || Date.now() - (boot.user.since ?? Date.now()) < 86_400_000) return;
        const available = await window.PublicKeyCredential?.isUserVerifyingPlatformAuthenticatorAvailable?.().catch(() => false);
        if (!available) return;
        await new Promise((r) => setTimeout(r, 2500));
        api.patch("/api/settings", { passkeyOfferedAt: Date.now() }).catch(() => {});
        toast({
          message: t("Next time, sign in with Face ID, Touch ID or your screen lock instead of a code?"),
          icon: "key",
          duration: 12_000,
          action: {
            label: t("Save a passkey"),
            run: () =>
              void import("@/components/auth/auth-client")
                .then((m) => m.addPasskey())
                .then(() => toast({ message: t("Passkey saved. Next time it's one touch.") }))
                .catch(() => {}),
          },
        });
      };

      /** Back from Stripe: Checkout (?plus=thanks&session_id=…) or the customer portal (?plus=back). */
      const returnFromStripe = async () => {
        const params = new URLSearchParams(window.location.search);
        const back = params.get("plus");
        if (!back) return;
        const sessionId = params.get("session_id");
        params.delete("plus");
        params.delete("session_id");
        window.history.replaceState(window.history.state, "", `${window.location.pathname}${params.size ? `?${params}` : ""}${window.location.hash}`);
        if (back === "thanks" && sessionId) {
          const res = await api.post<{ plus: PlusState }>("/api/billing/sync", { sessionId }).catch(() => null);
          if (res) set({ plus: res.plus });
          else await get().refreshPlus({ stripe: true });
          track("plusSubscribed");
          toast({ message: t("Thank you! Kolbaba Plus is on."), duration: 6000 });
        } else await get().refreshPlus({ stripe: true });
      };

      /** Live mode: connected MCP agents and their recent activity. */
      const loadAgents = () =>
        api
          .get<{ agents: Agent[]; sessions: AgentSession[]; events: AgentEvent[] }>("/api/agents")
          .then((r) => {
            set({ agents: r.agents, agentSessions: r.sessions, agentEvents: r.events });
            if (r.events.length) get().earnStamps(["robot"]);
          })
          .catch(() => {});

      /** No signal: the email waits on this device and goes as soon as there is one. */
      const queueOffline = (draft: Draft, opts: SendOptions | undefined, toastId?: string) => {
        if (toastId) get().dismissToast(toastId);
        track("offlineSend");
        const offline = [...get().offline.filter((q) => q.draft.id !== draft.id), { draft, opts: opts ?? {}, queuedAt: Date.now() }];
        set({ offline });
        writeQueue(offline);
        toast({
          message: t("No signal. It goes out as soon as there is one."),
          icon: "wifi-off",
          duration: 6000,
          action: { label: t("Back to drafts"), run: () => get().unqueueOffline(draft.id) },
        });
      };

      /** Live send: the server queues it in the outbox; Undo cancels the outbox entry and brings the draft back. */
      const liveSend = (draft: Draft, opts?: SendOptions, from?: "queue") => {
        const id = draft.id;
        set((st) => {
          const drafts = { ...st.drafts };
          delete drafts[id];
          return { drafts };
        });
        const tab = get().tabs.find((t) => t.kind === "draft" && t.draftId === id);
        if (tab) get().closeTab(tab.id);

        const restore = (d: Draft = draft) => {
          set((st) => ({ drafts: { ...st.drafts, [d.id]: d } }));
          if (d.threadId) get().openThread(d.threadId);
          else get().openDraft(d.id);
        };

        cancelDraftSave(id);
        // Known to be offline: straight into the queue, no failed request first.
        if (isOffline()) return queueOffline(draft, opts);
        const queued = api
          .post<Draft>("/api/drafts", { ...draft, threadId: draft.threadId ?? null })
          .then(() => api.post<{ outboxId: string; sendAt: number }>(`/api/drafts/${id}/send`, opts ?? {}));

        let toastId = "";
        const undo = async () => {
          try {
            const { outboxId } = await queued;
            const { draft: back } = await api.del<{ draft: Draft }>(`/api/outbox/${outboxId}`);
            restore(back);
          } catch (err) {
            toast({ message: (err as ApiError).status === 409 ? t("Too late — it's already on its way") : (err as Error).message });
          }
        };

        queued
          .then(({ sendAt }) => {
            if (opts?.scheduleAt) {
              if (get().folder === "scheduled") void get().refresh();
              return;
            }
            // After the undo window, pick up the sent copy from the server.
            setTimeout(() => {
              get().dismissToast(toastId);
              toast({ message: opts?.followUpDays ? tn(opts.followUpDays, "Sent · reminder in {n} day", "Sent · reminder in {n} days") : t("Message sent"), sig: "done" });
              void get().refresh();
              if (draft.threadId) {
                set((st) => {
                  const t = st.threads[draft.threadId!];
                  return t ? { threads: { ...st.threads, [t.id]: { ...t, messages: t.messages.map((m) => ({ ...m, bodyLoaded: false })) } } } : st;
                });
                void get().loadThread(draft.threadId);
              }
            }, Math.max(0, sendAt - Date.now()) + 2500);
          })
          .catch((err: ApiError) => {
            // The signal dropped on the way: it waits here instead of coming back as a draft.
            if (err.code === "offline") return queueOffline(draft, opts, toastId);
            get().dismissToast(toastId);
            restore();
            toast({ message: err.message });
          });

        toastId = opts?.scheduleAt
          ? toast({ message: t("Scheduled for {time}", { time: formatFuture(opts.scheduleAt) }), undo, sig: "schedule" })
          : toast({
              message: from === "queue" ? t("Signal's back. Sending “{subject}”…", { subject: draft.subject || t("(no subject)") }) : t("Sending…"),
              undo,
              duration: get().undoSendSeconds * 1000,
              countdown: true,
              sig: "send",
            });
      };

      /** Archive, Delete (to Trash) and Spam: the conversation leaves the list, Undo puts it back where it was. */
      const moveAway = (id: string, to: "archive" | "trash" | "spam", nextId: string | null | undefined, message: string) => {
        const prev = get().threads[id];
        if (!prev) return;
        if (prev.wokeAt && to !== "spam") get().earnStamps(["boomerang"]);
        markLeaving([id], to);
        patchThread(id, { folder: to, folderId: null, snoozedUntil: undefined, followUpAt: undefined });
        remote(id, { folder: to }, prev);
        advanceFrom(id, nextId);
        toast({
          message,
          sig: to,
          undo: () => {
            patchThread(id, { folder: prev.folder, folderId: prev.folderId, snoozedUntil: prev.snoozedUntil, followUpAt: prev.followUpAt });
            remote(
              id,
              prev.folderId
                ? { folderId: prev.folderId, undo: true }
                : { folder: restoreTarget(prev.folder), snoozedUntil: prev.snoozedUntil ?? null, followUpAt: prev.followUpAt ?? null, undo: true },
              get().threads[id],
            );
            get().openThread(id);
          },
        });
      };

      /** Replace the thread shown in the active preview tab (or close it) after it leaves the list. */
      const advanceFrom = (id: string, nextId?: string | null) => {
        const { tabs } = get();
        const tab = tabs.find((t) => t.kind === "thread" && t.threadId === id);
        if (!tab) return;
        if (nextId && tab.preview) {
          get().openThread(nextId);
        } else {
          get().closeTab(tab.id);
          set({ selectedId: nextId ?? null });
        }
      };

      return {
        accounts: LIVE ? [] : initialAccounts,
        threads: LIVE ? {} : byId(buildThreads()),
        drafts: LIVE ? {} : byId(buildDrafts()),
        scope: "all",
        openMailbox: "all",
        folder: "inbox",
        query: "",
        unreadOnly: false,
        selectedId: null,
        checked: [],
        checkAnchor: null,
        tabs: [],
        activeTabId: null,
        density: "comfortable",
        undoSendSeconds: 6,
        theme: "auto",
        shortcutsOpen: false,
        setShortcutsOpen: (shortcutsOpen) => {
          if (shortcutsOpen) track("shortcuts");
          set({ shortcutsOpen });
        },
        swipeLeft: "archive",
        swipeRight: "pin",
        // The prototype shows the categories; real mail only goes to AI once the user says so.
        smartCategories: !LIVE,
        // Off for new users: tracking is opt-in (privacy, and it only hints at opens anyway).
        trackByDefault: false,
        accent: "ink",
        language: "auto",
        settingsOpen: false,
        settingsSection: null,
        feedback: null,
        setFeedback: (feedback) => set({ feedback }),
        npsPrompt: false,
        stamps: {},
        stampCounts: {},
        zeroDays: [],
        postcards: {},
        stampsOn: true,
        setStampsOn: (stampsOn) => {
          set({ stampsOn, ...(stampsOn ? {} : { stampQueue: [] }) });
          if (LIVE) api.patch("/api/settings", { stampsOff: !stampsOn }).catch(() => set({ stampsOn: !stampsOn }));
        },
        stampsSeen: 0,
        markStampsSeen: () => {
          const latest = Math.max(0, ...Object.values(get().stamps));
          if (latest <= get().stampsSeen) return;
          set({ stampsSeen: latest });
          if (LIVE) api.patch("/api/settings", { stampsSeen: latest }).catch(() => {});
        },
        stampShownAt: 0,
        stampQueue: [],
        earnStamps: (ids) => {
          const s = get();
          // Live: not before the user's own album has arrived, or a stamp they have would count as new.
          if (!s.stampsOn || (LIVE && !s.user)) return;
          const fresh = ids.filter((id) => !s.stamps[id]);
          if (!fresh.length) return;
          const now = Date.now();
          const stamps = { ...s.stamps, ...Object.fromEntries(fresh.map((id) => [id, now])) };
          // One card a day at most; the rest wait in the album, marked new.
          const card = now - s.stampShownAt > DAY ? fresh.slice(0, 1) : [];
          set({ stamps, stampQueue: [...s.stampQueue, ...card], ...(card.length ? { stampShownAt: now } : {}) });
          if (LIVE) api.patch("/api/settings", { stamps, ...(card.length ? { stampShownAt: now } : {}) }).catch(() => {});
        },
        countStamp: (counter, by = 1) => {
          const s = get();
          if (!s.stampsOn || (LIVE && !s.user)) return;
          const stampCounts = { ...s.stampCounts, [counter]: (s.stampCounts[counter] ?? 0) + by };
          set({ stampCounts });
          clearTimeout(stampCountTimer);
          stampCountTimer = setTimeout(() => LIVE && api.patch("/api/settings", { stampCounts: get().stampCounts }).catch(() => {}), 1500);
          const done = STAMPS.filter((d) => d.counter === counter && d.goal && stampCounts[counter] >= d.goal).map((d) => d.id);
          if (done.length) get().earnStamps(done);
        },
        noteInboxZero: () => {
          const s = get();
          if (!s.stampsOn || (LIVE && !s.user)) return;
          const now = new Date();
          const { earn, zeroDays } = inboxZeroStamps(now, s.zeroDays);
          if (zeroDays.join() !== s.zeroDays.join()) {
            set({ zeroDays });
            if (LIVE) api.patch("/api/settings", { zeroDays }).catch(() => {});
          }
          // Today's postcard goes into the collection, unless that village in this season is already there.
          const card = postcardKey(now);
          if (!s.postcards[card.key]) {
            const postcards = { ...s.postcards, [card.key]: card.at };
            set({ postcards });
            if (LIVE) api.patch("/api/settings", { postcards }).catch(() => {});
          }
          get().earnStamps(earn);
        },
        dismissStampCard: () => set((s) => ({ stampQueue: s.stampQueue.slice(1) })),
        stats: null,
        loadStats: async () => {
          // A handful of places ask; the numbers move slowly, so once every few minutes is plenty.
          if (Date.now() - statsAt < 5 * 60_000) return;
          statsAt = Date.now();
          if (!LIVE) return void set({ stats: { trackersWeek: 23, trackersTotal: 412 } });
          try {
            const stats = await api.get<{ trackersWeek: number; trackersTotal: number }>("/api/stats");
            set({ stats });
            if (stats.trackersTotal >= 100) get().earnStamps(["spy-catcher"]);
          } catch {
            statsAt = 0;
          }
        },
        dismissNps: (remember) => {
          set({ npsPrompt: false, feedback: get().feedback === "nps" ? null : get().feedback });
          if (remember && LIVE) api.del("/api/feedback").catch(() => {});
        },
        paletteOpen: false,
        toasts: [],
        drawerOpen: false,
        agents: LIVE ? [] : buildAgents(),
        agentSessions: LIVE ? [] : agentSessions,
        agentEvents: LIVE ? [] : buildAgentEvents(),
        ready: !LIVE,
        user: null,
        searchIds: null,
        searchingOlder: false,
        searchOlder: async () => {
          const { query, scope } = get();
          if (!LIVE || !query.trim() || get().searchingOlder) return;
          set({ searchingOlder: true });
          try {
            const { imported } = await api.post<{ imported: number }>("/api/search/older", { query, scope });
            if (imported) await runSearch(get().query);
            else toast({ message: t("Nothing more at the provider for “{query}”.", { query }) });
          } catch (err) {
            toast({ message: (err as ApiError).message });
          } finally {
            set({ searchingOlder: false });
          }
        },
        syncing: false,
        loadRemoteImages: false,
        setLoadRemoteImages: (on) => {
          set({ loadRemoteImages: on, imagesExplained: true });
          if (!LIVE) return;
          api.patch("/api/settings", { loadRemoteImages: on }).catch(() => set({ loadRemoteImages: !on }));
          if (!on) return;
          // Conversations open in tabs show their images now; the rest fetch theirs again when opened.
          const open = new Set(get().tabs.flatMap((tab) => (tab.kind === "thread" ? [tab.threadId] : [])));
          const blocked = (t: Thread) => t.messages.some((m) => m.blockedImages);
          set((s) => ({
            threads: Object.fromEntries(
              Object.entries(s.threads).map(([id, t]) =>
                !open.has(id) && blocked(t) ? [id, { ...t, messages: t.messages.map((m) => (m.blockedImages ? { ...m, bodyLoaded: false } : m)) }] : [id, t],
              ),
            ),
          }));
          for (const id of open) if (get().threads[id] && blocked(get().threads[id])) void get().loadThread(id, { images: true });
        },
        // Until the server says otherwise: nobody gets the explanation before their settings arrived.
        imagesExplained: true,
        imagesExplainerOpen: false,
        explainImages: () => {
          set({ imagesExplainerOpen: true });
          if (get().imagesExplained) return;
          set({ imagesExplained: true });
          if (LIVE) api.patch("/api/settings", { imagesExplained: true }).catch(() => {});
        },
        closeImagesExplainer: () => set({ imagesExplainerOpen: false }),

        init: async () => {
          // React's dev double-effect (and a remount) must not bootstrap twice.
          if (!LIVE || initStarted) return;
          initStarted = true;
          // Paint the last known mailbox right away, then refresh from the network.
          const cached = await readSnapshot();
          if (cached && !get().ready) {
            set({ accounts: cached.accounts, threads: byId(cached.threads), drafts: byId(cached.drafts), ready: true });
          }
          try {
            const boot = await fetchBootstrap();
            // Another account used this device last: what it left here (cache, unsent emails, its notifications) isn't ours.
            if (await claimDevice(boot.user.id)) {
              set({ offline: [], threads: {}, drafts: {} });
              void disablePush().catch(() => {});
            }
            const mailboxOrAll = (id: string | undefined) => (boot.accounts.some((a) => a.id === id) ? id! : "all");
            const openMailbox = mailboxOrAll(boot.settings.openMailbox);
            set((s) => ({
              user: boot.user,
              accounts: boot.accounts,
              openMailbox,
              // Picked on another device, or disconnected since: unless someone already switched mailboxes while this loaded.
              scope: s.scope === s.openMailbox ? openMailbox : mailboxOrAll(s.scope),
              snippets: boot.snippets ?? [],
              folders: boot.folders ?? [],
              npsPrompt: !!boot.askNps,
              drafts: { ...byId(boot.drafts), ...Object.fromEntries(Object.entries(s.drafts).filter(([id]) => !boot.drafts.some((d) => d.id === id) && s.tabs.some((t) => t.kind === "draft" && t.draftId === id))) },
              density: boot.settings.density ?? s.density,
              undoSendSeconds: boot.settings.undoSendSeconds ?? 6,
              theme: boot.settings.theme ?? s.theme,
              accent: (boot.settings.accent as Accent | undefined) ?? s.accent,
              language: boot.settings.language ?? s.language,
              trackByDefault: boot.settings.trackByDefault ?? false,
              swipeLeft: boot.settings.swipeLeft ?? s.swipeLeft,
              swipeRight: boot.settings.swipeRight ?? s.swipeRight,
              smartCategories: boot.settings.smartCategories ?? false,
              replyReminders: boot.settings.replyReminders ?? false,
              screener: boot.settings.screener ?? false,
              summaries: boot.settings.summaries ?? true,
              sidebar: boot.settings.sidebar ?? {},
              // Never seen any: someone who was here before notes existed gets the card once. Someone who
              // joined after the latest one has nothing new to hear about (and a mailbox to connect first).
              newsSeen: boot.settings.newsSeen ?? ((boot.user.since ?? 0) >= Date.parse(RELEASE_NOTES[0].date) ? LATEST_NOTE : ""),
              tried: boot.settings.tried ?? [],
              tipShownAt: boot.settings.tipShownAt ?? null,
              loadRemoteImages: boot.settings.loadRemoteImages ?? false,
              imagesExplained: !!(boot.settings.imagesExplained || boot.settings.loadRemoteImages),
              stamps: boot.settings.stamps ?? {},
              stampCounts: boot.settings.stampCounts ?? {},
              zeroDays: boot.settings.zeroDays ?? [],
              postcards: boot.settings.postcards ?? {},
              stampsOn: !boot.settings.stampsOff,
              stampsSeen: boot.settings.stampsSeen ?? 0,
              stampShownAt: boot.settings.stampShownAt ?? 0,
              plus: boot.plus ?? null,
              billing: !!boot.billing,
              selfHosted: !!boot.selfHosted,
              aiAvailable: boot.ai !== false || !boot.selfHosted,
              quietHours: boot.settings.quietHours ?? s.quietHours,
              badgeMode: boot.settings.badge ?? "all",
              codeInNotification: boot.settings.codeInNotification ?? true,
              bundles: boot.settings.bundles ?? false,
              awayReplies: awayRepliesOf(boot.settings, boot.accounts.map((a) => a.id)),
              vips: (boot.vips ?? []).map((e) => e.toLowerCase()),
            }));
            void returnFromStripe();
            void offerPasskey(boot);
            if (boot.user.since && yearAndADay(boot.user.since)) get().earnStamps(["year-and-a-day"]);
            // Notifications speak the language the app resolved to ("auto" means this browser's).
            const locale = resolveLocale(get().language);
            if (boot.settings.locale !== locale) api.patch("/api/settings", { locale }).catch(() => {});
            void loadAgents();
            await get().refresh();
            // Anything sent without a signal last time goes now.
            void get().flushOffline();
          } catch (err) {
            if (!get().ready) toast({ message: (err as Error).message, duration: 0 });
          } finally {
            set({ ready: true });
          }
          useMail.subscribe((s) => {
            if (s.user) writeSnapshotSoon({ userId: s.user.id, accounts: s.accounts, threads: Object.values(s.threads), drafts: Object.values(s.drafts) });
          });
        },

        refresh: async () => {
          if (!LIVE) return;
          const { scope, folder } = get();
          // Files, Contacts and Newsletters have their own lists; folders still refresh with them.
          if (folder === "files" || folder === "contacts" || folder === "lists") {
            void api.get<MailFolder[]>("/api/folders").then((folders) => set({ folders }), () => {});
            if (folder === "contacts") void get().loadContacts();
            return;
          }
          if (folder === "drafts") {
            const drafts = await api.get<Draft[]>("/api/drafts").catch(() => null);
            if (drafts) set((s) => ({ drafts: mergeDrafts(s, drafts) }));
            return;
          }
          // Drafts started or finished in other clients come along too (they show in Drafts' count).
          void api.get<Draft[]>("/api/drafts").then(
            (drafts) => set((s) => ({ drafts: mergeDrafts(s, drafts) })),
            () => {},
          );
          set({ syncing: true });
          // Own folders (new ones from the providers, unread numbers) come along with every refresh.
          void api.get<MailFolder[]>("/api/folders").then(
            (folders) => set({ folders }),
            () => {},
          );
          try {
            const since = Date.now();
            // Pinned conversations top Inbox however old they are, so they can't wait for their page to load.
            const pinnedToo = folder === "inbox" ? fetchThreads({ scope, folder: "pinned" }).catch(() => null) : null;
            const { threads, nextCursor } = await fetchThreads({ scope, folder });
            if (folder === "unanswered") {
              unansweredAt = Date.now();
              markAwaiting(threads, scope, since);
              return;
            }
            const oldest = threads.length ? Math.min(...threads.map((t) => lastMessage(t)?.date ?? 0)) : 0;
            const now = Date.now();
            // Anything we still show in this view but the server no longer lists has moved elsewhere.
            replaceThreads(
              threads,
              (t) =>
                (scope === "all" || t.accountId === scope) &&
                inFolder(t, folder, now) &&
                (!nextCursor || (lastMessage(t)?.date ?? 0) >= oldest),
              since,
            );
            const pinned = await pinnedToo;
            if (pinned) replaceThreads(pinned.threads, (t) => !pinned.nextCursor && (scope === "all" || t.accountId === scope) && inFolder(t, "pinned", now), since);
            // The sidebar counts what waits for a reply; that list is heavier, so not on every refresh.
            if (folder === "inbox" && Date.now() - unansweredAt > 5 * 60_000) {
              unansweredAt = Date.now();
              const waiting = await fetchThreads({ scope, folder: "unanswered" }).catch(() => null);
              if (waiting) markAwaiting(waiting.threads, scope, since);
            }
            // Inbox shows how many new senders wait in the screener, so those come along.
            if (folder === "inbox" && get().screener) {
              const waiting = await fetchThreads({ scope, folder: "screener" }).catch(() => null);
              if (waiting) replaceThreads(waiting.threads, (t) => (scope === "all" || t.accountId === scope) && inFolder(t, "screener", now), since);
            }
          } finally {
            set({ syncing: false });
          }
        },

        refreshAccounts: async () => {
          if (!LIVE) return;
          const fresh = await api.get<Account[]>("/api/accounts").catch(() => null);
          if (!fresh) return;
          // Only the server-owned fields: a rename still waiting for its debounced save must survive.
          set((s) => ({
            accounts: fresh.map((f) => {
              const mine = s.accounts.find((a) => a.id === f.id);
              return mine ? { ...mine, status: f.status, statusMessage: f.statusMessage, historyComplete: f.historyComplete, image: f.image } : f;
            }),
          }));
        },

        contacts: [],
        loadContacts: async () => {
          if (!LIVE) return;
          const contacts = await api.get<Contact[]>("/api/people").catch(() => null);
          if (contacts) set({ contacts });
        },
        openContact: (id) => {
          const s = get();
          const existing = s.tabs.find((t) => t.kind === "contact" && t.contactId === id);
          if (existing) return set({ activeTabId: existing.id });
          // One contact tab at a time: a new one replaces the last, like a preview.
          const tab: Tab = { id: uid("tab"), kind: "contact", contactId: id, preview: false };
          const tabs = s.tabs.filter((t) => t.kind !== "contact");
          set({ tabs: [...tabs, tab], activeTabId: tab.id });
        },
        openContactFor: async (person) => {
          if (!LIVE) return;
          try {
            const contact = await api.post<Contact>("/api/people/lookup", { email: person.email, name: person.name });
            set((s) => ({ contacts: s.contacts.some((c) => c.id === contact.id) ? s.contacts : [contact, ...s.contacts] }));
            get().openContact(contact.id);
          } catch (err) {
            toast({ message: (err as ApiError).message });
          }
        },
        createContact: async (input) => {
          try {
            const contact = await api.post<Contact>("/api/people", input);
            set((s) => ({ contacts: [contact, ...s.contacts] }));
            return contact;
          } catch (err) {
            toast({ message: (err as ApiError).message });
            return null;
          }
        },
        saveContact: async (id, patch) => {
          try {
            const contact = await api.patch<Contact>(`/api/people/${encodeURIComponent(id)}`, patch);
            set((s) => ({ contacts: s.contacts.map((c) => (c.id === id ? contact : c)) }));
            return contact;
          } catch (err) {
            toast({ message: (err as ApiError).message });
            return null;
          }
        },
        deleteContact: (id) => {
          const prev = get().contacts;
          const contact = prev.find((c) => c.id === id);
          set((s) => ({ contacts: s.contacts.filter((c) => c.id !== id), tabs: s.tabs.filter((t) => !(t.kind === "contact" && t.contactId === id)) }));
          if (get().activeTabId && !get().tabs.some((t) => t.id === get().activeTabId)) set({ activeTabId: get().tabs.at(-1)?.id ?? null });
          api.del(`/api/people/${encodeURIComponent(id)}`).then(
            () => toast({ message: t("{name} is out of your contacts", { name: contact?.name || contact?.emails[0] || "" }) }),
            (err: ApiError) => {
              set({ contacts: prev });
              toast({ message: err.message });
            },
          );
        },
        mergeContacts: async (intoId, fromId) => {
          try {
            const contact = await api.post<Contact>(`/api/people/${encodeURIComponent(intoId)}/merge`, { from: fromId });
            set((s) => ({
              contacts: s.contacts.filter((c) => c.id !== fromId).map((c) => (c.id === intoId ? contact : c)),
              tabs: s.tabs.filter((t) => !(t.kind === "contact" && t.contactId === fromId)),
            }));
            toast({ message: t("Merged into {name}", { name: contact.name || contact.emails[0] }) });
          } catch (err) {
            toast({ message: (err as ApiError).message });
          }
        },
        writeTo: (email) => {
          const id = get().compose();
          get().updateDraft(id, { to: email });
        },

        openThreadById: async (id, opts) => {
          if (!get().threads[id] && LIVE) {
            try {
              const full = await fetchThread(id);
              set((s) => ({ threads: { ...s.threads, [id]: full } }));
            } catch (err) {
              toast({ message: (err as Error).message });
              return;
            }
          }
          get().openThread(id, opts);
        },

        loadThread: async (id, opts) => {
          if (!LIVE) return;
          const t = get().threads[id];
          if (!t || t.outboxId) return;
          if (!opts?.images && t.messages.every((m) => m.bodyLoaded)) return;
          try {
            const since = Date.now();
            const full = await fetchThread(id, opts?.images);
            set((s) => {
              const local = s.threads[id];
              const next = local && unsettled(id, since) ? keepLocal(full, local) : { ...full, unread: local?.unread ?? full.unread };
              return { threads: { ...s.threads, [id]: next } };
            });
          } catch (err) {
            if ((err as ApiError).status === 404) {
              set((s) => {
                const threads = { ...s.threads };
                delete threads[id];
                return { threads };
              });
            } else toast({ message: (err as Error).message });
          }
        },

        setScope: (scope) => {
          track("mailboxes");
          // In a folder that mailbox doesn't have: to its Inbox instead of an empty list.
          const own = ownFolderId(get().folder);
          const folder = own ? get().folders.find((f) => f.id === own) : undefined;
          const gone = !!folder && !folderInScope(folder, scope);
          unansweredAt = 0;
          set({ scope, selectedId: null, checked: [], checkAnchor: null, ...(gone ? { folder: "inbox" as const } : {}) });
          void get().refresh();
          if (get().query) void runSearch(get().query);
        },
        setOpenMailbox: (openMailbox) => {
          set({ openMailbox });
          if (LIVE) api.patch("/api/settings", { openMailbox }).catch(() => {});
        },
        setFolder: (folder) => {
          track(folderFeature(folder));
          set({ folder, selectedId: null, unreadOnly: false, checked: [], checkAnchor: null });
          void get().refresh();
          if (get().query) void runSearch(get().query);
        },
        setQuery: (query) => {
          if (query && !get().query) track("search");
          set({ query });
          if (!LIVE) return;
          clearTimeout(searchTimer);
          // Too short for the server: drop what an older search found (and any answer still on its way) right away.
          if (!serverSearchable(query)) return void runSearch(query);
          // Asked once typing pauses, not for every letter.
          searchTimer = setTimeout(() => void runSearch(query), 350);
        },
        toggleUnreadOnly: () => set((s) => ({ unreadOnly: !s.unreadOnly })),
        select: (id) => set({ selectedId: id }),

        checkThread: (id, mode, order) =>
          set((s) => {
            const active = openThreadId(s);
            if (mode === "tap") {
              return { checked: s.checked.includes(id) ? s.checked.filter((x) => x !== id) : [...s.checked, id], checkAnchor: id };
            }
            if (mode === "range") {
              const anchor = s.checkAnchor ?? active ?? id;
              const a = order.indexOf(anchor);
              const b = order.indexOf(id);
              if (a < 0 || b < 0) return { checked: [id], checkAnchor: id };
              return { checked: order.slice(Math.min(a, b), Math.max(a, b) + 1), checkAnchor: anchor };
            }
            // Like Finder: the first ⌘-click adds to the conversation that's already open.
            const base = s.checked.length ? s.checked : active && active !== id ? [active] : [];
            return { checked: base.includes(id) ? base.filter((x) => x !== id) : [...base, id], checkAnchor: id };
          }),
        checkAll: (order) => set({ checked: order, checkAnchor: order[0] ?? null }),
        clearChecked: () => set({ checked: [], checkAnchor: null }),

        archiveMany: (ids) => {
          const prevs = ids.map((id) => get().threads[id]).filter((t): t is Thread => !!t);
          if (prevs.some((t) => t.wokeAt)) get().earnStamps(["boomerang"]);
          bulk(prevs, { folder: "archive", folderId: null, snoozedUntil: undefined, followUpAt: undefined }, { folder: "archive" }, (n) => tn(n, "Archived {n} conversation", "Archived {n} conversations"), { sig: "archive" });
        },
        trashMany: (ids) => {
          const prevs = ids.map((id) => get().threads[id]).filter((t): t is Thread => !!t);
          bulk(prevs, { folder: "trash", folderId: null, snoozedUntil: undefined, followUpAt: undefined }, { folder: "trash" }, (n) => tn(n, "Deleted {n} conversation", "Deleted {n} conversations"), { sig: "trash" });
        },
        spamMany: (ids) => {
          const prevs = ids.map((id) => get().threads[id]).filter((t): t is Thread => !!t);
          bulk(prevs, { folder: "spam", folderId: null, snoozedUntil: undefined, followUpAt: undefined }, { folder: "spam" }, (n) => tn(n, "Moved {n} conversation to Spam", "Moved {n} conversations to Spam"), { sig: "spam" });
        },
        moveManyToInbox: (ids) => {
          const prevs = ids.map((id) => get().threads[id]).filter((t): t is Thread => !!t);
          const from = prevs[0]?.folder;
          const say = (n: number) =>
            from === "spam"
              ? tn(n, "Not spam · {n} conversation moved to Inbox", "Not spam · {n} conversations moved to Inbox")
              : from === "trash"
                ? tn(n, "Restored {n} conversation", "Restored {n} conversations")
                : tn(n, "Moved {n} conversation to Inbox", "Moved {n} conversations to Inbox");
          bulk(prevs, { folder: "inbox", folderId: null, snoozedUntil: undefined }, { folder: "inbox", snoozedUntil: null }, say, { sig: "inbox" });
        },
        moveToFolder: (ids, folderId) => {
          track("move");
          const folder = get().folders.find((f) => f.id === folderId);
          const prevs = ids.map((id) => get().threads[id]).filter((t): t is Thread => !!t && t.folderId !== folderId);
          if (!folder) return;
          if (prevs.length) get().countStamp("filed", prevs.length);
          bulk(
            prevs,
            { folderId, folder: "archive", snoozedUntil: undefined, followUpAt: undefined },
            { folderId },
            (n) => tn(n, "Moved {n} conversation to {folder}", "Moved {n} conversations to {folder}", { folder: folder.name }),
            { sig: "folder" },
          );
        },
        folders: [],
        createFolder: async (name, hue) => {
          // Made while one mailbox is picked: it's that mailbox's folder right away.
          const scope = get().scope;
          const accountId = scope === "all" ? undefined : scope;
          if (!LIVE) {
            const folder: MailFolder = { id: uid("fld"), name: name.trim(), hue: hue ?? 262, accountIds: accountId ? [accountId] : [] };
            set((s) => ({ folders: [...s.folders, folder] }));
            return folder;
          }
          const folder = await api.post<MailFolder>("/api/folders", { name, hue, accountId });
          set((s) => ({ folders: [...s.folders, folder] }));
          return folder;
        },
        updateFolder: async (id, patch) => {
          const prev = get().folders;
          set((s) => ({ folders: s.folders.map((f) => (f.id === id ? { ...f, ...patch } : f)) }));
          if (!LIVE) return;
          try {
            const folder = await api.patch<MailFolder>(`/api/folders/${id}`, patch);
            set((s) => ({ folders: s.folders.map((f) => (f.id === id ? { ...folder, unread: folder.unread ?? f.unread } : f)) }));
          } catch (err) {
            set({ folders: prev });
            toast({ message: (err as Error).message });
          }
        },
        deleteFolder: async (id) => {
          const { folders, threads, folder } = get();
          const gone = folders.find((f) => f.id === id);
          set((s) => ({
            folders: s.folders.filter((f) => f.id !== id),
            // What was in it is in Archive now.
            threads: Object.fromEntries(Object.entries(s.threads).map(([k, t]) => [k, t.folderId === id ? { ...t, folderId: null } : t])),
            ...(folder === `folder:${id}` ? { folder: "archive" as FolderId } : {}),
          }));
          if (!LIVE) return;
          try {
            await api.del(`/api/folders/${id}`);
            if (gone) toast({ message: t("Deleted {folder}. Its mail is in Archive.", { folder: gone.name }) });
          } catch (err) {
            set({ folders, threads });
            toast({ message: (err as Error).message });
          }
        },
        deleteForever: async (ids) => {
          const prevs = ids.map((id) => get().threads[id]).filter((t): t is Thread => !!t && isBin(t.folder));
          if (!prevs.length) return;
          const gone = new Set(prevs.map((t) => t.id));
          const drop = () =>
            set((s) => {
              const threads = Object.fromEntries(Object.entries(s.threads).filter(([id]) => !gone.has(id)));
              const tabs = s.tabs.filter((t) => !(t.kind === "thread" && gone.has(t.threadId)));
              return {
                threads,
                tabs,
                activeTabId: tabs.some((t) => t.id === s.activeTabId) ? s.activeTabId : null,
                checked: s.checked.filter((id) => !gone.has(id)),
              };
            });
          drop();
          const done = tn(prevs.length, "Deleted {n} conversation for good", "Deleted {n} conversations for good");
          if (!LIVE) return void toast({ message: done, sig: "trash" });
          try {
            const { failed } = await api.del<{ failed: string[] }>("/api/threads", { ids: [...gone] });
            if (failed.length) {
              set((s) => ({ threads: { ...s.threads, ...Object.fromEntries(prevs.filter((t) => failed.includes(t.id)).map((t) => [t.id, t])) } }));
              toast({ message: t("Couldn't delete {failed} of {total}. Try again.", { failed: failed.length, total: prevs.length }) });
            } else toast({ message: done, sig: "trash" });
          } catch (err) {
            set((s) => ({ threads: { ...s.threads, ...Object.fromEntries(prevs.map((t) => [t.id, t])) } }));
            toast({ message: (err as Error).message });
          }
        },
        emptyBin: async (folder) => {
          const { scope, accounts } = get();
          // Gmail empties its own Trash and Spam after 30 days and can't delete for good here.
          const canDelete = (accountId: string) => accounts.find((a) => a.id === accountId)?.provider !== "gmail";
          const ids = Object.values(get().threads)
            .filter((t) => t.folder === folder && (scope === "all" || t.accountId === scope) && canDelete(t.accountId))
            .map((t) => t.id);
          if (!LIVE) return get().deleteForever(ids);
          const prevs = ids.map((id) => get().threads[id]);
          set((s) => ({ threads: Object.fromEntries(Object.entries(s.threads).filter(([id]) => !ids.includes(id))) }));
          try {
            const { deleted } = await api.del<{ deleted: number }>(`/api/threads?folder=${folder}&scope=${encodeURIComponent(scope)}`);
            toast({
              message:
                folder === "trash"
                  ? tn(deleted, "Trash emptied · {n} conversation", "Trash emptied · {n} conversations")
                  : tn(deleted, "Spam emptied · {n} conversation", "Spam emptied · {n} conversations"),
            });
            void get().refresh();
          } catch (err) {
            set((s) => ({ threads: { ...s.threads, ...Object.fromEntries(prevs.map((t) => [t.id, t])) } }));
            toast({ message: (err as Error).message });
          }
        },
        setUnreadMany: (ids, unread) => {
          const prevs = ids.map((id) => get().threads[id]).filter((t): t is Thread => !!t);
          bulk(
            prevs,
            { unread },
            { unread },
            (n) => (unread ? tn(n, "Marked {n} conversation as unread", "Marked {n} conversations as unread") : tn(n, "Marked {n} conversation as read", "Marked {n} conversations as read")),
            { keepOpen: true, sig: "done" },
          );
        },
        setPinnedMany: (ids, pinned) => {
          const prevs = ids.map((id) => get().threads[id]).filter((t): t is Thread => !!t);
          bulk(prevs, { pinned }, { pinned }, (n) => (pinned ? tn(n, "Pinned {n} conversation", "Pinned {n} conversations") : tn(n, "Unpinned {n} conversation", "Unpinned {n} conversations")), { keepOpen: true, sig: pinned ? "pin" : "done" });
        },
        snoozeMany: (ids, until) => {
          get().markTried("snooze");
          track("snooze");
          const prevs = ids.map((id) => get().threads[id]).filter((t): t is Thread => !!t);
          // Filed mail waits in its own folder and comes back there; the rest comes back to Inbox.
          bulk(prevs, (t) => ({ snoozedUntil: until, ...(t.folderId ? {} : { folder: "inbox" as const }) }), { snoozedUntil: until }, (n) =>
            tn(n, "Snoozed {n} conversation until {time}", "Snoozed {n} conversations until {time}", { time: formatFuture(until) }),
            { sig: "snooze" },
          );
        },

        setMuted: (id, muted, nextId) => {
          const prev = get().threads[id];
          if (!prev) return;
          track("mute");
          // It leaves Inbox like an archive; elsewhere it stays put and only goes quiet.
          const leaves = muted && prev.folder === "inbox" && !prev.screening;
          if (leaves) markLeaving([id], "archive");
          patchThread(id, muted ? { muted: true, unread: false, ...(leaves ? { folder: "archive" as const } : {}) } : { muted: false });
          remote(id, { muted }, prev);
          if (leaves) advanceFrom(id, nextId);
          toast({
            message: muted ? t("Muted. New replies won't come to your Inbox.") : t("Unmuted. New replies come to your Inbox again."),
            sig: muted ? "archive" : "inbox",
            undo: () => {
              patchThread(id, { muted: prev.muted, folder: prev.folder, unread: prev.unread });
              remote(id, { muted: !!prev.muted, ...(leaves ? { folder: "inbox" as const } : {}), ...(prev.unread && muted ? { unread: true } : {}), undo: true }, get().threads[id]);
              if (leaves) get().openThread(id);
            },
          });
        },

        blockSender: async (sender, opts) => {
          track("block");
          const email = sender.email.toLowerCase();
          const domain = opts?.domain ? email.slice(email.lastIndexOf("@")) : null;
          const who = domain ? domain.slice(1) : sender.name || sender.email;
          const mine = new Set(get().accounts.map((a) => a.email.toLowerCase()));
          const matches = (address: string) => {
            const a = address.toLowerCase();
            return !mine.has(a) && (domain ? a.endsWith(domain) : a === email);
          };
          // What's in Inbox from them goes now, here too; the server confirms which it moved.
          const prevs = Object.values(get().threads).filter((th) => (th.folder === "inbox" || th.screening) && th.messages.some((m) => matches(m.from.email)));
          const ids = prevs.map((th) => th.id);
          if (ids.length) markLeaving(ids, "trash");
          for (const th of prevs) patchThread(th.id, { folder: "trash", screening: false, folderId: null, snoozedUntil: undefined });
          set((s) => {
            const tabs = s.tabs.filter((tab) => !(tab.kind === "thread" && ids.includes(tab.threadId)));
            return { tabs, activeTabId: tabs.some((tab) => tab.id === s.activeTabId) ? s.activeTabId : null };
          });
          const restore = () => set((s) => ({ threads: { ...s.threads, ...Object.fromEntries(prevs.map((th) => [th.id, th])) } }));
          if (!LIVE) {
            toast({ message: t("Blocked {sender}. What they send goes to Trash.", { sender: who }), sig: "trash", undo: restore });
            return;
          }
          try {
            const res = await api.post<{ key: string; threads: string[]; historyId: string | null }>("/api/senders", {
              email: sender.email,
              name: sender.name,
              block: domain ? "domain" : "address",
            });
            toast({
              message: t("Blocked {sender}. What they send goes to Trash.", { sender: who }),
              sig: "trash",
              duration: 6000,
              undo: async () => {
                restore();
                try {
                  if (res.historyId) await api.post(`/api/history/${res.historyId}/undo`);
                  else await api.del("/api/senders", { email: res.key });
                  toast({ message: t("Unblocked {sender}", { sender: who }) });
                } catch (err) {
                  toast({ message: (err as Error).message });
                }
                void get().refresh();
              },
            });
          } catch (err) {
            restore();
            toast({ message: (err as Error).message });
          }
        },

        remindIfNoReply: (id, at) => {
          const prev = get().threads[id];
          if (!prev) return;
          if (at) track("remind");
          patchThread(id, { followUpAt: at ?? undefined });
          remote(id, { followUpAt: at }, prev);
          toast({
            message: at ? t("I'll remind you {time} if nobody replies.", { time: formatFuture(at) }) : t("Reminder off"),
            sig: at ? "snooze" : "done",
            undo: () => {
              patchThread(id, { followUpAt: prev.followUpAt });
              remote(id, { followUpAt: prev.followUpAt ?? null, undo: true }, get().threads[id]);
            },
          });
        },

        notWaiting: (id) => {
          const prev = get().threads[id];
          if (!prev) return;
          markLeaving([id], "done");
          patchThread(id, { awaiting: false });
          remote(id, { noReplyDismissed: true }, prev);
          toast({
            message: t("Out of No reply yet"),
            sig: "done",
            undo: () => {
              patchThread(id, { awaiting: true });
              remote(id, { noReplyDismissed: false, undo: true }, get().threads[id]);
            },
          });
        },

        saveNote: async (id, note) => {
          const prev = get().threads[id];
          if (!prev) return;
          const text = note.trim();
          if ((prev.note ?? "") === text) return;
          if (text && !prev.note) track("note");
          patchThread(id, { note: text || undefined });
          if (!LIVE) return;
          try {
            await api.put(`/api/threads/${encodeURIComponent(id)}/note`, { note: text });
          } catch (err) {
            patchThread(id, { note: prev.note });
            toast({ message: (err as Error).message });
          }
        },

        openThread: (id, opts) => {
          const s = get();
          const thread = s.threads[id];
          if (!thread) return;
          if (thread.unread) {
            patchThread(id, { unread: false });
            remote(id, { unread: false }, thread);
          }
          void get().loadThread(id);

          const existing = s.tabs.find((t) => t.kind === "thread" && t.threadId === id);
          if (existing) {
            set({
              activeTabId: existing.id,
              selectedId: id,
              tabs: opts?.newTab
                ? s.tabs.map((t) => (t.id === existing.id ? { ...t, preview: false } : t))
                : s.tabs,
            });
            return;
          }

          const tab: Tab = { id: uid("tab"), kind: "thread", threadId: id, preview: !opts?.newTab };
          // Single click reuses the preview tab (like VS Code), so tabs don't pile up.
          const previewIdx = s.tabs.findIndex((t) => t.preview);
          const tabs = [...s.tabs];
          if (!opts?.newTab && previewIdx >= 0) tabs[previewIdx] = tab;
          else tabs.push(tab);
          set({ tabs, activeTabId: tab.id, selectedId: id });
        },

        openDraft: (id) => {
          const s = get();
          // A reply is written under its conversation, so that's where it opens (and j/k in Drafts goes on from it).
          const replyTo = s.drafts[id]?.threadId;
          if (replyTo && (LIVE || s.threads[replyTo])) {
            void get()
              .openThreadById(replyTo)
              .then(() => {
                const st = get();
                if (st.folder === "drafts" && st.tabs.some((t) => t.id === st.activeTabId && t.kind === "thread" && t.threadId === replyTo)) set({ selectedId: id });
              });
            return;
          }
          const existing = s.tabs.find((t) => t.kind === "draft" && t.draftId === id);
          if (existing) return set({ activeTabId: existing.id, selectedId: id });
          const tab: Tab = { id: uid("tab"), kind: "draft", draftId: id, preview: false };
          set({ tabs: [...s.tabs, tab], activeTabId: tab.id, selectedId: id });
        },

        openAddAccount: (email) => {
          const s = get();
          const existing = s.tabs.find((t) => t.kind === "add-account");
          if (existing) return set({ activeTabId: existing.id });
          const tab: Tab = { id: uid("tab"), kind: "add-account", preview: false, email };
          set({ tabs: [...s.tabs, tab], activeTabId: tab.id });
        },

        activityView: "agents",
        openActivity: (view) => {
          if (LIVE) void loadAgents();
          if (view) set({ activityView: view });
          if (view === "me") get().markTried("history");
          track((view ?? get().activityView) === "me" ? "history" : "activity");
          const s = get();
          const existing = s.tabs.find((t) => t.kind === "activity");
          if (existing) return set({ activeTabId: existing.id });
          const tab: Tab = { id: uid("tab"), kind: "activity", preview: false };
          set({ tabs: [...s.tabs, tab], activeTabId: tab.id });
        },

        setAgentEnabled: (id, enabled) => {
          const prev = get().agents.find((a) => a.id === id);
          set((s) => ({ agents: s.agents.map((a) => (a.id === id ? { ...a, enabled } : a)) }));
          const agent = get().agents.find((a) => a.id === id);
          if (agent) toast({ message: enabled ? t("{app} can use your mail again", { app: agent.app }) : t("{app} disconnected from your mail", { app: agent.app }) });
          if (LIVE && prev) {
            api.patch(`/api/agents/${id}`, { enabled }).catch((err: ApiError) => {
              set((s) => ({ agents: s.agents.map((a) => (a.id === id ? prev : a)) }));
              toast({ message: err.message });
            });
          }
        },

        setAgentPermission: (id, permission) => {
          const prev = get().agents.find((a) => a.id === id);
          set((s) => ({ agents: s.agents.map((a) => (a.id === id ? { ...a, permission } : a)) }));
          if (LIVE && prev) {
            api.patch(`/api/agents/${id}`, { permission }).catch((err: ApiError) => {
              set((s) => ({ agents: s.agents.map((a) => (a.id === id ? prev : a)) }));
              toast({ message: err.message });
            });
          }
        },

        removeAgent: (id) => {
          const prev = get().agents;
          const agent = prev.find((a) => a.id === id);
          set((s) => ({ agents: s.agents.filter((a) => a.id !== id) }));
          if (!LIVE) return;
          api.del(`/api/agents/${id}`).then(
            () => {
              if (agent) toast({ message: t("{app} removed", { app: agent.app }) });
              void loadAgents();
            },
            (err: ApiError) => {
              set({ agents: prev });
              toast({ message: err.message });
            },
          );
        },

        undoAgentEvent: (id) => {
          const event = get().agentEvents.find((e) => e.id === id);
          if (!event || event.undone || !event.undoable) return;
          if (LIVE) {
            // The server reverses the step through the mail service; then the lists catch up.
            const mark = (e: AgentEvent) => set((s) => ({ agentEvents: s.agentEvents.map((x) => (x.id === id ? e : x)) }));
            mark({ ...event, undone: true });
            api
              .post<{ event: AgentEvent; draft?: { removed?: string; restored?: Draft } }>(`/api/agents/events/${id}/undo`)
              .then(({ event: next, draft }) => {
                mark(next);
                if (draft)
                  set((s) => {
                    const drafts = { ...s.drafts };
                    if (draft.removed) delete drafts[draft.removed];
                    if (draft.restored) drafts[draft.restored.id] = draft.restored;
                    return { drafts };
                  });
                if (event.threadId && get().threads[event.threadId]) void get().loadThread(event.threadId);
                void get().refresh();
                toast({ message: t("Undone") });
              })
              .catch((err: ApiError) => {
                mark(event);
                toast({ message: err.message });
              });
            return;
          }
          const th = event.threadId ? get().threads[event.threadId] : undefined;
          switch (event.action) {
            case "archive":
              if (th) patchThread(th.id, { folder: "inbox" });
              break;
            case "mark_read":
              if (th) patchThread(th.id, { unread: true });
              break;
            case "snooze":
              if (th) patchThread(th.id, { snoozedUntil: undefined });
              break;
            case "pin":
              if (th) patchThread(th.id, { pinned: !th.pinned });
              break;
            case "schedule":
              if (th) get().cancelScheduled(th.id);
              break;
            case "draft": {
              const d = Object.values(get().drafts).find((x) => x.threadId === event.threadId && x.agentId);
              if (d)
                set((s) => {
                  const drafts = { ...s.drafts };
                  delete drafts[d.id];
                  return { drafts };
                });
              break;
            }
          }
          set((s) => ({ agentEvents: s.agentEvents.map((e) => (e.id === id ? { ...e, undone: true } : e)) }));
          toast({ message: t("Undone") });
        },

        closeTab: (tabId) =>
          set((s) => {
            const idx = s.tabs.findIndex((t) => t.id === tabId);
            if (idx < 0) return s;
            const tabs = s.tabs.filter((t) => t.id !== tabId);
            let activeTabId = s.activeTabId;
            if (s.activeTabId === tabId) activeTabId = (tabs[idx] ?? tabs[idx - 1])?.id ?? null;
            return { tabs, activeTabId };
          }),

        activateTab: (tabId) =>
          set((s) => {
            const tab = s.tabs.find((t) => t.id === tabId);
            const selectedId = tab?.kind === "thread" ? tab.threadId : tab?.kind === "draft" ? tab.draftId : s.selectedId;
            return { activeTabId: tabId, selectedId };
          }),

        cycleTab: (delta) => {
          const { tabs, activeTabId, activateTab } = get();
          if (tabs.length < 2) return;
          const idx = tabs.findIndex((t) => t.id === activeTabId);
          activateTab(tabs[(idx + delta + tabs.length) % tabs.length].id);
        },

        keepTab: (tabId) =>
          set((s) => ({ tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, preview: false } : t)) })),

        archive: (id, nextId) => moveAway(id, "archive", nextId, t("Archived")),
        trash: (id, nextId) => moveAway(id, "trash", nextId, t("Deleted")),
        spam: (id, nextId) => moveAway(id, "spam", nextId, t("Moved to Spam")),

        moveToInbox: (id) => {
          const prev = get().threads[id];
          if (!prev) return;
          markLeaving([id], "inbox");
          patchThread(id, { folder: "inbox", snoozedUntil: undefined });
          remote(id, { folder: "inbox", snoozedUntil: null }, prev);
          toast({ message: prev.folder === "spam" ? t("Not spam · moved to Inbox") : prev.folder === "trash" ? t("Restored to Inbox") : t("Moved to Inbox"), sig: "inbox" });
        },

        togglePin: (id) => {
          const t = get().threads[id];
          if (!t) return;
          patchThread(id, { pinned: !t.pinned });
          remote(id, { pinned: !t.pinned }, t);
        },

        setUnread: (id, unread) => {
          const prev = get().threads[id];
          patchThread(id, { unread });
          remote(id, { unread }, prev);
        },

        snooze: (id, until, nextId) => {
          get().markTried("snooze");
          track("snooze");
          const prev = get().threads[id];
          if (!prev) return;
          // Filed mail waits in its own folder and comes back there; the rest comes back to Inbox.
          const filed = !!prev.folderId;
          markLeaving([id], "snooze");
          patchThread(id, { snoozedUntil: until, ...(filed ? {} : { folder: "inbox" as const }) });
          remote(id, { snoozedUntil: until, ...(!filed && prev.folder !== "inbox" ? { folder: "inbox" as const } : {}) }, prev);
          advanceFrom(id, nextId);
          toast({
            message: t("Snoozed until {time}", { time: formatFuture(until) }),
            sig: "snooze",
            undo: () => {
              patchThread(id, { snoozedUntil: prev.snoozedUntil, folder: prev.folder });
              remote(
                id,
                { snoozedUntil: prev.snoozedUntil ?? null, ...(prev.folder === "archive" && !filed ? { folder: "archive" as const } : {}), undo: true },
                get().threads[id],
              );
              get().openThread(id);
            },
          });
        },

        unsnooze: (id) => {
          const prev = get().threads[id];
          patchThread(id, { snoozedUntil: undefined });
          remote(id, { snoozedUntil: null }, prev);
          const folder = prev?.folderId ? get().folders.find((f) => f.id === prev.folderId) : undefined;
          toast({ message: folder ? t("Back in {folder}", { folder: folder.name }) : t("Back in Inbox"), sig: "wake" });
        },

        cancelScheduled: (id) => {
          const th = get().threads[id];
          if (!th) return;
          if (LIVE && th.outboxId) {
            set((s) => {
              const threads = { ...s.threads };
              delete threads[id];
              return { threads, tabs: s.tabs.filter((tab) => !(tab.kind === "thread" && tab.threadId === id)) };
            });
            api
              .del<{ draft: Draft }>(`/api/outbox/${th.outboxId}`)
              .then(({ draft }) => {
                set((s) => ({ drafts: { ...s.drafts, [draft.id]: draft } }));
                get().openDraft(draft.id);
                toast({ message: t("Moved back to drafts") });
              })
              .catch((err: ApiError) => {
                set((s) => ({ threads: { ...s.threads, [id]: th } }));
                toast({ message: err.message });
              });
            return;
          }
          const m = lastMessage(th);
          const draftId = randomId("draft");
          set((s) => {
            const threads = { ...s.threads };
            delete threads[id];
            const draft: Draft = {
              id: draftId,
              accountId: th.accountId,
              to: m.to.map((p) => p.email).join(", "),
              cc: (m.cc ?? []).map((p) => p.email).join(", "),
              subject: th.subject,
              html: m.html,
              updatedAt: Date.now(),
            };
            return {
              threads,
              drafts: { ...s.drafts, [draftId]: draft },
              tabs: s.tabs.filter((tab) => !(tab.kind === "thread" && tab.threadId === id)),
            };
          });
          get().openDraft(draftId);
          toast({ message: t("Moved back to drafts") });
        },

        compose: (accountId) => {
          track("compose");
          const s = get();
          const fallback = s.scope !== "all" ? s.scope : s.accounts[0].id;
          const draft: Draft = {
            id: randomId("draft"),
            accountId: accountId ?? fallback,
            to: "",
            cc: "",
            subject: "",
            html: "",
            updatedAt: Date.now(),
          };
          set({ drafts: { ...s.drafts, [draft.id]: draft } });
          get().openDraft(draft.id);
          return draft.id;
        },

        reply: (threadId, mode = "reply") => {
          track(mode);
          const s = get();
          const t = s.threads[threadId];
          if (!t) return "";
          const existing = Object.values(s.drafts).find((d) => d.threadId === threadId);
          if (existing) return existing.id;
          const account = s.accounts.find((a) => a.id === t.accountId)!;
          const last = lastMessage(t);
          const counterpart = threadCounterpart(t, s.accounts);
          const everyone = [last.from, ...last.to, ...(last.cc ?? [])]
            .filter((p) => p.email !== account.email)
            .map((p) => p.email);
          const draft: Draft = {
            id: randomId("draft"),
            accountId: t.accountId,
            threadId: mode === "forward" ? undefined : threadId,
            to: mode === "forward" ? "" : mode === "replyAll" ? [...new Set(everyone)].join(", ") : counterpart.email,
            cc: "",
            subject: mode === "forward" ? `Fwd: ${t.subject}` : t.subject.startsWith("Re:") ? t.subject : `Re: ${t.subject}`,
            html: mode === "forward" ? `<p></p><blockquote>${last.html}</blockquote>` : "",
            updatedAt: Date.now(),
          };
          const files = mode === "forward" ? (last.attachments ?? []) : [];
          // The demo has no server: the forwarded files show as chips.
          if (!LIVE && files.length) draft.attachments = files.map((a) => ({ id: randomId("local"), name: a.name, size: 0, mime: "" }));
          set({ drafts: { ...s.drafts, [draft.id]: draft } });
          if (mode === "forward") {
            // The files (and pictures in the text) go with a forward: the server copies them into the draft.
            if (LIVE && (files.length || last.html.includes("/api/attachments/"))) {
              const done = saveDraftNow(draft).then(() =>
                api.post<ForwardedFiles>(`/api/drafts/${encodeURIComponent(draft.id)}/attachments/from-message`, { messageId: last.id }),
              );
              trackForwardCopy(draft.id, { files, done });
              done
                .then((copied) => {
                  const d = get().drafts[draft.id];
                  if (!d) return;
                  get().updateDraft(d.id, {
                    attachments: [...(d.attachments ?? []), ...copied.attachments],
                    html: withForwardedImages(d.html, copied.images),
                  });
                })
                .catch(() => {});
            }
            get().openDraft(draft.id);
          }
          return draft.id;
        },

        snippets: [],
        saveSnippet: async ({ id, name, html }) => {
          const byName = (a: Snippet, b: Snippet) => a.name.localeCompare(b.name);
          if (!LIVE) {
            const saved = { id: id ?? uid("snp"), name, html };
            set((s) => ({ snippets: [...s.snippets.filter((x) => x.id !== saved.id), saved].sort(byName) }));
            return saved;
          }
          const saved = id ? await api.put<Snippet>(`/api/snippets/${id}`, { name, html }) : await api.post<Snippet>("/api/snippets", { name, html });
          set((s) => ({ snippets: [...s.snippets.filter((x) => x.id !== saved.id), saved].sort(byName) }));
          return saved;
        },
        deleteSnippet: (id) => {
          const prev = get().snippets;
          set({ snippets: prev.filter((x) => x.id !== id) });
          if (LIVE) api.del(`/api/snippets/${id}`).catch(() => set({ snippets: prev }));
        },

        updateDraft: (id, patch) => {
          set((s) =>
            s.drafts[id] ? { drafts: { ...s.drafts, [id]: { ...s.drafts[id], ...patch, updatedAt: Date.now() } } } : s,
          );
          const draft = get().drafts[id];
          if (LIVE && draft) saveDraftSoon(draft);
        },

        discardDraft: (id) => {
          const draft = get().drafts[id];
          if (!draft) return;
          set((s) => {
            const drafts = { ...s.drafts };
            delete drafts[id];
            return { drafts };
          });
          const tab = get().tabs.find((t) => t.kind === "draft" && t.draftId === id);
          if (tab) get().closeTab(tab.id);
          if (LIVE) {
            cancelDraftSave(id);
            api.del(`/api/drafts/${id}`).catch(() => {});
          }
          toast({
            message: t("Draft discarded"),
            sig: "trash",
            undo: () => {
              set((s) => ({ drafts: { ...s.drafts, [id]: draft } }));
              if (LIVE) saveDraftSoon(draft);
              if (!draft.threadId) get().openDraft(id);
            },
          });
        },

        discardDrafts: (ids) => {
          const gone = ids.map((id) => get().drafts[id]).filter(Boolean);
          if (!gone.length) return;
          const drop = new Set(gone.map((d) => d.id));
          set((s) => {
            const drafts = { ...s.drafts };
            for (const id of drop) delete drafts[id];
            return { drafts, checked: s.checked.filter((id) => !drop.has(id)) };
          });
          for (const d of gone) {
            const tab = get().tabs.find((x) => x.kind === "draft" && x.draftId === d.id);
            if (tab) get().closeTab(tab.id);
            if (LIVE) {
              cancelDraftSave(d.id);
              api.del(`/api/drafts/${d.id}`).catch(() => {});
            }
          }
          toast({
            message: gone.length === 1 ? t("Draft discarded") : tn(gone.length, "{n} draft discarded", "{n} drafts discarded"),
            sig: "trash",
            undo: () => {
              set((s) => ({ drafts: { ...s.drafts, ...Object.fromEntries(gone.map((d) => [d.id, d])) } }));
              if (LIVE) for (const d of gone) saveDraftSoon(d);
            },
          });
        },

        sendDraft: (id, opts) => {
          if (opts?.scheduleAt) {
            get().markTried("schedule");
            track("schedule");
          }
          const s = get();
          const draft = s.drafts[id];
          if (!draft) return;
          // Stamps for sending: the first letter, Christmas post, a reply in a long or an old conversation.
          const replyTo = draft.threadId ? s.threads[draft.threadId] : undefined;
          const mine = new Set(s.accounts.map((a) => a.email));
          const lastFromOthers = replyTo && [...replyTo.messages].reverse().find((m) => !mine.has(m.from.email))?.date;
          get().earnStamps([...sendStamps(new Date(), replyTo && { messages: replyTo.messages.length, lastFromOthers }), ...(replyTo?.wokeAt ? (["boomerang"] as const) : [])]);
          if (LIVE) return liveSend(draft, opts);
          const account = s.accounts.find((a) => a.id === draft.accountId)!;
          const contacts = getContacts(s.threads, s.accounts);
          const message = {
            id: uid("msg"),
            from: { name: ME_NAME, email: account.email },
            to: parseRecipients(draft.to, contacts),
            cc: parseRecipients(draft.cc, contacts),
            date: Date.now(),
            html: draft.html + account.signature,
            tracked: opts?.track || undefined,
            opens: opts?.track ? [] : undefined,
          };
          const followUpAt = opts?.followUpDays ? Date.now() + opts.followUpDays * DAY : undefined;

          // Take the draft out of the UI immediately; the actual send waits for the undo window.
          set((st) => {
            const drafts = { ...st.drafts };
            delete drafts[id];
            return { drafts };
          });
          const tab = get().tabs.find((t) => t.kind === "draft" && t.draftId === id);
          if (tab) get().closeTab(tab.id);

          const restore = () => {
            const timer = pendingSends.get(id);
            if (timer) clearTimeout(timer);
            pendingSends.delete(id);
            set((st) => ({ drafts: { ...st.drafts, [id]: draft } }));
            if (draft.threadId) get().openThread(draft.threadId);
            else get().openDraft(id);
          };

          if (opts?.scheduleAt) {
            const threadId = uid("thread");
            set((st) => ({
              threads: {
                ...st.threads,
                [threadId]: {
                  id: threadId,
                  accountId: draft.accountId,
                  subject: draft.subject || t("(no subject)"),
                  messages: [{ ...message, date: opts.scheduleAt! }],
                  unread: false,
                  pinned: false,
                  folder: "scheduled",
                  scheduledAt: opts.scheduleAt,
                  followUpAt,
                  kind: "person",
                },
              },
            }));
            toast({
              message: t("Scheduled for {time}", { time: formatFuture(opts.scheduleAt) }),
              sig: "schedule",
              undo: () => {
                set((st) => {
                  const threads = { ...st.threads };
                  delete threads[threadId];
                  return { threads };
                });
                restore();
              },
            });
            return;
          }

          const undoMs = get().undoSendSeconds * 1000;
          const toastId = toast({ message: t("Sending…"), undo: restore, duration: undoMs, countdown: true, sig: "send" });
          const targetThreadId = draft.threadId && s.threads[draft.threadId] ? draft.threadId : uid("thread");
          const timer = setTimeout(() => {
            pendingSends.delete(id);
            get().dismissToast(toastId);
            set((st) => {
              if (st.threads[targetThreadId]) {
                const t = st.threads[targetThreadId];
                return {
                  threads: {
                    ...st.threads,
                    [t.id]: { ...t, messages: [...t.messages, message], sentAt: message.date, followUpAt: followUpAt ?? t.followUpAt },
                  },
                };
              }
              return {
                threads: {
                  ...st.threads,
                  [targetThreadId]: {
                    id: targetThreadId,
                    accountId: draft.accountId,
                    subject: draft.subject || t("(no subject)"),
                    messages: [message],
                    unread: false,
                    pinned: false,
                    folder: "sent",
                    sentAt: message.date,
                    followUpAt,
                    kind: "person",
                  },
                },
              };
            });
            toast({ message: followUpAt ? t("Sent · reminder {time}", { time: formatFuture(followUpAt) }) : t("Message sent"), sig: "done" });

            // Prototype only: pretend the recipient opens it a little later, so the receipt UI can be tried.
            const reader = message.to[0];
            if (message.tracked && reader) {
              setTimeout(() => {
                get().recordOpen(targetThreadId, message.id, { at: Date.now(), client: randomClient() });
                toast({ message: t("{name} opened “{subject}”", { name: reader.name.split(" ")[0], subject: draft.subject || t("(no subject)") }), icon: "eye", duration: 5000 });
              }, 12_000 + Math.random() * 10_000);
            }
          }, undoMs);
          pendingSends.set(id, timer);
        },

        recordOpen: (threadId, messageId, event) =>
          set((st) => {
            const t = st.threads[threadId];
            if (!t) return st;
            const messages = t.messages.map((m) => (m.id === messageId ? { ...m, opens: [...(m.opens ?? []), event] } : m));
            return { threads: { ...st.threads, [threadId]: { ...t, messages } } };
          }),

        updateAccount: (id, patch) => {
          set((s) => ({ accounts: s.accounts.map((a) => (a.id === id ? { ...a, ...patch } : a)) }));
          if (LIVE) {
            clearTimeout(accountTimers.get(id));
            accountTimers.set(
              id,
              setTimeout(() => {
                const a = get().accounts.find((x) => x.id === id);
                if (a) api.patch(`/api/accounts/${id}`, { name: a.name, hue: a.hue, icon: a.icon, signature: a.signature, mcpEnabled: a.mcpEnabled }).catch(() => {});
              }, 500),
            );
          }
        },

        setAccountImage: async (id, dataUrl) => {
          const prev = get().accounts.find((a) => a.id === id);
          if (!prev) return;
          set((s) => ({ accounts: s.accounts.map((a) => (a.id === id ? { ...a, image: dataUrl } : a)) }));
          if (!LIVE) return;
          try {
            if (dataUrl) await api.put(`/api/accounts/${id}/image`, { dataUrl });
            else await api.del(`/api/accounts/${id}/image`);
            // The server hands back a cacheable URL instead of the data: URL.
            await get().refreshAccounts();
          } catch (err) {
            set((s) => ({ accounts: s.accounts.map((a) => (a.id === id ? { ...a, image: prev.image } : a)) }));
            toast({ message: (err as Error).message });
          }
        },

        addAccount: (account) => {
          const id = uid("acc");
          set((s) => ({ accounts: [...s.accounts, { ...account, id }] }));
          toast({ message: t("{name} connected", { name: account.name }) });
        },

        removeAccount: async (id) => {
          const account = get().accounts.find((a) => a.id === id);
          if (!account) return;
          if (LIVE) await api.del(`/api/accounts/${id}`);
          set((s) => {
            const threads = Object.fromEntries(Object.entries(s.threads).filter(([, t]) => t.accountId !== id));
            const drafts = Object.fromEntries(Object.entries(s.drafts).filter(([, d]) => d.accountId !== id));
            const tabs = s.tabs.filter((t) => (t.kind === "thread" ? !!threads[t.threadId] : t.kind === "draft" ? !!drafts[t.draftId] : true));
            return {
              accounts: s.accounts.filter((a) => a.id !== id),
              threads,
              drafts,
              tabs,
              activeTabId: tabs.some((t) => t.id === s.activeTabId) ? s.activeTabId : null,
              selectedId: s.selectedId && threads[s.selectedId] ? s.selectedId : null,
              scope: s.scope === id ? "all" : s.scope,
              openMailbox: s.openMailbox === id ? "all" : s.openMailbox,
            };
          });
          toast({ message: t("{name} disconnected", { name: account.name }) });
        },

        setDensity: (density) => {
          set({ density });
          if (LIVE) api.patch("/api/settings", { density }).catch(() => {});
        },
        setUndoSendSeconds: (undoSendSeconds) => {
          set({ undoSendSeconds });
          if (LIVE) api.patch("/api/settings", { undoSendSeconds }).catch(() => {});
        },
        setTheme: (theme) => {
          set({ theme });
          if (LIVE) api.patch("/api/settings", { theme }).catch(() => {});
        },
        setSwipe: (side, action) => {
          const key = side === "left" ? "swipeLeft" : "swipeRight";
          set({ [key]: action } as Pick<MailState, "swipeLeft"> | Pick<MailState, "swipeRight">);
          if (LIVE) api.patch("/api/settings", { [key]: action }).catch(() => {});
        },
        setSmartCategories: (smartCategories) => {
          if (smartCategories && !plusAllows()) return get().askForPlus();
          set({ smartCategories });
          if (LIVE) void turnPlusFeature({ smartCategories }, () => set({ smartCategories: !smartCategories }));
        },
        plus: null,
        billing: false,
        selfHosted: false,
        aiAvailable: true,
        refreshPlus: async (opts) => {
          if (!LIVE) return;
          const res = await api.get<{ plus: PlusState; billing: boolean }>(`/api/billing${opts?.stripe ? "?refresh=1" : ""}`).catch(() => null);
          if (res) set({ plus: res.plus, billing: res.billing });
        },
        // Both are pressed inside Settings, which covers the toasts: the panel shows what went wrong itself.
        subscribePlus: async (interval) => {
          track("plusCheckout");
          try {
            const { url } = await api.post<{ url: string }>("/api/billing/checkout", { interval });
            window.location.assign(url);
            return null;
          } catch (err) {
            return (err as Error).message;
          }
        },
        managePlus: async () => {
          try {
            const { url } = await api.post<{ url: string }>("/api/billing/portal");
            window.location.assign(url);
            return null;
          } catch (err) {
            return (err as Error).message;
          }
        },
        askForPlus: () => {
          toast({
            message: t("Your Kolbaba Plus trial has ended. Cards you already have stay."),
            action: { label: t("See Plus"), run: () => get().setSettingsOpen(true, "smart") },
            duration: 8000,
          });
        },
        dismissInsight: (key) => {
          const before = Object.values(get().threads).filter((th) => th.insight?.key === key);
          if (!before.length) return;
          const apply = (hide: boolean) =>
            set((s) => ({
              threads: { ...s.threads, ...Object.fromEntries(before.map((th) => [th.id, hide ? { ...s.threads[th.id], insight: undefined } : { ...s.threads[th.id], insight: th.insight }])) },
            }));
          const send = (dismissed: boolean) =>
            LIVE
              ? api.patch("/api/insights", { key, dismissed }).catch((err: Error) => {
                  apply(!dismissed);
                  toast({ message: err.message });
                })
              : undefined;
          track("hideCard");
          apply(true);
          void send(true);
          toast({
            message: t("Card hidden. Hide a few more like it and that sender's cards of this kind stop."),
            undo: () => {
              apply(false);
              void send(false);
            },
          });
        },
        screener: false,
        sidebar: {},
        setSidebar: (sidebar) => {
          set({ sidebar });
          if (!LIVE) return;
          clearTimeout(sidebarTimer);
          sidebarTimer = setTimeout(() => api.patch("/api/settings", { sidebar: get().sidebar }).catch(() => {}), 600);
        },
        sidebarEditing: false,
        setSidebarEditing: (sidebarEditing) => {
          if (sidebarEditing) get().markTried("sidebar");
          set(sidebarEditing ? { sidebarEditing, drawerOpen: true } : { sidebarEditing });
        },
        collectionOpen: false,
        setCollectionOpen: (collectionOpen) => {
          if (collectionOpen) track("collection");
          set({ collectionOpen });
        },
        newsOpen: false,
        setNewsOpen: (newsOpen) => {
          if (newsOpen) track("news");
          set({ newsOpen });
          if (newsOpen) get().markNewsSeen();
        },
        newsSeen: null,
        markNewsSeen: () => {
          if (get().newsSeen === LATEST_NOTE) return;
          set({ newsSeen: LATEST_NOTE });
          if (LIVE) api.patch("/api/settings", { newsSeen: LATEST_NOTE }).catch(() => {});
        },
        tried: [],
        markTried: (id) => {
          if (get().tried.includes(id)) return;
          set((s) => ({ tried: [...s.tried, id] }));
          if (!LIVE) return;
          clearTimeout(triedTimer);
          triedTimer = setTimeout(() => api.patch("/api/settings", { tried: get().tried.slice(-40) }).catch(() => {}), 1500);
        },
        tipShownAt: null,
        markTipShown: () => {
          const at = Date.now();
          set({ tipShownAt: at });
          if (LIVE) api.patch("/api/settings", { tipShownAt: at }).catch(() => {});
        },
        setScreener: (screener) => {
          set({ screener });
          if (LIVE) api.patch("/api/settings", { screener }).catch(() => set({ screener: !screener }));
        },
        screenSender: (sender, status) => {
          if (status === "blocked") get().countStamp("screenedOut");
          const email = sender.email.toLowerCase();
          const from = (t: Thread) => t.messages[0]?.from.email.toLowerCase();
          set((s) => ({
            threads: Object.fromEntries(
              Object.entries(s.threads).map(([id, t]) =>
                t.screening && from(t) === email ? [id, { ...t, screening: false, ...(status === "blocked" ? { folder: "archive" as const } : {}) }] : [id, t],
              ),
            ),
          }));
          toast({
            message:
              status === "allowed"
                ? t("{name} can reach your Inbox now", { name: sender.name || sender.email })
                : t("Mail from {name} goes to Archive. You can change that in Settings.", { name: sender.name || sender.email }),
          });
          if (LIVE) api.post("/api/senders", { email: sender.email, name: sender.name, status }).then(() => get().refresh(), () => get().refresh());
        },
        summaries: true,
        setSummaries: (summaries) => {
          set({ summaries });
          if (LIVE) api.patch("/api/settings", { summaries }).catch(() => set({ summaries: !summaries }));
        },
        replyReminders: false,
        setReplyReminders: (replyReminders) => {
          if (replyReminders && !plusAllows()) return get().askForPlus();
          set({ replyReminders });
          if (LIVE) void turnPlusFeature({ replyReminders }, () => set({ replyReminders: !replyReminders }));
        },
        setTrackByDefault: (trackByDefault) => {
          set({ trackByDefault });
          if (LIVE) api.patch("/api/settings", { trackByDefault }).catch(() => {});
        },
        setAccent: (accent) => {
          set({ accent });
          if (LIVE) api.patch("/api/settings", { accent }).catch(() => {});
        },
        setLanguage: (language) => {
          set({ language });
          // The server keeps the resolved language too, for notifications.
          if (LIVE) api.patch("/api/settings", { language, locale: resolveLocale(language) }).catch(() => {});
        },
        setSettingsOpen: (settingsOpen, section) => {
          if (settingsOpen) track("settings");
          set({ settingsOpen, settingsSection: section ?? null });
        },
        unsubscribe: async (id) => {
          const thread = get().threads[id];
          if (!thread || !LIVE) return null;
          track("unsubscribe");
          try {
            const res = await api.post<{ sender: Person | null; inbox: number; total: number }>(`/api/threads/${encodeURIComponent(id)}/unsubscribe`);
            patchThread(id, { unsubscribedAt: Date.now() });
            get().countStamp("unsubscribed");
            // With more of their mail around, the reader offers to clean it up instead of this toast.
            if (!res.sender || !res.total) toast({ message: t("Unsubscribed. Mail that's already here stays."), sig: "snip" });
            return res.sender ? { sender: res.sender, inbox: res.inbox, total: res.total } : null;
          } catch (err) {
            toast({ message: (err as ApiError).message });
            return null;
          }
        },
        cleanUpSender: async (sender, to) => {
          const email = sender.email.toLowerCase();
          const who = sender.name || sender.email;
          // Here too, right away (pinned ones stay, like on the server).
          const prevs = Object.values(get().threads).filter(
            (th) => !th.pinned && (to === "archive" ? th.folder === "inbox" : th.folder === "inbox" || th.folder === "archive") && th.messages.some((m) => m.from.email.toLowerCase() === email),
          );
          markLeaving(prevs.map((th) => th.id), to);
          for (const th of prevs) patchThread(th.id, { folder: to, folderId: null });
          const restore = () => set((s) => ({ threads: { ...s.threads, ...Object.fromEntries(prevs.map((th) => [th.id, th])) } }));
          if (!LIVE) return;
          try {
            const res = await api.post<{ threads: string[]; historyId: string | null }>("/api/senders/cleanup", { email, to });
            const n = res.threads.length;
            toast({
              message:
                to === "archive"
                  ? tn(n, "Archived {n} conversation from {sender}", "Archived {n} conversations from {sender}", { sender: who })
                  : tn(n, "Deleted {n} conversation from {sender}", "Deleted {n} conversations from {sender}", { sender: who }),
              sig: to,
              duration: 6000,
              undo: res.historyId
                ? async () => {
                    restore();
                    await api.post(`/api/history/${res.historyId}/undo`).catch((err: Error) => toast({ message: err.message }));
                    void get().refresh();
                  }
                : undefined,
            });
            void get().refresh();
          } catch (err) {
            restore();
            toast({ message: (err as Error).message });
          }
        },
        setInsightDone: (key, done) => {
          const before = new Map(Object.values(get().threads).flatMap((th) => (th.insight?.key === key ? [[th.id, th.insight.doneAt ?? null] as const] : [])));
          const apply = (doneAt: (id: string) => number | null) =>
            set((s) => ({
              threads: Object.fromEntries(
                Object.entries(s.threads).map(([id, th]) => [id, th.insight?.key === key ? { ...th, insight: { ...th.insight, doneAt: doneAt(id) } } : th]),
              ),
            }));
          const at = Date.now();
          apply(() => (done ? at : null));
          if (LIVE)
            api.patch("/api/insights", { key, done }).catch((err: Error) => {
              apply((id) => before.get(id) ?? null);
              toast({ message: err.message });
            });
        },
        setPaletteOpen: (paletteOpen) => {
          if (paletteOpen) {
            get().markTried("palette");
            track("palette");
          }
          set({ paletteOpen });
        },
        setDrawerOpen: (drawerOpen) => set(drawerOpen ? { drawerOpen } : { drawerOpen, sidebarEditing: false }),

        quietHours: { on: false, from: "22:00", to: "07:00", tz: browserZone() },
        setQuietHours: (quietHours) => {
          const prev = get().quietHours;
          // The night is the one where the user is now.
          const next = { ...quietHours, tz: browserZone() };
          if (next.on && !prev.on) track("quietHours");
          set({ quietHours: next });
          if (LIVE) api.patch("/api/settings", { quietHours: next }).catch(() => set({ quietHours: prev }));
        },
        codeInNotification: true,
        setCodeInNotification: (codeInNotification) => {
          set({ codeInNotification });
          if (LIVE) api.patch("/api/settings", { codeInNotification }).catch(() => set({ codeInNotification: !codeInNotification }));
        },
        badgeMode: "all",
        setBadgeMode: (badgeMode) => {
          const prev = get().badgeMode;
          set({ badgeMode });
          if (LIVE) api.patch("/api/settings", { badge: badgeMode }).catch(() => set({ badgeMode: prev }));
        },
        setNotifyMode: (accountId, mode) => {
          const prev = get().accounts.find((a) => a.id === accountId)?.notify ?? "all";
          if (mode !== "all") track("notifyMode");
          const apply = (notify: NotifyMode) => set((s) => ({ accounts: s.accounts.map((a) => (a.id === accountId ? { ...a, notify } : a)) }));
          apply(mode);
          if (LIVE)
            api.patch(`/api/accounts/${accountId}`, { notify: mode }).catch((err: ApiError) => {
              apply(prev);
              toast({ message: err.message });
            });
        },
        vips: [],
        setVip: async (person, vip) => {
          const email = person.email.toLowerCase();
          const prev = get().vips;
          const who = person.name || person.email;
          if (vip) track("vip");
          set({ vips: vip ? [...new Set([...prev, email])] : prev.filter((e) => e !== email) });
          const say = () =>
            toast({
              message: vip ? t("{name} is a VIP now: their mail always notifies, even in quiet hours.", { name: who }) : t("{name} is no longer a VIP", { name: who }),
              sig: vip ? "pin" : "done",
            });
          if (!LIVE) return void say();
          try {
            const contact = await api.post<Contact>("/api/people/lookup", { email: person.email, name: person.name });
            const saved = await api.patch<Contact>(`/api/people/${encodeURIComponent(contact.id)}`, { vip });
            set((s) => ({
              contacts: s.contacts.some((c) => c.id === saved.id) ? s.contacts.map((c) => (c.id === saved.id ? saved : c)) : s.contacts,
              // A contact with several addresses: all of them are the VIP.
              vips: vip ? [...new Set([...s.vips, ...saved.emails])] : s.vips.filter((e) => !saved.emails.includes(e)),
            }));
            say();
          } catch (err) {
            set({ vips: prev });
            toast({ message: (err as Error).message });
          }
        },
        setWatched: (id, watched) => {
          const prev = get().threads[id];
          if (!prev) return;
          if (watched) track("watch");
          patchThread(id, watched ? { watched: true, muted: false } : { watched: false });
          remote(id, { watched }, prev);
          toast({
            message: watched ? t("You'll be notified of replies here, even in quiet hours.") : t("Replies here notify like the rest of the mailbox."),
            sig: watched ? "pin" : "done",
            undo: () => {
              patchThread(id, { watched: prev.watched, muted: prev.muted });
              remote(id, { watched: !!prev.watched, undo: true }, get().threads[id]);
            },
          });
        },
        setAgentMailboxes: (id, accountIds) => {
          const prev = get().agents.find((a) => a.id === id);
          if (!prev) return;
          set((s) => ({ agents: s.agents.map((a) => (a.id === id ? { ...a, accountIds } : a)) }));
          if (LIVE)
            api.patch(`/api/agents/${id}`, { accountIds }).catch((err: ApiError) => {
              set((s) => ({ agents: s.agents.map((a) => (a.id === id ? prev : a)) }));
              toast({ message: err.message });
            });
        },
        bundles: false,
        setBundles: (bundles) => {
          set({ bundles, openBundles: [] });
          if (LIVE) api.patch("/api/settings", { bundles }).catch(() => set({ bundles: !bundles }));
        },
        openBundles: [],
        toggleBundle: (key) => {
          const open = get().openBundles.includes(key);
          if (!open) track("bundle");
          set((s) => ({ openBundles: open ? s.openBundles.filter((k) => k !== key) : [...s.openBundles, key] }));
        },
        pinnedOpen: false,
        togglePinnedOpen: () => set((s) => ({ pinnedOpen: !s.pinnedOpen })),
        rules: LIVE ? null : [],
        loadRules: async () => {
          if (!LIVE) return;
          const rules = await api.get<MailRule[]>("/api/rules").catch(() => null);
          if (rules) set({ rules });
        },
        saveRule: async (input, opts) => {
          if (!opts?.id) track("rule");
          if (!LIVE) {
            const rule: MailRule = { id: opts?.id ?? uid("rul"), ...input, from: normalizeFrom(input.from) ?? input.from, applied: 0, lastAppliedAt: null };
            set((s) => ({ rules: [...(s.rules ?? []).filter((r) => r.id !== rule.id), rule] }));
            return null;
          }
          try {
            if (opts?.id) {
              const rule = await api.put<MailRule>(`/api/rules/${opts.id}`, input);
              set((s) => ({ rules: (s.rules ?? []).map((r) => (r.id === rule.id ? rule : r)) }));
              return null;
            }
            const { rule, applied } = await api.post<{ rule: MailRule; applied: number }>("/api/rules", { ...input, applyNow: !!opts?.applyNow });
            set((s) => ({ rules: [...(s.rules ?? []), rule] }));
            if (applied) {
              toast({ message: tn(applied, "The rule took care of {n} conversation in Inbox", "The rule took care of {n} conversations in Inbox"), sig: "folder" });
              void get().refresh();
            }
            return null;
          } catch (err) {
            return (err as Error).message;
          }
        },
        deleteRule: (id) => {
          const prev = get().rules;
          set((s) => ({ rules: (s.rules ?? []).filter((r) => r.id !== id) }));
          if (LIVE)
            api.del(`/api/rules/${id}`).catch((err: ApiError) => {
              set({ rules: prev });
              toast({ message: err.message });
            });
        },
        offerRule: (suggestion) => {
          const folder = get().folders.find((f) => f.id === suggestion.folderId);
          if (!folder) return;
          toast({
            message: t("Always move mail from {sender} to {folder}?", { sender: suggestion.name, folder: folder.name }),
            icon: "rule",
            duration: 12_000,
            action: {
              label: t("Always"),
              run: async () => {
                const error = await get().saveRule(
                  { accountId: null, from: suggestion.sender, subject: "", action: "folder", folderId: suggestion.folderId, markRead: false },
                  { applyNow: true },
                );
                toast({
                  message: error ?? t("Done. New mail from {sender} goes to {folder}. Rules are in Settings → Mail.", { sender: suggestion.name, folder: folder.name }),
                  sig: error ? undefined : "folder",
                });
              },
            },
          });
        },
        awayReplies: [],
        saveAway: async (reply) => {
          const prev = get().awayReplies;
          const was = prev.find((r) => r.id === reply.id);
          if (reply.on && !was?.on) track("away");
          const { replies, moved } = placeAway(prev, reply);
          set({ awayReplies: replies });
          // Mailboxes that left another reply for this one: say so, it isn't visible where the user is looking.
          for (const r of moved) {
            const names = get()
              .accounts.filter((a) => reply.accountIds.includes(a.id) && r.accountIds.includes(a.id))
              .map((a) => a.name)
              .join(", ");
            toast({ message: t("{mailboxes} now answers with “{reply}” instead of “{other}”", { mailboxes: names, reply: awayName(reply), other: awayName(r) }), icon: "palmtree" });
          }
          if (!LIVE) return null;
          try {
            await api.patch("/api/settings", { awayReplies: replies });
            return null;
          } catch (err) {
            set({ awayReplies: prev });
            return (err as Error).message;
          }
        },
        deleteAway: (id) => {
          const prev = get().awayReplies;
          const gone = prev.find((r) => r.id === id);
          if (!gone) return;
          const replies = prev.filter((r) => r.id !== id);
          set({ awayReplies: replies });
          if (LIVE) api.patch("/api/settings", { awayReplies: replies }).catch(() => set({ awayReplies: prev }));
          toast({
            message: t("“{reply}” deleted", { reply: awayName(gone) }),
            action: {
              label: t("Undo"),
              run: () => {
                const back = [...get().awayReplies];
                back.splice(Math.min(prev.indexOf(gone), back.length), 0, { ...gone, on: false });
                set({ awayReplies: back });
                if (LIVE) api.patch("/api/settings", { awayReplies: back }).catch(() => {});
              },
            },
          });
        },
        stopAway: () => {
          const prev = get().awayReplies;
          const replies = prev.map((r) => (r.on ? { ...r, on: false } : r));
          set({ awayReplies: replies });
          if (LIVE) api.patch("/api/settings", { awayReplies: replies }).catch(() => set({ awayReplies: prev }));
        },
        offline: LIVE && typeof window !== "undefined" ? readQueue() : [],
        flushOffline: async () => {
          if (!LIVE || flushing || isOffline() || !get().offline.length) return;
          flushing = true;
          try {
            // One at a time, oldest first: each goes through the normal send (Undo included).
            for (const item of [...get().offline].sort((a, b) => a.queuedAt - b.queuedAt)) {
              if (isOffline()) break;
              const rest = get().offline.filter((q) => q.draft.id !== item.draft.id);
              set({ offline: rest });
              writeQueue(rest);
              // A scheduled time that passed while waiting: it simply goes now.
              const opts = item.opts.scheduleAt && item.opts.scheduleAt < Date.now() + 60_000 ? { ...item.opts, scheduleAt: undefined } : item.opts;
              liveSend(item.draft, opts, "queue");
              await new Promise((r) => setTimeout(r, 400));
            }
          } finally {
            flushing = false;
          }
        },
        unqueueOffline: (draftId) => {
          const item = get().offline.find((q) => q.draft.id === draftId);
          if (!item) return;
          const offline = get().offline.filter((q) => q.draft.id !== draftId);
          set((s) => ({ offline, drafts: { ...s.drafts, [draftId]: item.draft } }));
          writeQueue(offline);
          if (item.draft.threadId) get().openThread(item.draft.threadId);
          else get().openDraft(draftId);
        },
        pushToast: toast,
        dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
      };
    },
    {
      // Live mode keeps only UI preferences locally; the mailbox itself comes from the server (and IndexedDB).
      name: LIVE ? "kolbaba-ui" : "kolbaba-prototype",
      version: 1,
      partialize: (s) =>
        LIVE
          ? { density: s.density, accent: s.accent, theme: s.theme, language: s.language, swipeLeft: s.swipeLeft, swipeRight: s.swipeRight, sidebar: s.sidebar, openMailbox: s.openMailbox }
          : {
              accounts: s.accounts,
              snippets: s.snippets,
              openMailbox: s.openMailbox,
              density: s.density,
              accent: s.accent,
              theme: s.theme,
              undoSendSeconds: s.undoSendSeconds,
              language: s.language,
              trackByDefault: s.trackByDefault,
              swipeLeft: s.swipeLeft,
              swipeRight: s.swipeRight,
              sidebar: s.sidebar,
            },
      // Known here, before the first paint: the cached mail shows in the right mailbox at once.
      merge: (persisted, current) => {
        const saved = persisted as Partial<MailState> | undefined;
        return { ...current, ...saved, scope: saved?.openMailbox ?? current.scope };
      },
    },
  ),
);

export const useAccount = (id: string | undefined) =>
  useMail((s) => s.accounts.find((a) => a.id === id));

export const isFolderId = (value: string): value is FolderId => Object.hasOwn(FOLDER_LABELS, value) || /^folder:[\w-]{1,64}$/.test(value);

const FOLDER_LABELS: Record<FolderId, string> = {
  inbox: tk("Inbox"),
  unanswered: tk("No reply yet"),
  pinned: tk("Pinned"),
  snoozed: tk("Snoozed"),
  scheduled: tk("Scheduled"),
  drafts: tk("Drafts"),
  sent: tk("Sent@@folder"),
  archive: tk("Archive@@folder"),
  trash: tk("Trash"),
  spam: tk("Spam@@folder"),
  orders: tk("Orders"),
  travel: tk("Travel"),
  invoices: tk("Invoices"),
  subscriptions: tk("Subscriptions"),
  security: tk("Security@@category"),
  replies: tk("Awaiting reply"),
  screener: tk("New senders"),
  files: tk("Files"),
  contacts: tk("Contacts"),
  lists: tk("Newsletters@@view"),
};

/** A folder's name in the app's language. */
export const folderLabel = (folder: FolderId) => {
  const own = ownFolderId(folder);
  if (own) return useMail.getState().folders.find((f) => f.id === own)?.name ?? t("Folder");
  return t(FOLDER_LABELS[folder as keyof typeof FOLDER_LABELS] ?? folder);
};

export const MAILBOX_HUES = [12, 28, 48, 88, 152, 178, 200, 228, 262, 282, 312, 340];

export function randomHue(taken: number[]) {
  const free = MAILBOX_HUES.filter((h) => !taken.some((t) => Math.abs(t - h) < 18));
  const pool = free.length ? free : MAILBOX_HUES;
  return pool[Math.floor(Math.random() * pool.length)];
}
