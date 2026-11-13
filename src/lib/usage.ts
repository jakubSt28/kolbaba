import { tk } from "./i18n";
import type { FolderId } from "./types";

/**
 * How much each part of the app gets used: the store counts a feature when someone opens or runs it,
 * and the counts go to the server in batches (per user and day, never what's in the mail). The admin
 * page shows them, so it's clear what people actually use. A closed list, so nothing else gets in.
 */
export const FEATURE_GROUPS = [
  {
    title: tk("Folders"),
    features: ["inbox", "unanswered", "pinned", "snoozed", "scheduled", "drafts", "sent", "archive", "trash", "spam", "folder", "lists"],
  },
  {
    title: tk("Smart categories"),
    features: ["orders", "travel", "invoices", "subscriptions", "security", "replies", "screener", "hideCard"],
  },
  {
    title: tk("Tools"),
    features: ["contacts", "files", "search", "palette", "history", "activity", "mailboxes", "settings", "news", "collection", "plusCheckout", "plusSubscribed", "quietHours", "notifyMode", "away"],
  },
  {
    title: tk("Actions"),
    features: ["compose", "reply", "replyAll", "forward", "snooze", "schedule", "move", "summary", "unsubscribe", "calendar", "joinMeeting", "snippet", "swipe", "shortcuts", "remind", "mute", "block", "note", "print", "vip", "watch", "bundle", "rule", "bulkUnsubscribe", "offlineSend", "mention", "attachmentReminder"],
  },
  {
    title: tk("Calendar"),
    features: ["calOpen", "calEventNew", "calEventEdit", "calEventDelete", "calRsvp", "calFilter", "calView", "calConnect", "calImport", "calFeed", "calJoin", "calMove", "calSearch", "calReminder"],
  },
  {
    title: tk("Tasks"),
    features: ["tasksOpen", "taskNew", "taskQuick", "taskDone", "taskDate", "taskPriority", "taskNotes", "taskDrag"],
  },
] as const;

export type Feature = (typeof FEATURE_GROUPS)[number]["features"][number];

export const FEATURES = FEATURE_GROUPS.flatMap((g) => g.features) as Feature[];

/** English; shown with translate(). */
export const FEATURE_LABELS: Record<Feature, string> = {
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
  folder: tk("Own folders"),
  orders: tk("Orders"),
  travel: tk("Travel"),
  invoices: tk("Invoices"),
  subscriptions: tk("Subscriptions"),
  security: tk("Security@@category"),
  replies: tk("Awaiting reply"),
  screener: tk("New senders"),
  hideCard: tk("Hide a card"),
  contacts: tk("Contacts"),
  files: tk("Files"),
  search: tk("Search@@feature"),
  palette: tk("Search and commands (⌘K)"),
  history: tk("My history"),
  activity: tk("AI activity"),
  mailboxes: tk("Switching mailboxes"),
  settings: tk("Settings"),
  news: tk("What's new and tips"),
  collection: tk("Collection"),
  plusCheckout: tk("Plus: to the payment page"),
  plusSubscribed: tk("Plus: subscribed"),
  compose: tk("New message"),
  reply: tk("Reply"),
  replyAll: tk("Reply all"),
  forward: tk("Forward"),
  snooze: tk("Snooze"),
  schedule: tk("Send later"),
  move: tk("Move to folder"),
  summary: tk("Summarize"),
  unsubscribe: tk("Unsubscribe"),
  calendar: tk("Add to calendar"),
  joinMeeting: tk("Join a meeting"),
  snippet: tk("Snippets"),
  swipe: tk("Swipe"),
  shortcuts: tk("Keyboard shortcuts"),
  remind: tk("Remind me if no reply"),
  mute: tk("Mute"),
  block: tk("Block"),
  note: tk("Note"),
  print: tk("Print"),
  lists: tk("Newsletters@@view"),
  quietHours: tk("Quiet hours"),
  notifyMode: tk("Notifications per mailbox"),
  away: tk("Out-of-office reply"),
  vip: tk("VIP"),
  watch: tk("Notify me of replies"),
  bundle: tk("Bundled newsletters"),
  rule: tk("Rules"),
  bulkUnsubscribe: tk("Unsubscribe from several"),
  offlineSend: tk("Sent without a signal"),
  mention: tk("@ mention"),
  attachmentReminder: tk("Forgotten attachment"),
  calOpen: tk("Opening the calendar"),
  calEventNew: tk("New event"),
  calEventEdit: tk("Changing an event"),
  calEventDelete: tk("Deleting an event"),
  calRsvp: tk("Answering an invitation"),
  calFilter: tk("Ticking calendars on and off"),
  calView: tk("Switching day, week and month"),
  calConnect: tk("Connecting a calendar account"),
  calImport: tk("Importing an .ics file"),
  calFeed: tk("Following a calendar by link"),
  calJoin: tk("Joining a call from the calendar"),
  calMove: tk("Moving an event by dragging"),
  calSearch: tk("Searching events"),
  calReminder: tk("Setting an event's own reminder"),
  tasksOpen: tk("Opening the tasks"),
  taskNew: tk("New task"),
  taskQuick: tk("A day or priority typed with the task"),
  taskDone: tk("Ticking a task off"),
  taskDate: tk("Giving a task a day"),
  taskPriority: tk("Giving a task a priority"),
  taskNotes: tk("Writing a task's description"),
  taskDrag: tk("Moving a task by dragging"),
};

/** Opening a folder or view counts as using it; the user's own folders count together. */
export const folderFeature = (folder: FolderId): Feature => (folder.startsWith("folder:") ? "folder" : (folder as Feature));

const LIVE = process.env.NEXT_PUBLIC_DATA_MODE === "live";
/** Sent at most this often while the app is open, and right away when it goes to the background. */
const FLUSH_MS = 60_000;

let pending: Partial<Record<Feature, number>> = {};
let timer: ReturnType<typeof setTimeout> | undefined;
let listening = false;

/** Counts one use of a feature. A no-op in the prototype and on the server. */
export function track(feature: Feature) {
  if (!LIVE || typeof window === "undefined") return;
  pending[feature] = (pending[feature] ?? 0) + 1;
  if (!listening) {
    listening = true;
    // keepalive lets the last batch out even while the page is being closed or frozen.
    document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && flush());
    window.addEventListener("pagehide", flush);
  }
  timer ??= setTimeout(flush, FLUSH_MS);
}

function flush() {
  clearTimeout(timer);
  timer = undefined;
  const counts = pending;
  if (!Object.keys(counts).length) return;
  pending = {};
  void fetch("/api/usage", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ counts }),
    credentials: "same-origin",
    keepalive: true,
  }).catch(() => {});
}
