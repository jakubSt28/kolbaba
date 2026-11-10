import { sql } from "drizzle-orm";
import type { MailingList } from "@/lib/types";
import { db, schema } from "../db";

/** How far back Newsletters looks. */
export const LISTS_DAYS = 90;

/**
 * Newsletters (the manager): everyone who sent newsletters in the last three months, with how much
 * and how little of it was read, so the ones nobody opens can go several at a time. Senders the user
 * blocked are out (they're taken care of).
 */
export async function listNewsletters(userId: string): Promise<MailingList[]> {
  const rows = await db().execute<{
    email: string;
    name: string | null;
    logo: string | null;
    total: number;
    recent: number;
    read: number;
    last_at: Date | string;
    last_subject: string | null;
    in_inbox: number;
    unsubscribe_thread: string | null;
    unsubscribed_at: Date | string | null;
    latest_thread: string;
  }>(sql`
    with mail as (
      select lower(m."from"->>'email') as email, nullif(m."from"->>'name', '') as name, m.unread, m.date, m.subject,
        t.id as thread_id, t.folder, t.list_unsubscribe, t.unsubscribed_at, t.logo_domain
      from ${schema.messages} m
      join ${schema.threads} t on t.id = m.thread_id
      where m.user_id = ${userId}
        and not m.is_outgoing
        and t.kind = 'newsletter'
        and t.folder <> 'spam'
        and m.date > now() - ${sql.raw(`interval '${LISTS_DAYS} days'`)}
        and not exists (
          select 1 from ${schema.senders} s
          where s.user_id = ${userId} and s.status = 'blocked'
            and (s.email = lower(m."from"->>'email') or s.email = substring(lower(m."from"->>'email') from '@[^@]*$'))
        )
    )
    select email,
      (array_agg(name order by date desc) filter (where name is not null))[1] as name,
      max(logo_domain) as logo,
      count(*)::int as total,
      (count(*) filter (where date > now() - interval '30 days'))::int as recent,
      (count(*) filter (where not unread))::int as read,
      max(date) as last_at,
      (array_agg(subject order by date desc))[1] as last_subject,
      (count(distinct thread_id) filter (where folder = 'inbox'))::int as in_inbox,
      (array_agg(thread_id order by date desc) filter (where list_unsubscribe is not null))[1] as unsubscribe_thread,
      max(unsubscribed_at) as unsubscribed_at,
      (array_agg(thread_id order by date desc))[1] as latest_thread
    from mail
    where email <> ''
    group by email
    order by recent desc, total desc
    limit 300`);
  const ms = (v: Date | string | null) => (v ? new Date(v).getTime() : null);
  return rows.map((r) => ({
    email: r.email,
    name: r.name ?? "",
    logo: r.logo,
    total: r.total,
    recent: r.recent,
    read: r.read,
    lastAt: ms(r.last_at) ?? 0,
    lastSubject: r.last_subject ?? "",
    inInbox: r.in_inbox,
    unsubscribeThreadId: r.unsubscribe_thread,
    unsubscribedAt: ms(r.unsubscribed_at),
    latestThreadId: r.latest_thread,
  }));
}
