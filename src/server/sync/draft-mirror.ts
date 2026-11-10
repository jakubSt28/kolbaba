import { and, asc, eq, isNull, lt, or, sql } from "drizzle-orm";
import type { Person } from "../db/schema";
import { db, schema } from "../db";
import { withAdapter } from "../mail/adapters";
import { toEmail } from "../mail/email-html";
import { draftParts } from "../mail/outgoing-attachments";
import { htmlToText } from "../mail/sanitize";
import { logWarn } from "../log";

/**
 * Drafts written in the app get a copy at the provider (Gmail drafts, the IMAP Drafts folder), so a
 * draft started here can be finished on another device. The worker mirrors a draft once its edits have
 * settled for a while, rather than on every keystroke, and removes the copy when it's sent or discarded.
 * The other way round (drafts started, changed or finished in other clients) is src/server/sync/draft-import.ts.
 */

/** Edits keep coming while someone types; the copy follows once they pause this long. */
const SETTLE_MS = 15_000;
const PER_TICK = 20;
const MAX_CLEANUP_ATTEMPTS = 5;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Recipients as typed so far; a half-written address is left out instead of failing the copy. */
function people(value: string): Person[] {
  return value
    .split(/[,;\n]/)
    .map((part) => part.trim())
    .flatMap((part) => {
      const m = part.match(/^(?:"?([^"<]*?)"?\s*)?<([^>]+)>$/);
      const email = (m ? m[2] : part).trim();
      return EMAIL.test(email) ? [{ name: m?.[1]?.trim() || "", email }] : [];
    });
}

type DraftRow = typeof schema.drafts.$inferSelect;

async function mirrorOne(d: DraftRow) {
  const [account] = await db().select().from(schema.accounts).where(eq(schema.accounts.id, d.accountId));
  const done = (providerDraftId: string | null, providerVersion: string | null = d.providerVersion) =>
    db()
      .update(schema.drafts)
      .set({ providerDraftId, providerVersion, providerSyncedAt: d.updatedAt })
      // Edited again meanwhile: the copy is behind, and the next tick writes it.
      .where(and(eq(schema.drafts.id, d.id), eq(schema.drafts.updatedAt, d.updatedAt)))
      .returning({ id: schema.drafts.id });

  if (!account || account.status === "auth_error") return done(d.providerDraftId);
  const empty = !d.to.trim() && !d.cc.trim() && !d.bcc.trim() && !d.subject.trim() && !htmlToText(d.html).trim();
  if (empty) {
    // A composer opened and left blank isn't worth a draft anywhere else.
    if (d.providerDraftId) await db().insert(schema.providerCleanups).values({ accountId: account.id, kind: "draft", ref: d.providerDraftId });
    return done(null, null);
  }

  const [user] = await db().select({ name: schema.users.name }).from(schema.users).where(eq(schema.users.id, d.userId));
  const [sig] = await db()
    .select({ html: schema.signatures.html })
    .from(schema.signatures)
    .where(and(eq(schema.signatures.accountId, account.id), eq(schema.signatures.isDefault, true)));
  let providerThreadId: string | null = null;
  let inReplyTo: string | null = null;
  let references: string[] = [];
  if (d.threadId) {
    const [t] = await db().select({ p: schema.threads.providerThreadId }).from(schema.threads).where(eq(schema.threads.id, d.threadId));
    if (account.provider === "gmail") providerThreadId = t?.p ?? null;
    const [parent] = await db()
      .select({ id: schema.messages.messageIdHeader, refs: schema.messages.references })
      .from(schema.messages)
      .where(and(eq(schema.messages.threadId, d.threadId), sql`${schema.messages.messageIdHeader} is not null`))
      .orderBy(sql`${schema.messages.date} desc`)
      .limit(1);
    if (parent?.id) {
      inReplyTo = parent.id;
      references = [...parent.refs, parent.id].slice(-20);
    }
  }
  const parts = await draftParts(d.userId, d.id, d.html);
  const email = toEmail(parts.html, { signatureHtml: sig?.html || undefined });
  const saved = await withAdapter(account, async (adapter) =>
    adapter.saveDraft
      ? adapter.saveDraft(
          {
            from: { name: account.fromName || user?.name || "", email: account.email },
            to: people(d.to),
            cc: people(d.cc),
            bcc: people(d.bcc),
            subject: d.subject,
            html: email.html,
            text: email.text,
            inReplyTo,
            references,
            providerThreadId,
            attachments: parts.attachments,
          },
          d.providerDraftId,
        )
      : null,
  );
  const updated = await done(saved?.ref ?? null, saved?.version ?? null);
  if (updated.length || !saved) return;
  // Sent or discarded while we were writing the copy: it mustn't stay behind. (Edited again meanwhile:
  // the next copy replaces this one, so only remember where it is.)
  const [still] = await db().select({ id: schema.drafts.id }).from(schema.drafts).where(eq(schema.drafts.id, d.id));
  if (still) await db().update(schema.drafts).set({ providerDraftId: saved.ref, providerVersion: saved.version }).where(eq(schema.drafts.id, d.id));
  else await db().insert(schema.providerCleanups).values({ accountId: account.id, kind: "draft", ref: saved.ref });
}

/** One worker tick: settled drafts whose copy is behind, then copies that should go. */
export async function mirrorDrafts() {
  const due = await db()
    .select()
    .from(schema.drafts)
    .where(
      and(
        lt(schema.drafts.updatedAt, new Date(Date.now() - SETTLE_MS)),
        or(isNull(schema.drafts.providerSyncedAt), lt(schema.drafts.providerSyncedAt, schema.drafts.updatedAt)),
      ),
    )
    .orderBy(asc(schema.drafts.updatedAt))
    .limit(PER_TICK);
  for (const d of due) {
    await mirrorOne(d).catch(async (err) => {
      logWarn(`[drafts] couldn't mirror ${d.id}`, err);
      // Try again after the next edit rather than every tick.
      await db().update(schema.drafts).set({ providerSyncedAt: d.updatedAt }).where(eq(schema.drafts.id, d.id));
    });
  }
  await removeProviderCopies();
}

async function removeProviderCopies() {
  const rows = await db().select().from(schema.providerCleanups).orderBy(asc(schema.providerCleanups.createdAt)).limit(PER_TICK);
  for (const row of rows) {
    const [account] = await db().select().from(schema.accounts).where(eq(schema.accounts.id, row.accountId));
    try {
      if (account && account.status !== "auth_error") await withAdapter(account, (a) => a.deleteDraft?.(row.ref) ?? Promise.resolve());
      await db().delete(schema.providerCleanups).where(eq(schema.providerCleanups.id, row.id));
    } catch (err) {
      logWarn(`[drafts] couldn't remove ${row.ref}`, err);
      if (row.attempts + 1 >= MAX_CLEANUP_ATTEMPTS) await db().delete(schema.providerCleanups).where(eq(schema.providerCleanups.id, row.id));
      else await db().update(schema.providerCleanups).set({ attempts: row.attempts + 1 }).where(eq(schema.providerCleanups.id, row.id));
    }
  }
}
