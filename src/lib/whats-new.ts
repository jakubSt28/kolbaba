import { tk } from "./i18n";

/**
 * What's new (newest first) and tips for what someone hasn't tried yet. Texts are English keys with
 * Czech in src/lib/i18n/cs/news.ts. A new release note goes on top with a new id: everyone who saw
 * an older one gets a small card once (src/components/news.tsx).
 */

export interface ReleaseNote {
  id: string;
  /** ISO date. */
  date: string;
  title: string;
  body: string;
  /** What "Try it" does (see `ACTIONS` in src/components/news.tsx). */
  action?: NewsAction;
  /** Its picture in the window (see `ICONS` in src/components/news.tsx). */
  icon: NewsIcon;
}

/** Pictures for notes and tips: a few drawn ones (postmark, postcard, stamps), the rest icons in a colour. */
export type NewsIcon =
  | "postmark"
  | "postcard"
  | "stamps"
  | "contacts"
  | "drafts"
  | "settings"
  | "folders"
  | "sidebar"
  | "history"
  | "pins"
  | "agents"
  | "attachments"
  | "palette"
  | "keyboard"
  | "swipe"
  | "snooze"
  | "template"
  | "schedule"
  | "summary"
  | "smart"
  | "screener"
  | "bell"
  | "newsletters"
  | "search"
  | "mailboxes"
  | "calendar";

export type NewsAction =
  | "folders"
  | "sidebar"
  | "history"
  | "agents"
  | "palette"
  | "mailbox-settings"
  | "mail-settings"
  | "smart-settings"
  | "notification-settings"
  | "contacts"
  | "files"
  | "lists"
  | "calendar";

