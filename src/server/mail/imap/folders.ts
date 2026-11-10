import type { FolderRole } from "../../db/schema";

/**
 * Special-use folder detection for generic IMAP servers.
 *
 * Servers that advertise SPECIAL-USE (RFC 6154) or the older XLIST tag their folders; everything else
 * (many Czech hosters, older Courier/cPanel setups) only has names, often localized. We trust flags
 * first, then match known names, then fall back to imapflow's own localized-name guess.
 */

/** The subset of imapflow's ListResponse we rely on (keeps the function testable with plain fixtures). */
export interface ListedFolder {
  path: string;
  name: string;
  delimiter: string;
  flags: Set<string>;
  specialUse?: string;
  specialUseSource?: "user" | "extension" | "name";
}

/** SPECIAL-USE flags plus XLIST variants (Gmail's XLIST said \Spam, \AllMail, \Inbox). */
const FLAG_ROLES: Record<string, FolderRole> = {
  "\\inbox": "inbox",
  "\\sent": "sent",
  "\\archive": "archive",
  "\\drafts": "drafts",
  "\\trash": "trash",
  "\\junk": "spam",
  "\\spam": "spam",
};

/** \All (Gmail "All Mail") is only an archive when nothing is tagged \Archive. */
const ARCHIVE_FALLBACK_FLAGS = ["\\all", "\\allmail"];

/** Folder names per role, in order of preference, compared lowercased and without diacritics. */
const NAMES: Record<Exclude<FolderRole, "inbox">, string[]> = {
  sent: ["sent", "sent items", "sent messages", "sent mail", "odeslane", "odeslana posta", "odeslane zpravy", "odoslane"],
  // "Archivovat" is Outlook's Archive in Czech.
  archive: ["archive", "archiv", "archives", "archivovane", "archivovat"],
  drafts: ["drafts", "draft", "koncepty", "rozepsane", "rozpracovane"],
  trash: ["trash", "deleted items", "deleted messages", "deleted", "kos", "bin", "odstranena posta", "odstranene polozky"],
  spam: ["spam", "junk", "junk e-mail", "junk email", "junk mail", "bulk mail", "bulk", "nevyzadana posta", "nevyzadane"],
};

const ROLES: FolderRole[] = ["inbox", "sent", "archive", "drafts", "trash", "spam"];

export function normalizeFolderName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** The path as the user sees it, without the "INBOX." prefix some servers put on everything. */
function pathParts(folder: ListedFolder): string[] {
  const parts = folder.delimiter ? folder.path.split(folder.delimiter) : [folder.path];
  if (parts.length > 1 && parts[0].toUpperCase() === "INBOX") parts.shift();
  return parts;
}

/** 0 = top level or directly under INBOX (the usual places), higher = nested user folders. */
function depth(folder: ListedFolder): number {
  return pathParts(folder).length - 1;
}

function selectable(folder: ListedFolder): boolean {
  for (const flag of folder.flags) {
    const f = flag.toLowerCase();
    if (f === "\\noselect" || f === "\\nonexistent") return false;
  }
  return true;
}

export function detectFolders(list: ListedFolder[]): Partial<Record<FolderRole, string>> {
  const folders = list.filter(selectable);
  const result: Partial<Record<FolderRole, string>> = {};
  const taken = new Set<string>();
  const assign = (role: FolderRole, path: string | undefined) => {
    if (!path || result[role] || taken.has(path)) return;
    result[role] = path;
    taken.add(path);
  };

  assign("inbox", folders.find((f) => f.path.toUpperCase() === "INBOX")?.path);

  // 1. Server-provided flags.
  for (const folder of folders) {
    for (const flag of folder.flags) {
      const role = FLAG_ROLES[flag.toLowerCase()];
      if (role) assign(role, folder.path);
    }
  }
  if (!result.archive) {
    assign("archive", folders.find((f) => [...f.flags].some((fl) => ARCHIVE_FALLBACK_FLAGS.includes(fl.toLowerCase())))?.path);
  }

  // 2. Known names, preferring shallow folders and the earlier name in the list.
  for (const role of ROLES) {
    if (role === "inbox" || result[role]) continue;
    const names = NAMES[role];
    const best = folders
      .map((f) => ({ f, rank: names.indexOf(normalizeFolderName(f.name)) }))
      .filter((c) => c.rank >= 0 && !taken.has(c.f.path))
      .sort((a, b) => depth(a.f) - depth(b.f) || a.rank - b.rank)[0];
    assign(role, best?.f.path);
  }

  // 3. imapflow's multilingual name table (covers languages we don't list).
  for (const folder of folders) {
    if (folder.specialUseSource !== "name" || !folder.specialUse) continue;
    const role = FLAG_ROLES[folder.specialUse.toLowerCase()];
    if (role && depth(folder) === 0) assign(role, folder.path);
  }

  return result;
}

