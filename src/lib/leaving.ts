import type { Signature } from "./store";

/**
 * How conversations just left the list, so each row leaves the way it went (components/message-list.tsx):
 * archived to the right, filed to the left towards the sidebar, deleted down, snoozed up. Read when the
 * row's exit starts, right after the change that removed it; and when it comes back (Undo), so it
 * returns from where it went.
 */
const kinds = new Map<string, { sig: Signature; at: number }>();
const LEAVING_MS = 1500;
const RETURNING_MS = 15_000;

export function markLeaving(ids: string[], sig: Signature) {
  const at = Date.now();
  for (const [id, k] of kinds) if (at - k.at > RETURNING_MS) kinds.delete(id);
  for (const id of ids) kinds.set(id, { sig, at });
}

/**
 * What took this row away, if it happened just now. Motion resolves an exit more than once as it
 * starts, so reading it doesn't use it up: every read has to give the same answer.
 */
export function leavingKind(id: string): Signature | null {
  const k = kinds.get(id);
  return k && Date.now() - k.at < LEAVING_MS ? k.sig : null;
}

/** A row that's back in the list soon after it left (Undo): what had taken it away. */
export function returningKind(id: string): Signature | null {
  const k = kinds.get(id);
  return k && Date.now() - k.at < RETURNING_MS ? k.sig : null;
}