export const RELEASE_NOTES: ReleaseNote[] = [
  {
    id: "2026-11-11-calendar",
    date: "2026-11-11",
    icon: "calendar",
    title: tk("Kolbaba has a calendar"),
    body: tk("Switch between mail and calendar next to Kolbaba's name. Add the calendars of your mailboxes (Google, Outlook, Seznam, iCloud), follow one by link or import an .ics file, and tick which ones you see. Events you make or change here are saved to the calendar they belong to, guests get an invitation, and a notification reminds you before an event starts. Drag an event to move it, and search to find one. An AI agent can read your calendar and add events once you let it."),
    action: "calendar",
  },
  {
    id: "2026-11-10-open-source",
    date: "2026-11-10",
    icon: "postmark",
    title: tk("Kolbaba is open source"),
    body: tk("All of Kolbaba's code is now public on GitHub under the AGPL-3.0 licence. You can read how your mail is handled, run Kolbaba on your own server for free, or help make it better. The link is at the foot of Settings → Account."),
  },
  {
    id: "2026-11-04-phone-keyboard",
    date: "2026-11-04",
    icon: "keyboard",
    title: tk("On your phone, the keyboard no longer covers the email"),
    body: tk("A new email shows the recipient, the subject and the text, and you start in To. Send sits right on top of the keyboard, in a reply too, and so does the search field."),
  },
  {
    id: "2026-11-02-invitations",
    date: "2026-11-02",
    icon: "calendar",
    title: tk("Invitations show when the meeting is, and Join opens the call"),
    body: tk("The date and time of a calendar invitation show right in the list, so you don't have to open the email. In the email, Join opens the Teams, Google Meet or Zoom call."),
  },
  {
    id: "2026-10-31-search",
    date: "2026-10-31",
    icon: "search",
    title: tk("Search finds more"),
    body: tk("Search finds a Czech word in its other forms (Praha finds v Praze), part of an address, and words typed without diacritics. From Inbox it now looks in every folder except Trash, Spam and the screener."),
  },
  {
    id: "2026-10-31-more-mailboxes",
    date: "2026-10-31",
    icon: "mailboxes",
    title: tk("Add Outlook, Hotmail and mailboxes on shared hosting"),
    body: tk("Sign in with Microsoft to add an Outlook.com or Hotmail mailbox. Kolbaba also finds the mail servers of more hosting companies on its own, such as Webglobe."),
    action: "mailbox-settings",
  },
  {
    id: "2026-10-31-open-mailbox",
    date: "2026-10-31",
    icon: "settings",
    title: tk("Choose which mailbox Kolbaba opens in"),
    body: tk("With more than one mailbox, pick the one you see first in Settings → Mailboxes. It applies on all your devices."),
    action: "mailbox-settings",
  },
  {
    id: "2026-10-31-pins",
    date: "2026-10-31",
    icon: "pins",
    title: tk("Many pinned conversations no longer hide new mail"),
    body: tk("With five or more pinned conversations, Inbox shows the three with the newest activity and one row for the rest. Tap the row to see them all."),
  },
  {
    id: "2026-10-31-agent-attachments",
    date: "2026-10-31",
    icon: "attachments",
    title: tk("Agents read PDFs and save attachments"),
    body: tk("Connected agents now read the text of a PDF attachment and get a link to save any attachment. The link works for 15 minutes and stops as soon as you turn the agent off or take that mailbox away from it."),
    action: "agents",
  },
  {
    id: "2026-10-19-notifications",
    date: "2026-10-19",
    icon: "bell",
    title: tk("Only what's worth a buzz"),
    body: tk("Choose for each mailbox what may notify you: everything, only people, only VIPs or nothing. Quiet hours keep your phone silent at night, VIPs always get through, and Notify me of replies in a conversation's … menu tells you the moment someone answers."),
    action: "notification-settings",
  },
  {
    id: "2026-10-19-newsletters",
    date: "2026-10-19",
    icon: "newsletters",
    title: tk("Newsletters: who sends what, and out in one go"),
    body: tk("Newsletters in the sidebar shows who sends what and how much of it you read: pick the ones you never open and leave them all at once. And if you like, newsletters and notifications from shops, banks and apps can wait in one row each in your Inbox (Settings → Mail)."),
    action: "lists",
  },
  {
    id: "2026-10-19-rules",
    date: "2026-10-19",
    icon: "folders",
    title: tk("Rules, and a reply while you're away"),
    body: tk("Move mail from the same sender into a folder for the third time and Kolbaba offers to always do it. Write and change rules in Settings → Mail, and keep replies for when you're away, ready to turn on in Gmail, Seznam or any other mailbox."),
    action: "mail-settings",
  },
  {
    id: "2026-10-19-sending",
    date: "2026-10-19",
    icon: "attachments",
    title: tk("Safer reading, calmer sending"),
    body: tk("A sender you've never written with shows their full address, and Kolbaba warns you when a name pretends to be someone else's address. A forgotten attachment gets asked about, @ adds a person to the email, and an email written without a signal goes out on its own once there is one."),
  },
  {
    id: "2026-10-19-agent-mailboxes",
    date: "2026-10-19",
    icon: "agents",
    title: tk("Each agent with its own mailboxes"),
    body: tk("Choose which mailboxes each connected agent may use: Claude your work mail, ChatGPT only your personal one. Recipes for what to ask them are on kolbaba.app/agents."),
    action: "agents",
  },
  {
    id: "2026-10-19-no-reply",
    date: "2026-10-19",
    icon: "snooze",
    title: tk("No reply yet: who still owes you an answer"),
    body: tk("Emails you sent with a question that nobody has answered for three working days now gather in No reply yet in the sidebar. Set a reminder in one click, or tell Kolbaba you're not waiting anymore."),
  },
  {
    id: "2026-10-19-quiet",
    date: "2026-10-19",
    icon: "screener",
    title: tk("Mute a conversation, block a sender"),
    body: tk("A reply-all storm? Mute it with M and new replies skip your Inbox. Someone you never want to hear from? Block sends what they, or their whole company, write straight to Trash. And unsubscribing now offers to clean up what's already here."),
    action: "mail-settings",
  },
  {
    id: "2026-10-19-basics",
    date: "2026-10-19",
    icon: "keyboard",
    title: tk("Notes, signatures, search and print"),
    body: tk("Keep a private note on any conversation (N). Write your signature in Settings or bring it over from Gmail. Search with from:, has:attachment or in:all, print with ⌘P, pick a light or dark look, take longer to undo a send, and press ? for every shortcut. Links lose their tracking codes, and each email says what was blocked."),
  },
  {
    id: "2026-10-19-agents",
    date: "2026-10-19",
    icon: "agents",
    title: tk("More your agents can do"),
    body: tk("Connected agents can now move mail to Trash, set reminders, write notes, answer the screener, open attachments and, with Full access, unsubscribe. Settings → Agents has a few prompts to try, and an agent can be removed for good."),
    action: "agents",
  },
  {
    id: "2026-10-13-collection",
    date: "2026-10-13",
    icon: "postcard",
    title: tk("Postcards to collect, gestures where you click"),
    body: tk("Every postcard Kolbaba brings goes into your Collection: sixteen villages, each once per season. An action now plays its gesture right where you clicked, the sidebar's icons come alive, and your folders open while you're in them."),
  },
  {
    id: "2026-10-13-stamps",
    icon: "stamps",
    date: "2026-10-13",
    title: tk("Kolbaba's stamp album"),
    body: tk("Small milestones are now collected as postage stamps, each drawn just for Kolbaba: your first letter, a clean desk, ten newsletters snipped, and a few surprises. They're in the Collection at the foot of the sidebar."),
  },
  {
    id: "2026-10-13-postcard",
    icon: "postcard",
    date: "2026-10-13",
    title: tk("A postcard for an empty Inbox"),
    body: tk("Clear your Inbox and Kolbaba tips his cap and leaves a postcard: a different landscape every day, with the sky of the hour and the season. Turn it over for his note and how many emails he didn't let see when you open them."),
  },
  {
    id: "2026-10-13-feel",
    icon: "postmark",
    date: "2026-10-13",
    title: tk("A postmark on everything you send"),
    body: tk("Every action has its own small gesture: a postmark when you send, scissors when you unsubscribe, a letter dropping into the archive. Buttons give under your finger, swipes click into place, and mail from people you write with carries a small heart."),
  },
  {
    id: "2026-10-12-contacts",
    icon: "contacts",
    date: "2026-10-12",
    title: tk("Contacts and Files"),
    body: tk("Everyone you write to is in Contacts, with what their signatures say and your conversations with them. Files has every attachment in one place, and newsletters now have Unsubscribe."),
    action: "contacts",
  },
  {
    id: "2026-10-12-drafts",
    icon: "drafts",
    date: "2026-10-12",
    title: tk("Drafts from your phone, folders you drag to"),
    body: tk("Drafts started in other mail apps show up here. Drag mail onto a folder in the sidebar, invitations go into your calendar with one tap, and Gmail shows what you snoozed."),
    action: "files",
  },
  {
    id: "2026-10-12-settings",
    icon: "settings",
    date: "2026-10-12",
    title: tk("Tidier settings"),
    body: tk("Smart categories, summaries and the screener have their own Smart features section, and on the phone each section of Settings opens on its own screen."),
    action: "smart-settings",
  },
  {
    id: "2026-10-12-folders",
    icon: "folders",
    date: "2026-10-12",
    title: tk("Your own folders"),
    body: tk("Make folders under My folders and move mail there from its menu. In Gmail they're labels, elsewhere real folders, and the ones you already have come along."),
    action: "folders",
  },
  {
    id: "2026-10-12-sidebar",
    icon: "sidebar",
    date: "2026-10-12",
    title: tk("A sidebar you arrange"),
    body: tk("Drag folders and whole sections into your order and put away what you rarely use. Empty Drafts, Snoozed and Scheduled step aside into More on their own."),
    action: "sidebar",
  },
  {
    id: "2026-10-12-history",
    icon: "history",
    date: "2026-10-12",
    title: tk("My history"),
    body: tk("Everything you archived, deleted, moved, snoozed or pinned in the last 30 days, with Undo, next to what AI agents did."),
    action: "history",
  },
  {
    id: "2026-10-12-pins",
    icon: "pins",
    date: "2026-10-12",
    title: tk("Pinned mail stands out"),
    body: tk("Pinned conversations sit on an amber card at the top of Inbox, and in All mailboxes each row shows its mailbox's own picture."),
  },
  {
    id: "2026-10-12-agents",
    icon: "agents",
    date: "2026-10-12",
    title: tk("Agents in Settings"),
    body: tk("The MCP address, connected agents and which mailboxes they see are now in Settings → Agents too."),
    action: "agents",
  },
  {
    id: "2026-10-11-batch",
    icon: "attachments",
    date: "2026-10-11",
    title: tk("Attachments, templates and invitations"),
    body: tk("Attach files by pasting or dropping them, insert templates with /, answer calendar invitations from the email, and summarize long threads with one tap."),
  },
];