/** Own folders we mirror per mailbox; past that it's an archive scheme rather than folders to pick from. */
export const MAX_OWN_FOLDERS = 30;

/** Flags of folders that are the server's, not the user's. */
const SYSTEM_FLAGS = new Set(["\\all", "\\allmail", "\\archive", "\\drafts", "\\flagged", "\\important", "\\inbox", "\\junk", "\\sent", "\\spam", "\\trash"]);

/** Folders some servers keep for themselves without flagging them. */
const SYSTEM_NAMES = new Set(["outbox", "templates", "sablony", "notes", "poznamky", "conversation history", "rss feeds", "sync issues", "calendar", "contacts", "tasks"]);

/**
 * Exchange and Outlook list their calendars, contacts, tasks and the like over IMAP too, named in the
 * mailbox's language. In Czech these are ordinary folder names elsewhere, so they only count as the
 * server's when several sit together at the top, the way Exchange lays them out.
 */
const EXCHANGE_NAMES = new Set([
  ...["calendar", "contacts", "tasks", "journal", "notes", "outbox", "conversation history", "rss feeds", "sync issues"],
  ...["kalendar", "kontakty", "ulohy", "ukoly", "denik", "poznamky", "odchozi posta", "posta k odeslani", "historie konverzaci"],
  ...["kanaly rss", "informacni kanaly rss", "problemy se synchronizaci"],
]);

/**
 * The user's own folders: everything selectable that isn't Inbox, a special folder or the server's,
 * shallow ones first, named as the user sees them ("Clients / Acme", without the "INBOX." prefix).
 * Folders inside a bin are deleted ones, and folders inside the server's own (Calendar / Birthdays) aren't mail.
 */
export function ownFolders(list: ListedFolder[], special: Partial<Record<FolderRole, string>>): { ref: string; name: string }[] {
  const taken = new Set(Object.values(special).filter(Boolean));
  const bins = [special.trash, special.spam].filter((path): path is string => !!path);
  const exchange = new Set(list.filter((f) => depth(f) === 0).map((f) => normalizeFolderName(f.name)).filter((name) => EXCHANGE_NAMES.has(name)));
  const serversOwn = (f: ListedFolder) => {
    const top = normalizeFolderName(pathParts(f)[0]);
    return SYSTEM_NAMES.has(normalizeFolderName(f.name)) || (exchange.size >= 3 && exchange.has(top));
  };
  return list
    .filter(selectable)
    .filter((f) => f.path.toUpperCase() !== "INBOX" && !taken.has(f.path))
    .filter((f) => ![...f.flags].some((flag) => SYSTEM_FLAGS.has(flag.toLowerCase())) && !(f.specialUse && f.specialUseSource !== "name"))
    .filter((f) => !serversOwn(f))
    .filter((f) => !bins.some((bin) => !!f.delimiter && f.path.startsWith(bin + f.delimiter)))
    .sort((a, b) => depth(a) - depth(b) || a.path.localeCompare(b.path))
    .slice(0, MAX_OWN_FOLDERS)
    .map((f) => ({ ref: f.path, name: pathParts(f).join(" / ") }));
}
