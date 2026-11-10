import { eq, sql } from "drizzle-orm";
import { translate } from "@/lib/i18n";
import { db, schema } from "../db";
import { withAdapter } from "../mail/adapters";
import { deleteOutboxAttachments, outboxAttachments } from "../mail/outgoing-attachments";
import { MailAuthError } from "../mail/types";
import { notifyUser } from "../push";
import { createTrackingId, injectPixel, pixelUrl } from "../tracking";
import { DbSyncSink } from "./sink";
import { logWarn, safeError } from "../log";

type OutboxRow = typeof schema.outbox.$inferSelect;

const MAX_ATTEMPTS = 5;

/**
 * Claim due outbox rows atomically (SKIP LOCKED), so the worker and the web app's fallback can both
 * run this without ever sending a message twice.
 */
export async function claimDue(limit = 10): Promise<OutboxRow[]> {
  const rows = await db().execute<{ id: string }>(sql`
    update ${schema.outbox} set status = 'sending', attempts = attempts + 1
    where id in (
      select id from ${schema.outbox}
      where status = 'pending' and send_at <= now()
      order by send_at limit ${limit}
      for update skip locked
    )
    returning id`);
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  return db().select().from(schema.outbox).where(sql`${schema.outbox.id} in ${ids}`);
}

/** Claim one specific row if it's due (used right after the undo window by the web app). */
export async function claimOne(id: string): Promise<OutboxRow | null> {
  const [row] = await db()
    .update(schema.outbox)
    .set({ status: "sending", attempts: sql`${schema.outbox.attempts} + 1` })
    .where(sql`${schema.outbox.id} = ${id} and ${schema.outbox.status} = 'pending' and ${schema.outbox.sendAt} <= now()`)
    .returning();
  return row ?? null;
}

export async function processDueOutbox() {
  const rows = await claimDue();
  for (const row of rows) await sendClaimed(row);
  return rows.length;
}

/** Rows stuck in "sending" (process died mid-send) are not retried blindly — they might have gone out. */
export async function failStuckSends() {
  await db()
    .update(schema.outbox)
    .set({ status: "failed", error: "Sending was interrupted. It may or may not have been delivered." })
    .where(sql`${schema.outbox.status} = 'sending' and ${schema.outbox.sendAt} < now() - interval '15 minutes'`);
}

export async function sendClaimed(row: OutboxRow) {
  const [account] = await db().select().from(schema.accounts).where(eq(schema.accounts.id, row.accountId));
  const [user] = await db().select().from(schema.users).where(eq(schema.users.id, row.userId));
  if (!account || !user) {
    await db().update(schema.outbox).set({ status: "failed", error: "Mailbox was removed" }).where(eq(schema.outbox.id, row.id));
    return;
  }

  let html = row.html;
  let trackingId: string | null = null;
  if (row.track) {
    const id: string = createTrackingId();
    trackingId = id;
    html = injectPixel(html, pixelUrl(id));
    await db()
      .insert(schema.trackedMessages)
      .values({
        id,
        userId: row.userId,
        accountId: row.accountId,
        outboxId: row.id,
        threadId: row.threadId,
        subject: row.subject,
        recipients: [...row.to, ...row.cc],
        armedAt: new Date(),
      });
  }

  let providerThreadId: string | null = null;
  if (row.threadId) {
    const [t] = await db().select({ p: schema.threads.providerThreadId }).from(schema.threads).where(eq(schema.threads.id, row.threadId));
    if (account.provider === "gmail") providerThreadId = t?.p ?? null;
  }

  const attachments = await outboxAttachments(row.id);
  let result;
  try {
    result = await withAdapter(account, (adapter) =>
      adapter.send({
        from: { name: account.fromName || user.name, email: account.email },
        to: row.to,
        cc: row.cc,
        bcc: row.bcc,
        subject: row.subject,
        html,
        text: row.text,
        inReplyTo: row.inReplyTo,
        references: row.references,
        providerThreadId,
        attachments,
      }),
    );
  } catch (err) {
    const auth = err instanceof MailAuthError;
    const giveUp = auth || row.attempts >= MAX_ATTEMPTS;
    const backoffMs = Math.min(60_000 * 2 ** (row.attempts - 1), 30 * 60_000);
    await db()
      .update(schema.outbox)
      .set(
        giveUp
          ? { status: "failed", error: safeError(err) }
          : { status: "pending", sendAt: new Date(Date.now() + backoffMs), error: safeError(err) },
      )
      .where(eq(schema.outbox.id, row.id));
    if (giveUp) {
      const locale = user.settings.locale === "cs" ? "cs" : "en";
      const subject = row.subject || translate(locale, "(no subject)");
      await notifyUser(row.userId, {
        title: translate(locale, "Couldn't send your message"),
        body: auth
          ? translate(locale, "“{subject}” — reconnect {name}", { subject, name: account.name })
          : translate(locale, "“{subject}” — open it to try again", { subject }),
        url: "/?folder=scheduled",
        tag: `send-${row.id}`,
      });
    }
    return;
  }

  // From here on the message is out: never flip back to pending.
  await db().update(schema.outbox).set({ status: "sent", error: null }).where(eq(schema.outbox.id, row.id));
  // The files are at the provider now (and in Sent); our copy isn't needed any more.
  await deleteOutboxAttachments(row.id).catch((err) => logWarn("[outbox] attachment clean-up failed", err));

  try {
    const sink = new DbSyncSink(account);
    const providerMessageId = result.providerMessageId ?? `local:${result.messageIdHeader}`;
    await sink.upsertMessages([
      {
        providerMessageId,
        providerThreadId: result.providerThreadId,
        messageIdHeader: result.messageIdHeader,
        inReplyTo: row.inReplyTo,
        references: row.references,
        from: { name: account.fromName || user.name, email: account.email },
        to: row.to,
        cc: row.cc,
        bcc: row.bcc,
        replyTo: [],
        subject: row.subject,
        date: new Date(),
        snippet: row.text.replace(/\s+/g, " ").slice(0, 200),
        html: row.html,
        text: row.text,
        attachments: [],
        unread: false,
        pinned: false,
        role: "sent",
        labels: account.provider === "gmail" ? ["SENT"] : [],
      },
    ]);
    const [msg] = await db()
      .select({ id: schema.messages.id, threadId: schema.messages.threadId })
      .from(schema.messages)
      .where(sql`${schema.messages.accountId} = ${account.id} and ${schema.messages.messageIdHeader} = ${result.messageIdHeader}`)
      .limit(1);
    if (msg) {
      if (trackingId) {
        await db().update(schema.messages).set({ trackingId }).where(eq(schema.messages.id, msg.id));
        await db().update(schema.trackedMessages).set({ messageId: msg.id, threadId: msg.threadId }).where(eq(schema.trackedMessages.id, trackingId));
      }
      if (row.followUpDays) {
        await db()
          .update(schema.threads)
          .set({ followUpAt: new Date(Date.now() + row.followUpDays * 24 * 3600 * 1000) })
          .where(eq(schema.threads.id, msg.threadId));
      }
      await db().update(schema.outbox).set({ messageId: msg.id, threadId: msg.threadId }).where(eq(schema.outbox.id, row.id));
    }
  } catch (err) {
    logWarn(`[outbox ${row.id}] sent, but local bookkeeping failed`, err);
  }
}