export const LATEST_NOTE = RELEASE_NOTES[0].id;

/** The app's own state that tells which tips are done without anyone pressing anything. */
export interface TipContext {
  tried: string[];
  folders: number;
  snippets: number;
  agents: number;
  screener: boolean;
  smartCategories: boolean;
  summaries: boolean;
  sidebarArranged: boolean;
  mobile: boolean;
}

export interface Tip {
  id: string;
  title: string;
  body: string;
  icon: NewsIcon;
  action?: NewsAction;
  /** Only on the phone / only with a keyboard. */
  only?: "mobile" | "desktop";
  done: (c: TipContext) => boolean;
}

const tried = (id: string) => (c: TipContext) => c.tried.includes(id);

export const TIPS: Tip[] = [
  { id: "palette", icon: "palette", title: tk("Search and commands with ⌘K"), body: tk("Find any email, jump to a folder or run an action without the mouse."), action: "palette", only: "desktop", done: tried("palette") },
  { id: "shortcuts", icon: "keyboard", title: tk("Keyboard shortcuts"), body: tk("J and K move through the list, E archives, # deletes, R replies and H snoozes."), only: "desktop", done: tried("shortcuts") },
  { id: "swipe", icon: "swipe", title: tk("Swipe a row"), body: tk("Swipe left or right in the list. What each side does is up to you in Settings."), only: "mobile", done: tried("swipe") },
  { id: "snooze", icon: "snooze", title: tk("Snooze until later"), body: tk("An email you can't deal with now comes back at the time you pick, on top of Inbox."), done: tried("snooze") },
  { id: "folder", icon: "folders", title: tk("Your own folders"), body: tk("Make one with + under My folders, then move mail there from its menu."), action: "folders", done: (c) => c.folders > 0 },
  { id: "template", icon: "template", title: tk("Templates with /"), body: tk("Save text you write often as a template and insert it by typing / in an email."), action: "mail-settings", done: (c) => c.snippets > 0 },
  { id: "schedule", icon: "schedule", title: tk("Send later"), body: tk("The arrow next to Send schedules the email for a time that suits them."), done: tried("schedule") },
  { id: "summary", icon: "summary", title: tk("Summaries of long threads"), body: tk("In a conversation of three or more emails, Summarize gives you where it stands in a few lines."), done: (c) => !c.summaries || c.tried.includes("summary") },
  { id: "smart", icon: "smart", title: tk("Smart categories"), body: tk("Orders, trips, invoices and subscriptions sorted on their own, with what matters on a card."), action: "smart-settings", done: (c) => c.smartCategories },
  { id: "screener", icon: "screener", title: tk("Screener for new senders"), body: tk("The first email from someone new waits for your yes or no, without a notification."), action: "smart-settings", done: (c) => c.screener },
  { id: "sidebar", icon: "sidebar", title: tk("Arrange the sidebar"), body: tk("Drag folders into your order and put away what you don't use."), action: "sidebar", done: (c) => c.sidebarArranged || c.tried.includes("sidebar") },
  { id: "history", icon: "history", title: tk("Undo from My history"), body: tk("Archived something by mistake yesterday? My history keeps 30 days, with Undo."), action: "history", done: tried("history") },
  { id: "agents", icon: "agents", title: tk("Connect an AI agent"), body: tk("Let Claude, ChatGPT or Cursor read, sort and draft your mail, with the access you choose."), action: "agents", done: (c) => c.agents > 0 },
];

/** Tips that make sense on this device and aren't done yet, in order. */
export function openTips(c: TipContext): Tip[] {
  return TIPS.filter((tip) => (!tip.only || (tip.only === "mobile") === c.mobile) && !tip.done(c));
}

/** A tip card at most every few days, and not in someone's first days. */
export const TIP_EVERY_MS = 3 * 24 * 3600 * 1000;
