import { t } from "./i18n";
import type { AwayReply, LegacyAwayReply } from "./types";

/**
 * Out-of-office replies: the rules both the app and the worker go by. A user keeps up to
 * MAX_AWAY_REPLIES of them; a mailbox answers with at most one reply that's on.
 */

export const MAX_AWAY_REPLIES = 20;

/** What a reply is called where the user sees it. */
export const awayName = (reply: AwayReply) => reply.name.trim() || t("Out of office");

/** The user's replies, with the single one from before there could be several turned into the first. */
export function awayRepliesOf(settings: { awayReplies?: AwayReply[]; away?: LegacyAwayReply }, allAccountIds: string[]): AwayReply[] {
  if (settings.awayReplies) return settings.awayReplies;
  const old = settings.away;
  if (!old || (!old.on && !old.message.trim())) return [];
  return [{ ...old, id: "away", name: "", accountIds: old.accountIds ?? allAccountIds }];
}

/** Answering right now: on, in some mailbox, and inside its dates. */
export function awayActive(reply: AwayReply, now = Date.now()) {
  return reply.on && reply.accountIds.length > 0 && (!reply.from || reply.from <= now) && (!reply.until || reply.until >= now);
}

/** On, but its first day hasn't come yet. */
export const awayWaiting = (reply: AwayReply, now = Date.now()) => reply.on && reply.accountIds.length > 0 && !!reply.from && reply.from > now;

/** On and not over: answering now, or waiting for its first day. */
export const awayOn = (reply: AwayReply, now = Date.now()) => reply.on && reply.accountIds.length > 0 && (!reply.until || reply.until >= now);

/**
 * `reply` (changed) takes its place in the list. If it's on, the mailboxes it answers in leave every
 * other reply that's on, so each mailbox answers with one; a reply left with none turns off (and keeps
 * the rest as it was, for next time). Returns the new list and the replies that gave mailboxes up.
 */
export function placeAway(replies: AwayReply[], reply: AwayReply): { replies: AwayReply[]; moved: AwayReply[] } {
  const moved: AwayReply[] = [];
  const mine = new Set(reply.on ? reply.accountIds : []);
  const next = replies.map((r) => {
    if (r.id === reply.id) return reply;
    if (!r.on || !r.accountIds.some((id) => mine.has(id))) return r;
    moved.push(r);
    const accountIds = r.accountIds.filter((id) => !mine.has(id));
    return accountIds.length ? { ...r, accountIds } : { ...r, on: false };
  });
  return { replies: next.some((r) => r.id === reply.id) ? next : [...next, reply], moved };
}

/** Which reply answers in each mailbox: of the replies on, the first that has it (a guard; placeAway keeps them apart). */
export function awayByMailbox(replies: AwayReply[], now = Date.now()): Map<string, AwayReply> {
  const out = new Map<string, AwayReply>();
  for (const r of replies) {
    if (!awayActive(r, now)) continue;
    for (const id of r.accountIds) if (!out.has(id)) out.set(id, r);
  }
  return out;
}
