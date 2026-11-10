import type { SyncState } from "../../db/schema";

/** Small pure helpers for the IMAP sync loop. */

export type FolderState = NonNullable<SyncState["folders"]>[string];

/** UIDs → compact IMAP sequence set ("1:3,7,9:10"), keeping commands short for big batches. */
export function compactUidSet(uids: number[]): string {
  const sorted = [...new Set(uids)].sort((a, b) => a - b);
  const ranges: string[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const start = sorted[i];
    while (i + 1 < sorted.length && sorted[i + 1] === sorted[i] + 1) i++;
    ranges.push(start === sorted[i] ? String(start) : `${start}:${sorted[i]}`);
  }
  return ranges.join(",");
}

/**
 * The same set in parts of at most `maxChars` each. A server may drop the connection on a command
 * line that's too long: Seznam closed one at ~88 kB without a word, and the mailbox stopped syncing.
 * RFC 7162 asks clients to stay under 8192 octets per line.
 */
export function uidSetParts(uids: number[], maxChars = 7000): string[] {
  const parts: string[] = [];
  let part = "";
  for (const range of compactUidSet(uids).split(",")) {
    if (!range) continue;
    if (part && part.length + 1 + range.length > maxChars) {
      parts.push(part);
      part = "";
    }
    part = part ? `${part},${range}` : range;
  }
  if (part) parts.push(part);
  return parts;
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Expunge detection for servers without QRESYNC: given the UIDs currently present among the newest
 * `window` messages, every UID below the previous UIDNEXT that is inside the covered range but no
 * longer present was expunged (or never existed, which the sink treats as a no-op).
 *
 * When the window is full, it covers [min(present), uidNext); otherwise the whole mailbox fits in
 * the window and we scan down to `maxScan` UIDs below uidNext.
 */
export function missingUids(present: number[], uidNext: number, window: number, maxScan = 1000): number[] {
  const set = new Set(present);
  const low = present.length >= window ? Math.min(...present) : 1;
  const from = Math.max(low, uidNext - maxScan, 1);
  const out: number[] = [];
  for (let uid = uidNext - 1; uid >= from; uid--) if (!set.has(uid)) out.push(uid);
  return out;
}

/**
 * All UIDs a folder could have had under its old UIDVALIDITY, newest first and capped. Only for sinks
 * without `forgetFolder`, which then get every possible id named.
 */
export function uidsBelow(uidNext: number | undefined, cap: number): number[] {
  if (!uidNext || uidNext <= 1) return [];
  const out: number[] = [];
  for (let uid = uidNext - 1; uid >= Math.max(1, uidNext - cap); uid--) out.push(uid);
  return out;
}

/** Exponential backoff with jitter: 1 s, 2 s, 4 s … capped. */
export function backoffDelay(failures: number, maxMs: number, random = Math.random): number {
  const base = Math.min(maxMs, 1000 * 2 ** Math.min(failures, 20));
  return Math.round(base * (0.75 + random() * 0.5));
}

export function parseModseq(value: string | undefined): bigint | null {
  if (!value || !/^\d+$/.test(value)) return null;
  return BigInt(value);
}
