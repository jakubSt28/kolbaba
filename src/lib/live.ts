"use client";

import type { LanguageSetting, Locale } from "./i18n";
import type { PlusState } from "./plus";
import type { SidebarLayout } from "./sidebar-layout";
import { openDB, type IDBPDatabase } from "idb";
import type { Account, AwayReply, BadgeMode, Draft, FolderId, LegacyAwayReply, MailboxScope, MailFolder, QuietHours, RuleSuggestion, Snippet, SwipeAction, Theme, Thread } from "./types";
import { writeQueue } from "./offline-outbox";

/**
 * Live mode: the store talks to the backend instead of mock data. Kept out of store.ts so the
 * prototype stays readable; the store calls into this module and stays the single source for the UI.
 *
 * Every mutation is optimistic: the store updates first, then calls the API, and reverts with a
 * toast if the server says no.
 */

export const LIVE = process.env.NEXT_PUBLIC_DATA_MODE === "live";

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
    /** The full error body, for endpoints that return more than a message (e.g. a help link). */
    public details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: body !== undefined ? { "content-type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: "same-origin",
    });
  } catch {
    throw new ApiError("You're offline. We'll try again when you're back.", 0, "offline");
  }
  if (res.status === 401 && typeof window !== "undefined") {
    // A full navigation on purpose: the session is gone, so drop every bit of in-memory state, and
    // the mail cached on this device goes first (the privacy policy promises it).
    const next = `/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
    void forgetCachedMail().finally(() => {
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.href = next;
    });
  }
  const data = res.headers.get("content-type")?.includes("json") ? await res.json() : null;
  if (!res.ok) throw new ApiError(data?.error ?? data?.message ?? "Something went wrong", res.status, data?.code ?? data?.reason, data ?? undefined);
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body ?? {}),
  patch: <T>(path: string, body: unknown) => request<T>("PATCH", path, body),
  put: <T>(path: string, body: unknown) => request<T>("PUT", path, body),
  del: <T>(path: string, body?: unknown) => request<T>("DELETE", path, body),
};

export interface Bootstrap {
  user: { id: string; email: string; name: string; avatarUrl: string | null; googleEmail?: string | null; admin?: boolean; since?: number; hasPasskey?: boolean };
  accounts: Account[];
  drafts: Draft[];
  snippets: Snippet[];
  folders?: MailFolder[];
  /** Time for the occasional "would you recommend Kolbaba" question. */
  askNps?: boolean;
  /** Kolbaba Plus (src/lib/plus.ts), and whether paying for it works yet. */
  plus?: PlusState;
  billing?: boolean;
  /** This copy runs on the person's own server, and whether it has an OpenAI key (Plus features need one). */
  selfHosted?: boolean;
  ai?: boolean;
  /** Addresses of VIPs in the address book (their mail notifies even in quiet hours). */
  vips?: string[];
  settings: {
    density?: "comfortable" | "compact";
    accent?: string;
    trackByDefault?: boolean;
    openMailbox?: string;
    loadRemoteImages?: boolean;
    imagesExplained?: boolean;
    undoSendSeconds?: number;
    theme?: Theme;
    swipeLeft?: SwipeAction;
    swipeRight?: SwipeAction;
    smartCategories?: boolean;
    replyReminders?: boolean;
    screener?: boolean;
    summaries?: boolean;
    /** The "sign in with a passkey next time?" offer was last shown (ms). */
    passkeyOfferedAt?: number;
    language?: LanguageSetting;
    locale?: Locale;
    sidebar?: SidebarLayout;
    newsSeen?: string;
    tried?: string[];
    tipShownAt?: number;
    stamps?: Record<string, number>;
    stampCounts?: Record<string, number>;
    zeroDays?: string[];
    postcards?: Record<string, string>;
    stampsOff?: boolean;
    stampsSeen?: number;
    stampShownAt?: number;
    quietHours?: QuietHours;
    badge?: BadgeMode;
    bundles?: boolean;
    codeInNotification?: boolean;
    awayReplies?: AwayReply[];
    away?: LegacyAwayReply;
  };
}

export const fetchBootstrap = () => api.get<Bootstrap>("/api/bootstrap");

export function fetchThreads(opts: { scope: MailboxScope; folder: FolderId; query?: string; cursor?: string }) {
  const p = new URLSearchParams({ scope: opts.scope, folder: opts.folder });
  if (opts.query) p.set("q", opts.query);
  if (opts.cursor) p.set("cursor", opts.cursor);
  return api.get<{ threads: Thread[]; nextCursor: string | null }>(`/api/threads?${p}`);
}

export const fetchThread = (id: string, images = false) =>
  api.get<Thread>(`/api/threads/${encodeURIComponent(id)}${images ? "?images=1" : ""}`);

export type ThreadPatch = {
  unread?: boolean;
  pinned?: boolean;
  folder?: "archive" | "inbox" | "trash" | "spam";
  /** Into one of the user's own folders. */
  folderId?: string;
  /** Undo of a change the app just made: the server marks that history line undone instead of adding one. */
  undo?: boolean;
  snoozedUntil?: number | null;
  followUpAt?: number | null;
  /** Mute: new replies skip Inbox and don't notify. */
  muted?: boolean;
  /** "Not waiting" in No reply yet. */
  noReplyDismissed?: boolean;
  /** "Notify me of replies". */
  watched?: boolean;
};

export const patchThread = (id: string, patch: ThreadPatch) => api.patch<{ ok: true }>(`/api/threads/${encodeURIComponent(id)}`, patch);
/** Multi-select: one request for the whole selection; `failed` are the conversations to revert. */
export const patchThreads = (ids: string[], patch: ThreadPatch) =>
  api.patch<{ ok: boolean; failed: string[]; suggestion?: RuleSuggestion }>("/api/threads", { ids, patch });

/* --------------------------------- Drafts --------------------------------- */

const draftTimers = new Map<string, ReturnType<typeof setTimeout>>();
const draftPending = new Map<string, () => Promise<unknown>>();

/** Autosave a draft ~0.6 s after the last keystroke. */
export function saveDraftSoon(draft: Draft) {
  const run = () => {
    draftTimers.delete(draft.id);
    draftPending.delete(draft.id);
    return api.post<Draft>("/api/drafts", {
      id: draft.id,
      accountId: draft.accountId,
      threadId: draft.threadId ?? null,
      to: draft.to,
      cc: draft.cc,
      subject: draft.subject,
      html: draft.html,
    });
  };
  clearTimeout(draftTimers.get(draft.id));
  draftPending.set(draft.id, run);
  draftTimers.set(
    draft.id,
    setTimeout(() => void run().catch(() => {}), 600),
  );
}

/** Save right away, waiting or not (an upload needs the draft to exist on the server). */
export async function saveDraftNow(draft: Draft) {
  clearTimeout(draftTimers.get(draft.id));
  draftTimers.delete(draft.id);
  draftPending.delete(draft.id);
  await api.post<Draft>("/api/drafts", {
    id: draft.id,
    accountId: draft.accountId,
    threadId: draft.threadId ?? null,
    to: draft.to,
    cc: draft.cc,
    subject: draft.subject,
    html: draft.html,
  });
}

/** Save now if an autosave is waiting (before sending, closing, or leaving the page). */
export async function flushDraft(id: string) {
  const run = draftPending.get(id);
  clearTimeout(draftTimers.get(id));
  if (run) await run();
}

/** Save every waiting autosave now (before the app loads a new version); rejects if one can't be saved. */
export async function flushDrafts() {
  await Promise.all([...draftPending.keys()].map(flushDraft));
}

export function cancelDraftSave(id: string) {
  clearTimeout(draftTimers.get(id));
  draftTimers.delete(id);
  draftPending.delete(id);
}

if (typeof window !== "undefined" && LIVE) {
  window.addEventListener("pagehide", () => {
    for (const run of draftPending.values()) void run().catch(() => {});
  });
}

/* ------------------------------ Offline cache ------------------------------ */

/**
 * IndexedDB keeps the last known mailbox so the app paints instantly on launch (and works on the
 * subway); the network then refreshes it. One record per signed-in user.
 */
interface Snapshot {
  userId: string;
  savedAt: number;
  accounts: Account[];
  threads: Thread[];
  drafts: Draft[];
}

let dbPromise: Promise<IDBPDatabase> | null = null;

function cacheDb() {
  dbPromise ??= openDB("kolbaba-cache", 1, {
    upgrade(db) {
      db.createObjectStore("snapshots", { keyPath: "userId" });
    },
  });
  return dbPromise;
}

const LAST_USER_KEY = "kolbaba:last-user";

export async function readSnapshot(): Promise<Snapshot | null> {
  try {
    const userId = localStorage.getItem(LAST_USER_KEY);
    if (!userId) return null;
    return ((await (await cacheDb()).get("snapshots", userId)) as Snapshot | undefined) ?? null;
  } catch {
    return null;
  }
}

let snapshotTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * Debounced write; keeps the newest threads only, bodies included, so recent mail opens offline.
 * Pinned ones stay however old, so the top of Inbox paints with them right away.
 */
export function writeSnapshotSoon(snapshot: Omit<Snapshot, "savedAt">) {
  clearTimeout(snapshotTimer);
  snapshotTimer = setTimeout(async () => {
    try {
      localStorage.setItem(LAST_USER_KEY, snapshot.userId);
      const threads = [...snapshot.threads]
        .sort((a, b) => Number(b.pinned) - Number(a.pinned) || (b.messages.at(-1)?.date ?? 0) - (a.messages.at(-1)?.date ?? 0))
        .slice(0, 400);
      await (await cacheDb()).put("snapshots", { ...snapshot, threads, savedAt: Date.now() });
    } catch {
      // Private mode / quota: the cache is a nicety, never a requirement.
    }
  }, 1500);
}

/**
 * Signed out some other way than the button (the session ran out, another device ended it): the mail
 * cached here goes. Emails waiting for a signal stay for the same person's next sign-in (claimDevice).
 */
export async function forgetCachedMail() {
  clearTimeout(snapshotTimer);
  try {
    await (await cacheDb()).clear("snapshots");
  } catch {}
}

/**
 * After sign-in: when another account used this device last, its unsent emails and cached mail go.
 * True when it cleared something, so the store drops what it already holds too.
 */
export async function claimDevice(userId: string): Promise<boolean> {
  try {
    const last = localStorage.getItem(LAST_USER_KEY);
    localStorage.setItem(LAST_USER_KEY, userId);
    if (!last || last === userId) return false;
    writeQueue([]);
    await (await cacheDb()).clear("snapshots");
    return true;
  } catch {
    return false;
  }
}

export async function clearSnapshots() {
  try {
    localStorage.removeItem(LAST_USER_KEY);
    // Emails waiting for a signal are someone's drafts too: they don't stay for whoever signs in next.
    writeQueue([]);
    await (await cacheDb()).clear("snapshots");
  } catch {}
}

/**
 * Merge a fresh server thread into what we have, keeping bodies we already loaded. Nothing new, it's
 * the very same object: the list's rows are memoized, and a refresh then re-renders only what changed.
 */
export function mergeThread(prev: Thread | undefined, next: Thread): Thread {
  if (!prev) return next;
  const loaded = new Map(prev.messages.filter((m) => m.bodyLoaded).map((m) => [m.id, m]));
  const lastId = (t: Thread) => t.messages[t.messages.length - 1]?.id;
  const merged = {
    ...next,
    // Only the No reply yet list says a conversation waits; other lists don't, and mustn't undo that while nothing new came.
    ...(next.awaiting === undefined && prev.awaiting && lastId(prev) === lastId(next) ? { awaiting: true } : {}),
    messages: next.messages.map((m) => {
      const old = loaded.get(m.id);
      return !m.bodyLoaded && old
        ? { ...m, html: old.html, bodyLoaded: true, blockedImages: old.blockedImages, trackers: old.trackers, spyPixels: old.spyPixels, cleanedLinks: old.cleanedLinks, remoteImages: old.remoteImages, stranger: old.stranger, nameMismatch: old.nameMismatch }
        : m;
    }),
  };
  return sameData(prev, merged) ? prev : merged;
}

/** Deep equality for plain data from the API; a key that's missing and one that's undefined are the same. */
export function sameData(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || !a || !b) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => sameData(v, b[i]));
  }
  const x = a as Record<string, unknown>;
  const y = b as Record<string, unknown>;
  for (const k in x) if (!sameData(x[k], y[k])) return false;
  for (const k in y) if (!(k in x) && y[k] !== undefined) return false;
  return true;
}

/* -------------------------------- Contacts -------------------------------- */

let contactsCache: Promise<{ name: string; email: string }[]> | null = null;

/** People you mail with, most frequent first (fetched once per session; the composer suggests from it). */
export function loadContacts() {
  contactsCache ??= api.get<{ name: string; email: string }[]>("/api/contacts").catch(() => {
    contactsCache = null;
    return [];
  });
  return contactsCache;
}
