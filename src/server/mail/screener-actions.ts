import { and, desc, eq, sql } from "drizzle-orm";
import { isFreeMail } from "@/lib/mail-domains";
import { db, schema } from "../db";
import { recordHistory, snapshotThreads } from "../history";
import { HttpError } from "../http-error";
import { logWarn } from "../log";
import { domainKey } from "./screener";
import { moveThread, patchThreads } from "./service";

/** The sender of a message as the key a rule is stored under: the address, or "@domain" for a domain rule. */
const fromMatches = (key: string) =>
  key.startsWith("@") ? sql`substring(lower(m."from"->>'email') from '@[^@]*$') = ${key}` : sql`lower(m."from"->>'email') = ${key}`;

/** Threads from this sender (or domain) that wait in the screener (or, for a block, are still in Inbox). */
async function threadsFrom(userId: string, key: string, opts: { screeningOnly: boolean }) {
  const t = schema.threads;
  return db()
    .select({ id: t.id })
    .from(t)
    .where(
      and(
        eq(t.userId, userId),
        opts.screeningOnly ? eq(t.screening, true) : sql`(${t.screening} or ${t.folder} = 'inbox')`,
        sql`exists (select 1 from ${schema.messages} m where m.thread_id = ${t.id} and not m.is_outgoing and ${fromMatches(key)})`,
      ),
    );
}

/**
 * Yes: their mail reaches Inbox from now on, including what waits now. No: what waits (and what's in
 * Inbox) goes to Archive, and so will anything they send later.
 */
export async function decideSender(userId: string, sender: { email: string; name?: string }, status: "allowed" | "blocked") {
  const email = sender.email.trim().toLowerCase();
  await db()
    .insert(schema.senders)
    .values({ userId, email, name: sender.name ?? "", status })
    .onConflictDoUpdate({ target: [schema.senders.userId, schema.senders.email], set: { status, decidedAt: new Date(), ...(sender.name ? { name: sender.name } : {}) } });
  const threads = await threadsFrom(userId, email, { screeningOnly: status === "allowed" });
  if (!threads.length) return { threads: [] as string[] };
  await db()
    .update(schema.threads)
    .set({ screening: false })
    .where(sql`${schema.threads.id} in (${sql.join(threads.map((x) => sql`${x.id}`), sql`, `)})`);
  if (status === "blocked") {
    for (const th of threads) await moveThread(userId, th.id, "archive").catch((err) => logWarn(`[screener] archive ${th.id}`, err));
  }
  return { threads: threads.map((x) => x.id) };
}

/**
 * Block from any email: whatever they (or, with `domain`, anyone at their domain) send goes to Trash
 * from now on, and what's in Inbox from them goes there now. Logged in My history, where Undo unblocks
 * and puts the mail back.
 */
export async function blockSender(userId: string, sender: { email: string; name?: string }, opts: { domain?: boolean } = {}) {
  const email = sender.email.trim().toLowerCase();
  const key = opts.domain ? domainKey(email) : email;
  if (opts.domain && isFreeMail(email)) {
    throw new HttpError(400, "{domain} is a free email service: block the address instead", "free_mail_domain", { domain: key.slice(1) });
  }
  await db()
    .insert(schema.senders)
    .values({ userId, email: key, name: opts.domain ? "" : (sender.name ?? ""), status: "blocked", bin: true })
    .onConflictDoUpdate({ target: [schema.senders.userId, schema.senders.email], set: { status: "blocked", bin: true, decidedAt: new Date() } });
  const ids = (await threadsFrom(userId, key, { screeningOnly: false })).map((x) => x.id);
  const before = await snapshotThreads(userId, ids);
  if (ids.length) await db().update(schema.threads).set({ screening: false }).where(sql`${schema.threads.id} in (${sql.join(ids.map((x) => sql`${x}`), sql`, `)})`);
  const moved: string[] = [];
  for (const id of ids) {
    await moveThread(userId, id, "trash").then(
      () => moved.push(id),
      (err) => logWarn(`[block] trash ${id}`, err),
    );
  }
  const historyId = await recordHistory(userId, { kind: "blocked", data: { sender: key } }, before.filter((b) => moved.includes(b.id)), { count: moved.length, always: true });
  return { key, threads: moved, historyId };
}

