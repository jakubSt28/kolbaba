import { isFresh, threadCode } from "./codes";
import type { ListItem } from "./store";
import type { Thread } from "./types";

/**
 * Bundles (Google Inbox's best idea): in Inbox, newsletters fold into one "Newsletters" row and the
 * automatic mail from shops, banks and apps into one "Notifications" row, so what's left in sight is
 * mostly people. A tap opens the row. What still needs you never folds away: pinned mail, a fresh
 * sign-in code, a conversation you replied in, a reminder or snooze that just came back, a card
 * with something to do (an invoice to pay, a parcel on its way), "Notify me of replies".
 */

export type BundleKind = "newsletter" | "notification";
export const BUNDLE_KINDS: BundleKind[] = ["newsletter", "notification"];

export interface BundleItem {
  type: "bundle";
  /** "bundle:newsletter" */
  id: string;
  kind: BundleKind;
  /** Newest first. */
  threads: Thread[];
  open: boolean;
}

/** A row in a list as drawn: a conversation (maybe inside an open bundle), a draft, or a bundle's own row. */
export type DisplayItem = (ListItem & { inBundle?: BundleKind }) | BundleItem;

/** A bundle needs at least this many conversations; a lone newsletter is just a row. */
export const MIN_BUNDLE = 2;
const DAY = 86_400_000;

/** Which bundle a conversation folds into, if any. */
export function bundleOf(t: Thread, mine: Set<string>, now = Date.now()): BundleKind | null {
  if (t.kind !== "newsletter" && t.kind !== "notification") return null;
  if (t.pinned || t.watched || t.screening) return null;
  if (t.followUpAt && t.followUpAt <= now) return null;
  if (t.wokeAt && now - t.wokeAt < DAY) return null;
  if (t.messages.some((m) => mine.has(m.from.email.toLowerCase()))) return null;
  if (t.insight && !t.insight.doneAt && t.insight.category !== "subscription") return null;
  const code = threadCode(t);
  if (code && isFresh(code, now)) return null;
  return t.kind;
}

/**
 * Inbox's list with bundles: each bundle's row stands where its newest conversation would be. With
 * `members`, an open bundle's conversations follow its row (the order J/K walks); without, they're
 * only in the bundle (its row draws them).
 */
export function withBundles(items: ListItem[], opts: { open: string[]; mine: Set<string>; now?: number; members?: boolean }): DisplayItem[] {
  const now = opts.now ?? Date.now();
  const kinds = new Map<string, BundleKind>();
  const members: Record<BundleKind, Thread[]> = { newsletter: [], notification: [] };
  for (const item of items) {
    if (item.type !== "thread") continue;
    const kind = bundleOf(item.thread, opts.mine, now);
    if (!kind) continue;
    kinds.set(item.id, kind);
    members[kind].push(item.thread);
  }
  const out: DisplayItem[] = [];
  const placed = new Set<BundleKind>();
  for (const item of items) {
    const kind = kinds.get(item.id);
    if (!kind || members[kind].length < MIN_BUNDLE) {
      out.push(item);
      continue;
    }
    if (placed.has(kind)) continue;
    placed.add(kind);
    const open = opts.open.includes(kind);
    out.push({ type: "bundle", id: `bundle:${kind}`, kind, threads: members[kind], open });
    // Keyboard order lists an open bundle's conversations after its row; drawing keeps them inside it.
    if (open && opts.members) for (const t of members[kind]) out.push({ type: "thread", id: t.id, thread: t, inBundle: kind });
  }
  return out;
}

/** The senders a bundle row names: "Rohlík, Alza, Seznam Zprávy" and how many more. */
export function bundleSenders(threads: Thread[], mine: Set<string>, max = 3): { names: string[]; more: number } {
  const names: string[] = [];
  for (const t of threads) {
    const from = [...t.messages].reverse().find((m) => !mine.has(m.from.email.toLowerCase()))?.from;
    const name = from ? from.name || from.email.split("@")[0] : "";
    if (name && !names.includes(name)) names.push(name);
  }
  return { names: names.slice(0, max), more: Math.max(0, names.length - max) };
}

/** Inbox shows this many pinned conversations; the rest fold under a "+N more" row. */
export const PINNED_SHOWN = 3;

/**
 * The pinned conversations Inbox shows: the newest few (so one with a new reply moves into sight by
 * itself), plus `keep`, the one open in the reader. Folds only when at least two would hide, as a
 * "+1 more" row is as tall as the row it hides. `foldable`: there's a row to fold or unfold with.
 */
export function foldPinned<T extends { id: string }>(items: T[], open: boolean, keep: string | null = null): { shown: T[]; hidden: T[]; foldable: boolean } {
  if (items.length <= PINNED_SHOWN + 1) return { shown: items, hidden: [], foldable: false };
  if (open) return { shown: items, hidden: [], foldable: true };
  const shown: T[] = [];
  const hidden: T[] = [];
  items.forEach((x, i) => (i < PINNED_SHOWN || x.id === keep ? shown : hidden).push(x));
  return hidden.length < 2 ? { shown: items, hidden: [], foldable: false } : { shown, hidden, foldable: true };
}
