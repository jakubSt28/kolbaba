import { and, eq, inArray, sql } from "drizzle-orm";
import { awayActive, awayRepliesOf } from "@/lib/away";
import type { AwayReply } from "@/lib/types";
import { ACCOUNT_COLUMNS, db, schema } from "../db";
import { logWarn } from "../log";
import { withAdapter, type AccountRow } from "./adapters";
import { baseSubject } from "../sync/sink";
import { isPersonAddress } from "./unanswered";

/**
 * Out of office, sent by Kolbaba itself, so it works the same in every mailbox (Gmail, Seznam, any
 * IMAP) without asking the provider for more access. A user can keep several replies; each mailbox
 * answers with the one that's on for it (src/lib/away.ts). The worker looks at new mail every minute
 * while someone is away and answers people who wrote, once each:
 *
 * - only mail from people (no newsletters, automatic mail or no-reply addresses), not Spam or Trash,
 *   not the screener's waiting room, not blocked senders, not the user's own mailboxes;
 * - with "only people I've written to" on, only addresses in the address book;
 * - one reply per sender and mailbox every AWAY_EVERY_MS (a loop with another autoresponder stops there),
 *   marked Auto-Submitted so well-behaved systems don't answer it (RFC 3834).
 */

export const AWAY_EVERY_MS = 4 * 24 * 3600_000;
/** Mail older than this when the worker first sees it is left alone (a restart doesn't answer last week's mail). */
const FRESH_MS = 2 * 24 * 3600_000;

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The plain-text reply as simple HTML paragraphs. */
export function awayHtml(message: string) {
  return message
    .trim()
    .split(/\n{2,}/)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

/** "Out of office" — or, with the user's subject empty, "Re: <their subject>". */
export const awaySubject = (away: AwayReply, original: string) => away.subject.trim() || `Re: ${baseSubject(original) || original}`;

export async function sendAwayReplies() {
  const users = await db()
    .select({ id: schema.users.id, name: schema.users.name, settings: schema.users.settings })
    .from(schema.users)
    .where(sql`${schema.users.settings}->'awayReplies' @> '[{"on": true}]'::jsonb or (${schema.users.settings}->'away'->>'on')::boolean is true`);
  let sent = 0;
  const now = Date.now();
  for (const user of users) {
    try {
      const accounts = await db().select(ACCOUNT_COLUMNS).from(schema.accounts).where(eq(schema.accounts.userId, user.id));
      const mine = new Set(accounts.map((a) => a.email.toLowerCase()));
      const taken = new Set<string>();
      for (const away of awayRepliesOf(user.settings, accounts.map((a) => a.id))) {
        if (!awayActive(away, now) || !away.message.trim()) continue;
        // Each mailbox answers once: with the first reply that's on for it.
        const own = accounts.filter((a) => away.accountIds.includes(a.id) && !taken.has(a.id) && a.status !== "auth_error");
        own.forEach((a) => taken.add(a.id));
        if (own.length) sent += await answerFor(user, away, own, mine, now);
      }
    } catch (err) {
      logWarn(`[away] ${user.id}`, err);
    }
  }
  return sent;
}

async function answerFor(user: { id: string; name: string }, away: AwayReply, accounts: AccountRow[], mine: Set<string>, now: number) {
  const since = new Date(Math.max(away.from ?? 0, now - FRESH_MS));
  // The newest new email from each sender in each mailbox that hasn't been answered lately.
  const rows = await db().execute<{ account_id: string; email: string; name: string; subject: string; message_id_header: string | null; references: string[]; thread_id: string; provider_thread_id: string }>(sql`
    select distinct on (m.account_id, lower(m."from"->>'email'))
      m.account_id, lower(m."from"->>'email') as email, coalesce(m."from"->>'name', '') as name, m.subject,
      m.message_id_header, m.references, t.id as thread_id, t.provider_thread_id
    from ${schema.messages} m
    join ${schema.threads} t on t.id = m.thread_id
    where m.user_id = ${user.id}
      and m.account_id in (${sql.join(
        accounts.map((a) => sql`${a.id}`),
        sql`, `,
      )})
      and not m.is_outgoing
      and m.date >= ${since.toISOString()}::timestamptz
      and t.kind = 'person'
      and not t.screening
      and t.folder not in ('spam', 'trash')
      and not (m.labels ?| array['role:spam','role:trash','role:drafts'])
      and not exists (
        select 1 from ${schema.awayReplies} r
        where r.account_id = m.account_id and r.email = lower(m."from"->>'email') and r.sent_at > now() - ${sql.raw(`interval '${AWAY_EVERY_MS / 1000} seconds'`)}
      )
      and not exists (
        select 1 from ${schema.senders} s
        where s.user_id = ${user.id} and s.status = 'blocked'
          and (s.email = lower(m."from"->>'email') or s.email = substring(lower(m."from"->>'email') from '@[^@]*$'))
      )
      ${away.onlyKnown ? sql`and exists (select 1 from ${schema.contacts} c where c.user_id = ${user.id} and not c.hidden and c.emails ? lower(m."from"->>'email'))` : sql``}
    order by m.account_id, lower(m."from"->>'email'), m.date desc
    limit 50`);
  let sent = 0;
  for (const r of rows) {
    if (!r.email || mine.has(r.email) || !isPersonAddress(r.email)) continue;
    const account = accounts.find((a) => a.id === r.account_id);
    if (!account) continue;
    // Claimed first: if two workers ever ran this at once, only one of them answers.
    const claimed = await db()
      .insert(schema.awayReplies)
      .values({ accountId: account.id, email: r.email, sentAt: new Date() })
      .onConflictDoUpdate({
        target: [schema.awayReplies.accountId, schema.awayReplies.email],
        set: { sentAt: new Date() },
        setWhere: sql`${schema.awayReplies.sentAt} < now() - ${sql.raw(`interval '${AWAY_EVERY_MS / 1000} seconds'`)}`,
      })
      .returning({ email: schema.awayReplies.email });
    if (!claimed.length) continue;
    try {
      await withAdapter(account, (adapter) =>
        adapter.send({
          from: { name: account.fromName || user.name, email: account.email },
          to: [{ name: r.name, email: r.email }],
          cc: [],
          bcc: [],
          subject: awaySubject(away, r.subject),
          html: awayHtml(away.message),
          text: away.message.trim(),
          inReplyTo: r.message_id_header,
          references: [...(r.references ?? []), ...(r.message_id_header ? [r.message_id_header] : [])].slice(-20),
          providerThreadId: account.provider === "gmail" ? r.provider_thread_id : null,
          // RFC 3834: an automatic reply. Other autoresponders and mailing lists know not to answer it.
          headers: { "Auto-Submitted": "auto-replied", "X-Auto-Response-Suppress": "All", Precedence: "auto_reply" },
        }),
      );
      sent++;
    } catch (err) {
      // Not sent: let it try again next round.
      await db()
        .delete(schema.awayReplies)
        .where(and(eq(schema.awayReplies.accountId, account.id), eq(schema.awayReplies.email, r.email)));
      logWarn(`[away] ${account.id}`, err);
    }
  }
  return sent;
}

/** Forget who got a reply in these mailboxes (a new time away starts fresh). */
export async function resetAwayReplies(userId: string, accountIds: string[]) {
  const ids = (await db().select({ id: schema.accounts.id }).from(schema.accounts).where(eq(schema.accounts.userId, userId)))
    .map((a) => a.id)
    .filter((id) => accountIds.includes(id));
  if (ids.length) await db().delete(schema.awayReplies).where(inArray(schema.awayReplies.accountId, ids));
}
