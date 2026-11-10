/**
 * Search with a few operators, like Gmail (and their Czech twins): `from:petr`, `to:jana`,
 * `subject:faktura`, `has:attachment`, `is:unread`, `is:pinned`, `before:2026-09-01`,
 * `after:2026-09-01`, `in:all`. The rest is full-text words. Shared by the server (SQL) and the client
 * (the chips, and the prototype's local search).
 */

export interface ParsedSearch {
  /** Words for the full-text search. */
  text: string;
  from: string[];
  to: string[];
  subject: string[];
  hasAttachment: boolean;
  unread: boolean;
  pinned: boolean;
  /** Last message before / on or after this day (local midnight). */
  before: Date | null;
  after: Date | null;
  /** Every folder (Inbox, Archive, Sent, own folders), not just the open one. */
  everywhere: boolean;
}

const KEYS: Record<string, keyof ParsedSearch | "has" | "is" | "in"> = {
  from: "from",
  od: "from",
  to: "to",
  komu: "to",
  subject: "subject",
  predmet: "subject",
  "předmět": "subject",
  has: "has",
  ma: "has",
  "má": "has",
  is: "is",
  je: "is",
  before: "before",
  pred: "before",
  "před": "before",
  after: "after",
  po: "after",
  in: "in",
  v: "in",
};

const ATTACHMENT = new Set(["attachment", "attachments", "file", "priloha", "příloha", "prilohu", "přílohu"]);
const UNREAD = new Set(["unread", "neprectene", "nepřečtené", "neprecteny", "nepřečtený"]);
const READ = new Set(["read", "prectene", "přečtené"]);
const PINNED = new Set(["pinned", "starred", "pripnute", "připnuté"]);
const EVERYWHERE = new Set(["all", "anywhere", "everywhere", "vse", "vše", "vsude", "všude"]);

/** "2026-09-01", "1.9.2026", "1. 9. 2026" → local midnight of that day. */
export function parseDay(value: string): Date | null {
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(value);
  if (m) return day(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})$/.exec(value);
  if (m) return day(+m[3], +m[2], +m[1]);
  return null;
}

function day(y: number, mo: number, d: number) {
  const date = new Date(y, mo - 1, d);
  return date.getFullYear() === y && date.getMonth() === mo - 1 && date.getDate() === d ? date : null;
}

/** Words and `key:value` pairs; quotes keep spaces together (`from:"Petr Novák"`). */
function tokens(query: string) {
  return [...query.matchAll(/(\S+?:)?"([^"]*)"|\S+/g)].map((m) => (m[2] !== undefined ? `${m[1] ?? ""}${m[2]}` : m[0]));
}

export function parseSearch(query: string): ParsedSearch {
  const out: ParsedSearch = { text: "", from: [], to: [], subject: [], hasAttachment: false, unread: false, pinned: false, before: null, after: null, everywhere: false };
  const words: string[] = [];
  for (const token of tokens(query)) {
    const at = token.indexOf(":");
    const key = at > 0 ? KEYS[token.slice(0, at).toLowerCase()] : undefined;
    const value = at > 0 ? token.slice(at + 1).trim() : "";
    if (!key || !value) {
      words.push(token);
      continue;
    }
    const v = value.toLowerCase();
    switch (key) {
      case "from":
      case "to":
      case "subject":
        out[key].push(v);
        break;
      case "has":
        if (ATTACHMENT.has(v)) out.hasAttachment = true;
        else words.push(token);
        break;
      case "is":
        if (UNREAD.has(v)) out.unread = true;
        else if (PINNED.has(v)) out.pinned = true;
        else if (!READ.has(v)) words.push(token);
        break;
      case "before":
      case "after": {
        const d = parseDay(value);
        if (d) out[key] = d;
        else words.push(token);
        break;
      }
      case "in":
        if (EVERYWHERE.has(v)) out.everywhere = true;
        else words.push(token);
        break;
    }
  }
  out.text = words.join(" ").trim();
  return out;
}

/** The query with one operator added or taken out (the chips under the search box). */
export function toggleOperator(query: string, operator: string): string {
  const present = tokens(query).some((t) => t.toLowerCase() === operator);
  if (present) return tokens(query).filter((t) => t.toLowerCase() !== operator).join(" ");
  return `${query.trim()} ${operator}`.trim();
}

export const hasOperator = (query: string, operator: string) => tokens(query).some((t) => t.toLowerCase() === operator);

/**
 * What the app searches for, from this folder: from Inbox every folder, as in Gmail, since mail that's
 * been dealt with lives in Archive. Elsewhere that folder, unless the query says `in:all`.
 */
export const searchFrom = (query: string, folder: string) => (folder === "inbox" && !parseSearch(query).everywhere ? `${query.trim()} in:all` : query);

/** Anything for the server to search on (words or filters). */
export const isEmptySearch = (p: ParsedSearch) =>
  !p.text && !p.from.length && !p.to.length && !p.subject.length && !p.hasAttachment && !p.unread && !p.pinned && !p.before && !p.after;