/**
 * Undo a decision ("Unblock"). A screener no turns into a yes (they're someone the user decided about);
 * a block from any email, or a whole domain, is simply gone.
 */
export async function forgetSender(userId: string, email: string) {
  const key = email.trim().toLowerCase();
  const where = and(eq(schema.senders.userId, userId), eq(schema.senders.email, key));
  const [row] = await db().select({ bin: schema.senders.bin }).from(schema.senders).where(where);
  if (!row) return;
  if (row.bin || key.startsWith("@")) await db().delete(schema.senders).where(where);
  else await db().update(schema.senders).set({ status: "allowed", decidedAt: new Date() }).where(where);
}

export async function listSenders(userId: string, status: "allowed" | "blocked") {
  const rows = await db()
    .select()
    .from(schema.senders)
    .where(and(eq(schema.senders.userId, userId), eq(schema.senders.status, status)))
    .orderBy(desc(schema.senders.decidedAt));
  return rows.map((r) => ({ email: r.email, name: r.name, decidedAt: r.decidedAt.getTime(), bin: r.bin, domain: r.email.startsWith("@") }));
}

/**
 * Worker: mail from blocked senders that arrived after the decision goes to Archive (a screener no) or
 * Trash (blocked). A domain rule covers everyone there, except someone the user let through by name.
 */
export async function archiveBlockedMail() {
  const rows = await db().execute<{ thread_id: string; user_id: string; bin: boolean }>(sql`
    select distinct on (m.thread_id) m.thread_id, m.user_id, s.bin
    from ${schema.messages} m
    join ${schema.senders} s on s.user_id = m.user_id and s.status = 'blocked'
      and (s.email = lower(m."from"->>'email') or s.email = substring(lower(m."from"->>'email') from '@[^@]*$'))
    join ${schema.threads} t on t.id = m.thread_id
    where t.folder = 'inbox' and not m.is_outgoing and m.date >= s.decided_at - interval '1 minute'
      -- Recent mail only (messages_user_date_idx), not everything since the decision on every round.
      and m.date > now() - interval '30 days'
      and not (s.email like '@%' and exists (
        select 1 from ${schema.senders} a where a.user_id = m.user_id and a.email = lower(m."from"->>'email') and a.status = 'allowed'
      ))
    order by m.thread_id, s.bin desc
    limit 50`);
  for (const r of rows) {
    await moveThread(r.user_id, r.thread_id, r.bin ? "trash" : "archive").catch((err) => logWarn(`[screener] move ${r.thread_id}`, err));
  }
  return rows.length;
}

/**
 * A sender's conversations that are still around (Inbox, Archive, own folders), pinned ones aside:
 * what "Unsubscribe" offers to clean up. At most 500 at a time.
 */
export async function senderThreads(userId: string, email: string, opts: { inboxOnly?: boolean } = {}) {
  const key = email.trim().toLowerCase();
  const t = schema.threads;
  const rows = await db()
    .select({ id: t.id, folder: t.folder })
    .from(t)
    .where(
      and(
        eq(t.userId, userId),
        eq(t.pinned, false),
        opts.inboxOnly ? eq(t.folder, "inbox") : sql`${t.folder} in ('inbox', 'archive')`,
        sql`exists (select 1 from ${schema.messages} m where m.thread_id = ${t.id} and not m.is_outgoing and ${fromMatches(key)})`,
      ),
    )
    .limit(500);
  return rows;
}

/** "Archive all" / "Delete all" after unsubscribing: one line in My history, so one Undo brings them back. */
export async function cleanUpSender(userId: string, email: string, to: "archive" | "trash") {
  const ids = (await senderThreads(userId, email, { inboxOnly: to === "archive" })).map((r) => r.id);
  const before = await snapshotThreads(userId, ids);
  const failed = await patchThreads(userId, ids, { folder: to });
  const done = before.filter((b) => !failed.includes(b.id));
  const historyId = await recordHistory(userId, { kind: to === "archive" ? "archived" : "deleted" }, done);
  return { threads: done.map((b) => b.id), failed, historyId };
}
