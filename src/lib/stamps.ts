import { tk } from "./i18n";
import { dayKey, isPadla } from "./postcard";

/**
 * Kolbaba's stamp album: small milestones collected as postage stamps, instead of badges. They reward
 * good habits and funny moments, never volume or being always online. A few are surprises. Art is in
 * src/components/stamp-art.tsx, the album and the "new stamp" card in src/components/stamps.tsx.
 */

export type StampId =
  | "first-letter"
  | "clean-desk"
  | "padla"
  | "snip"
  | "bouncer"
  | "filing-clerk"
  | "pen-pal"
  | "boomerang"
  | "robot"
  | "spy-catcher"
  | "clean-week"
  | "early-bird"
  | "archaeologist"
  | "no-address"
  | "year-and-a-day"
  | "christmas";

/** Things counted towards a stamp (kept in the user's settings). */
export type StampCounter = "unsubscribed" | "screenedOut" | "filed";

export interface StampDef {
  id: StampId;
  /** Catalogue number, printed on the stamp. */
  no: number;
  /** English; show with t(). */
  name: string;
  /** How it's earned. English; show with t(). */
  how: string;
  /** The ink of the stamp. */
  colour: string;
  /** A surprise: a question mark until it's earned. */
  hidden?: boolean;
  /** Counted ones: how many it takes, of what. */
  goal?: number;
  counter?: StampCounter;
}

export const STAMPS: StampDef[] = [
  { id: "first-letter", no: 1, name: tk("First Letter"), how: tk("Send your first email from Kolbaba."), colour: "#b8432f" },
  { id: "clean-desk", no: 2, name: tk("Clean Desk"), how: tk("Empty your Inbox for the first time."), colour: "#2f6f8f" },
  { id: "padla", no: 3, name: tk("Padla!"), how: tk("Empty your Inbox on a workday afternoon."), colour: "#7a5a3a" },
  { id: "snip", no: 4, name: tk("Snip Snip"), how: tk("Unsubscribe from 10 newsletters."), colour: "#3f7a50", goal: 10, counter: "unsubscribed" },
  { id: "bouncer", no: 5, name: tk("Bouncer"), how: tk("Say no to 10 new senders in the screener."), colour: "#4a4e8c", goal: 10, counter: "screenedOut" },
  { id: "filing-clerk", no: 6, name: tk("Filing Clerk"), how: tk("File 25 conversations into your own folders."), colour: "#8a6d2f", goal: 25, counter: "filed" },
  { id: "pen-pal", no: 7, name: tk("Pen Pal"), how: tk("Reply in a conversation of ten or more emails."), colour: "#a8506f" },
  { id: "boomerang", no: 8, name: tk("Boomerang"), how: tk("Deal with an email that came back from snooze."), colour: "#c0742a" },
  { id: "robot", no: 9, name: tk("Robot"), how: tk("Let an AI agent do something with your mail. (Čapek gave us the word.)"), colour: "#55606e" },
  { id: "spy-catcher", no: 10, name: tk("Spy Catcher"), how: tk("Keep 100 emails from seeing when you open them."), colour: "#2d5b4f", goal: 100 },
  { id: "clean-week", no: 11, name: tk("Clean Week"), how: tk("Empty your Inbox on five days of one week."), colour: "#3b6ea8" },
  { id: "early-bird", no: 12, name: tk("Early Bird"), how: tk("Empty your Inbox before eight in the morning."), colour: "#c9802a", hidden: true },
  { id: "archaeologist", no: 13, name: tk("Archaeologist"), how: tk("Reply to an email more than a year old."), colour: "#8b5e3c", hidden: true },
  { id: "no-address", no: 14, name: tk("Letter Without an Address"), how: tk("Try to send a letter to nobody."), colour: "#6b4a7a", hidden: true },
  { id: "year-and-a-day", no: 15, name: tk("A Year and a Day"), how: tk("Use Kolbaba for a year and a day."), colour: "#9c3b3b" },
  { id: "christmas", no: 16, name: tk("Christmas Post"), how: tk("Send an email between 20 and 26 December."), colour: "#a3312b" },
];

export const stampDef = (id: StampId) => STAMPS.find((s) => s.id === id)!;

const DAY = 24 * 3600_000;

/** An empty Inbox, now: what it earns, and the days kept for Clean Week (the last seven). */
export function inboxZeroStamps(now: Date, zeroDays: string[]): { earn: StampId[]; zeroDays: string[] } {
  const today = dayKey(now);
  const week = new Set(Array.from({ length: 7 }, (_, i) => dayKey(new Date(now.getTime() - i * DAY))));
  const days = [...new Set([today, ...zeroDays])].filter((d) => week.has(d)).sort();
  const earn: StampId[] = ["clean-desk"];
  if (isPadla(now)) earn.push("padla");
  if (now.getHours() >= 4 && now.getHours() < 8) earn.push("early-bird");
  if (days.length >= 5) earn.push("clean-week");
  return { earn, zeroDays: days };
}

/** Sending: what it earns. `thread` is the conversation it replies to, if any. */
export function sendStamps(now: Date, thread?: { messages: number; lastFromOthers?: number }): StampId[] {
  const earn: StampId[] = ["first-letter"];
  if (now.getMonth() === 11 && now.getDate() >= 20 && now.getDate() <= 26) earn.push("christmas");
  if (thread && thread.messages >= 10) earn.push("pen-pal");
  if (thread?.lastFromOthers && now.getTime() - thread.lastFromOthers > 365 * DAY) earn.push("archaeologist");
  return earn;
}

/** A year and a day since the account was made. */
export const yearAndADay = (since: number, now = Date.now()) => now - since >= 366 * DAY;
