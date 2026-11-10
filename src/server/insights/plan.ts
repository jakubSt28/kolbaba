import type { InsightCategory } from "@/lib/types";
import { SKIP_IF_NONE, type Triage } from "./jev";

/**
 * Which look an email gets, cheapest first (run.ts does the looking). Pure, so it's tested on its own.
 *
 * - Recent mail is worth a card with details: Jev sorts it and what it doesn't rule out goes to OpenAI.
 *   Without Jev the rules (prefilter.ts) decide, as before.
 * - Older mail never goes to OpenAI. What the rules flag, Jev sorts, and a confident order, trip,
 *   invoice or subscription becomes a card without details ("Order · Alza.cz"): the history is there
 *   to browse, but nobody needs the return date of a parcel from 2019.
 */

const DAY = 86_400_000;

/** How far back cards get details. */
export const RECENT_DAYS = 90;

export const isRecent = (date: Date, now = Date.now()) => date.getTime() >= now - RECENT_DAYS * DAY;

/** Older mail only gets cards that are history worth browsing; a security notice or a question from 2021 isn't. */
const SORTED_ONLY: InsightCategory[] = ["order", "travel", "invoice", "subscription"];

/** How sure Jev must be of the category to file older mail under it without anyone reading it. */
export const SORTED_MIN_CONFIDENCE = 0.6;

/** Older mail Jev thinks is this likely bulk mail gets no card. */
export const MAX_BULK = 0.5;

export type FirstLook = "nothing" | "sort" | "read" | "wait";

/**
 * Whether a service can be used now: "capped" when today's calls are used up, "down" when it's out
 * (an outage, or no credit until someone tops it up), "off" when it isn't set up or has been down for
 * so long that the rules decide instead (run.ts). Capped and down both mean the email waits.
 */
export type Availability = "yes" | "capped" | "down" | "off";

const waits = (a: Availability) => a === "capped" || a === "down";

/**
 * Before any AI. `rule`: the prefilter thinks it could be one. `jev`: sorting; `read`: OpenAI.
 * "wait" leaves the email for tomorrow's calls instead of deciding without them.
 */
export function firstLook(m: { recent: boolean; rule: boolean; jev: Availability; read: Availability }): FirstLook {
  // Older mail the rules don't flag never becomes a card; it isn't worth even sorting.
  if (!m.recent && !m.rule) return "nothing";
  if (m.jev === "yes") return "sort";
  if (!m.recent) return waits(m.jev) ? "wait" : "nothing";
  // Recent mail without sorting: the rules decide what gets read.
  if (!m.rule) return waits(m.jev) ? "wait" : "nothing";
  if (m.read === "yes") return "read";
  return waits(m.read) ? "wait" : "nothing";
}

export type AfterSorting = { kind: "nothing" } | { kind: "read" } | { kind: "sorted"; category: InsightCategory };

/** After Jev: recent mail goes on to OpenAI unless it's surely nothing; older mail gets a card without details or none. */
export function afterSorting(t: Pick<Triage, "category" | "pNone" | "confidence" | "bulk">, m: { recent: boolean; replies: boolean }): AfterSorting {
  if (t.pNone >= SKIP_IF_NONE) return { kind: "nothing" };
  if (t.category === "reply" && !m.replies) return { kind: "nothing" };
  if (m.recent) return { kind: "read" };
  // Offers and deals ("Prague → Naples from 990 Kč") look like trips and orders but are bulk mail.
  // Measured: without this a fifth of the cards for older mail were made up, with it one in twenty.
  if (t.bulk >= MAX_BULK) return { kind: "nothing" };
  if (t.category !== "none" && SORTED_ONLY.includes(t.category) && t.confidence >= SORTED_MIN_CONFIDENCE) return { kind: "sorted", category: t.category };
  return { kind: "nothing" };
}

/** The shop or service as people know it, from the sender: "Alza.cz", or the domain when there's no name. */
export function senderLabel(from: { name: string; email: string }) {
  const name = from.name.replace(/["']/g, "").trim();
  if (name && !name.includes("@")) return name;
  return from.email.split("@")[1]?.toLowerCase() ?? from.email;
}
