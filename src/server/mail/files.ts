import { sql, type SQL } from "drizzle-orm";
import type { FileItem, FileKindFilter } from "@/lib/types";
import { db, schema } from "../db";
import type { AttachmentMeta, Person } from "../db/schema";
import { attachmentKind, formatBytes } from "./dto";

/**
 * Files: every attachment across the mailboxes, newest first, paged by message so one email's files
 * stay together. Inline images, calendar invitations and the tiny pictures signatures carry aren't
 * files anyone looks for; Trash and Spam stay out.
 */

const PAGE = 40;

/** One attachment (`a.value`) is a file worth listing, and of the kind asked for. */
function attachmentFilter(kind: FileKindFilter): SQL {
  const mime = sql`lower(a.value->>'mime')`;
  const name = sql`lower(a.value->>'name')`;
  const image = sql`${mime} like 'image/%'`;
  const pdf = sql`(${mime} = 'application/pdf' or ${name} like '%.pdf')`;
  const calendar = sql`(${mime} = 'text/calendar' or ${name} like '%.ics')`;
  const zip = sql`(${mime} ~ 'zip|compressed|x-tar|x-7z|rar' or ${name} ~ '\\.(zip|rar|7z|gz|tar)$')`;
  const sheet = sql`(${mime} ~ 'sheet|excel|csv' or ${name} ~ '\\.(xlsx?|csv|numbers|ods)$')`;
  const base = sql`coalesce((a.value->>'inline')::boolean, false) = false and not ${calendar} and not (${image} and coalesce((a.value->>'size')::int, 0) < 10240)`;
  const byKind: Record<FileKindFilter, SQL> = {
    all: sql`true`,
    image,
    pdf,
    sheet,
    zip,
    doc: sql`not ${image} and not ${pdf} and not ${sheet} and not ${zip}`,
  };
  return sql`(${base} and ${byKind[kind]})`;
}

export async function listFiles(
  userId: string,
  opts: { scope?: string; kind?: FileKindFilter; query?: string; since?: number; cursor?: string } = {},
): Promise<{ files: FileItem[]; nextCursor: string | null }> {
  const m = schema.messages;
  const filter = attachmentFilter(opts.kind ?? "all");
  const where: SQL[] = [
    sql`${m.userId} = ${userId}`,
    sql`${m.attachments} <> '[]'::jsonb`,
    sql`t.folder not in ('trash', 'spam')`,
  ];
  if (opts.scope && opts.scope !== "all") where.push(sql`${m.accountId} = ${opts.scope}`);
  if (opts.since) where.push(sql`${m.date} >= ${new Date(opts.since).toISOString()}::timestamptz`);
  const [cursorAt, cursorId] = (opts.cursor ?? "").split("|");
  if (cursorAt && cursorId && Number.isFinite(Number(cursorAt))) {
    where.push(sql`(${m.date}, ${m.id}) < (${new Date(Number(cursorAt)).toISOString()}::timestamptz, ${cursorId})`);
  }
  // A file's name, or who it's from (name or address).
  const words = (opts.query ?? "").trim().toLowerCase();
  const match = (from: SQL) =>
    words
      ? sql`(lower(a.value->>'name') like ${`%${words}%`} or lower(${from}->>'email') like ${`%${words}%`} or lower(${from}->>'name') like ${`%${words}%`})`
      : sql`true`;

  const rows = await db().execute<{
    id: string;
    thread_id: string;
    account_id: string;
    date: string | Date;
    from: Person;
    subject: string;
    is_outgoing: boolean;
    att: AttachmentMeta;
  }>(sql`
    with page as (
      select ${m.id} as id, ${m.threadId} as thread_id, ${m.accountId} as account_id, ${m.date} as date, ${m.from} as "from",
             ${m.subject} as subject, ${m.isOutgoing} as is_outgoing, ${m.attachments} as attachments
      from ${m}
      join ${schema.threads} t on t.id = ${m.threadId}
      where ${sql.join(where, sql` and `)}
        and exists (select 1 from jsonb_array_elements(${m.attachments}) a where ${filter} and ${match(sql`${m.from}`)})
      order by ${m.date} desc, ${m.id} desc
      limit ${PAGE + 1}
    )
    select page.id, page.thread_id, page.account_id, page.date, page."from", page.subject, page.is_outgoing, a.value as att
    from page cross join lateral jsonb_array_elements(page.attachments) a
    where ${filter} and ${match(sql`page."from"`)}
    order by page.date desc, page.id desc`);

  const messages = [...new Set(rows.map((r) => r.id))];
  const more = messages.length > PAGE;
  const keep = new Set(messages.slice(0, PAGE));
  const files: FileItem[] = rows
    .filter((r) => keep.has(r.id))
    .map((r) => ({
      id: `${r.id}:${r.att.id}`,
      messageId: r.id,
      threadId: r.thread_id,
      accountId: r.account_id,
      date: new Date(r.date).getTime(),
      from: r.from,
      subject: r.subject,
      outgoing: r.is_outgoing,
      name: r.att.name,
      size: formatBytes(r.att.size),
      kind: attachmentKind(r.att.name, r.att.mime),
      url: `/api/attachments/${r.id}/${encodeURIComponent(r.att.id)}`,
    }));
  const last = files.at(-1);
  return { files, nextCursor: more && last ? `${last.date}|${last.messageId}` : null };
}
