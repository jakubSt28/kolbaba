import { and, eq, ne } from "drizzle-orm";
import sanitizeHtml from "sanitize-html";
import type { Person } from "../db/schema";
import { ACCOUNT_COLUMNS, db, schema } from "../db";
import { withAdapter, type AccountRow } from "../mail/adapters";
import { MAX_ATTACHMENTS_BYTES } from "../mail/outgoing-attachments";
import type { AttachmentContent, MailAdapter, RemoteDraft } from "../mail/types";
import { logWarn } from "../log";

/**
 * Drafts from other clients, into the app (the app's own drafts go out in draft-mirror.ts):
 * - started elsewhere: a new draft here, attachments included;
 * - changed elsewhere: ours follows, unless it was edited here since (then ours wins and the mirror
 *   writes it there);
 * - gone elsewhere (sent or discarded there): ours goes too, unless it was edited here since.
 */

type DraftRow = typeof schema.drafts.$inferSelect;

/** Full contents fetched per mailbox and round; the rest comes next round. */
const PER_ROUND = 15;
/** A copy we just wrote may not be listed yet: never take a draft for gone this soon after syncing it. */
const GONE_GRACE_MS = 2 * 60_000;

/** Signatures and quoted replies other clients (and our own mirror) put in a draft: the app adds its own when sending. */
const DROP_CLASSES = /(^|\s)(pn-signature|gmail_signature|gmail_quote|gmail_extra|moz-cite-prefix|moz-signature)(\s|$)/;

/** A draft's email HTML (or text) as editor HTML: the formatting the editor has, nothing else. */
export function draftToEditorHtml(html: string | null, text: string | null): string {
  if (html?.trim()) {
    const clean = sanitizeHtml(html, {
      allowedTags: ["p", "br", "strong", "b", "em", "i", "u", "s", "a", "ul", "ol", "li", "h1", "h2", "h3", "blockquote", "code", "pre", "hr"],
      // class, id and type are only here so the filter below can see them.
      allowedAttributes: { a: ["href"], blockquote: ["type"], "*": ["class", "id"] },
      allowedSchemes: ["http", "https", "mailto", "tel"],
      transformTags: { div: "p", h4: "h3", h5: "h3", h6: "h3" },
      exclusiveFilter: (frame) =>
        DROP_CLASSES.test(frame.attribs.class ?? "") ||
        frame.attribs.id === "appendonsend" ||
        (frame.tag === "blockquote" && frame.attribs.type === "cite"),
      nonTextTags: ["style", "script", "textarea", "option", "noscript", "title", "head"],
    });
    const bare = sanitizeHtml(clean, {
      allowedTags: ["p", "br", "strong", "b", "em", "i", "u", "s", "a", "ul", "ol", "li", "h1", "h2", "h3", "blockquote", "code", "pre", "hr"],
      allowedAttributes: { a: ["href"] },
    })
      .replace(/(<p>\s*(<br\s*\/?>)?\s*<\/p>\s*)+$/i, "")
      .trim();
    if (bare) return bare;
  }
  const plain = (text ?? "").replace(/\r\n/g, "\n").trim();
  if (!plain) return "";
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return plain
    .split(/\n{2,}/)
    .map((para) => `<p>${esc(para).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

const list = (people: Person[]) => people.map((p) => (p.name ? `${p.name} <${p.email}>` : p.email)).join(", ");

/** The conversation a reply draft belongs to (Gmail's thread, or the message it answers). */
async function threadOf(account: AccountRow, d: RemoteDraft): Promise<string | null> {
  if (d.providerThreadId) {
    const [t] = await db()
      .select({ id: schema.threads.id })
      .from(schema.threads)
      .where(and(eq(schema.threads.accountId, account.id), eq(schema.threads.providerThreadId, d.providerThreadId)));
    if (t) return t.id;
  }
  if (d.inReplyTo) {
    const [m] = await db()
      .select({ threadId: schema.messages.threadId })
      .from(schema.messages)
      .where(and(eq(schema.messages.accountId, account.id), eq(schema.messages.messageIdHeader, d.inReplyTo)));
    if (m) return m.threadId;
  }
  return null;
}

/** Its files, if they fit what a draft here may carry. */
async function filesOf(adapter: MailAdapter, d: RemoteDraft): Promise<AttachmentContent[]> {
  const total = d.attachments.reduce((n, a) => n + a.size, 0);
  if (!d.attachments.length || total > MAX_ATTACHMENTS_BYTES || !adapter.fetchAttachment) return [];
  const files: AttachmentContent[] = [];
  for (const a of d.attachments) files.push(await adapter.fetchAttachment(d.message, a.id));
  return files;
}

async function saveFiles(userId: string, draftId: string, files: AttachmentContent[]) {
  await db().delete(schema.draftAttachments).where(eq(schema.draftAttachments.draftId, draftId));
  for (const f of files) {
    await db()
      .insert(schema.draftAttachments)
      .values({ userId, draftId, name: f.name, mime: f.mime, size: f.content.length, received: f.content.length, content: f.content });
  }
}

/** Edited here since it last matched the provider. */
const editedHere = (d: DraftRow) => !d.providerSyncedAt || d.updatedAt > d.providerSyncedAt;

export async function importDrafts(account: AccountRow) {
  if (account.status === "auth_error") return;
  const ours = await db().select().from(schema.drafts).where(eq(schema.drafts.accountId, account.id));
  const leaving = new Set(
    (await db().select({ ref: schema.providerCleanups.ref }).from(schema.providerCleanups).where(eq(schema.providerCleanups.accountId, account.id))).map((r) => r.ref),
  );
  const known = new Map<string, string>();
  for (const d of ours) if (d.providerDraftId) known.set(d.providerDraftId, d.providerVersion ?? "");

  const result = await withAdapter(account, async (adapter) => {
    if (!adapter.listDrafts) return null;
    const listing = await adapter.listDrafts(known, PER_ROUND);
    const files = new Map<string, AttachmentContent[]>();
    for (const d of listing.changed) {
      const mine = ours.find((o) => o.providerDraftId === d.ref);
      // Only what's going to be taken: a new draft, or a change to one not edited here.
      if (leaving.has(d.ref) || (mine && (editedHere(mine) || mine.providerVersion === null))) continue;
      files.set(d.ref, await filesOf(adapter, d).catch((err) => (logWarn(`[${account.id}] draft attachments`, err), [])));
    }
    return { ...listing, files };
  });
  if (!result) return;

  // Copies we wrote without a UID coming back (IMAP without UIDPLUS), found by their Message-ID.
  for (const l of result.drafts) {
    const mine = l.messageIdHeader ? ours.find((o) => o.providerDraftId === `mid:${l.messageIdHeader}`) : undefined;
    if (!mine) continue;
    await db().update(schema.drafts).set({ providerDraftId: l.ref, providerVersion: l.version }).where(eq(schema.drafts.id, mine.id));
    mine.providerDraftId = l.ref;
    mine.providerVersion = l.version;
  }

  for (const d of result.changed) {
    if (leaving.has(d.ref)) continue;
    const mine = ours.find((o) => o.providerDraftId === d.ref);
    if (mine?.providerVersion === d.version || (mine && editedHere(mine))) continue;
    if (mine && mine.providerVersion === null) {
      // Mirrored before versions were kept: this is our own copy, so only remember its version.
      await db().update(schema.drafts).set({ providerVersion: d.version }).where(eq(schema.drafts.id, mine.id));
      continue;
    }
    const now = new Date();
    const fields = {
      to: list(d.to),
      cc: list(d.cc),
      bcc: list(d.bcc),
      subject: d.subject,
      html: draftToEditorHtml(d.html, d.text),
      providerDraftId: d.ref,
      providerVersion: d.version,
      updatedAt: now,
      providerSyncedAt: now,
    };
    let draftId: string;
    if (mine) {
      // Only if it wasn't edited here in the meantime.
      const [row] = await db()
        .update(schema.drafts)
        .set(fields)
        .where(and(eq(schema.drafts.id, mine.id), eq(schema.drafts.updatedAt, mine.updatedAt)))
        .returning({ id: schema.drafts.id });
      if (!row) continue;
      draftId = row.id;
    } else {
      const [row] = await db()
        .insert(schema.drafts)
        .values({ userId: account.userId, accountId: account.id, threadId: await threadOf(account, d), ...fields })
        .returning({ id: schema.drafts.id });
      draftId = row.id;
    }
    if (result.files.has(d.ref)) await saveFiles(account.userId, draftId, result.files.get(d.ref)!);
  }

  // Gone at the provider: sent or discarded in another client.
  const listed = new Set(result.drafts.map((l) => l.ref));
  const gone = ours.filter(
    (o) =>
      o.providerDraftId &&
      !o.providerDraftId.startsWith("mid:") &&
      o.providerVersion !== null &&
      !listed.has(o.providerDraftId) &&
      !editedHere(o) &&
      Date.now() - o.providerSyncedAt!.getTime() > GONE_GRACE_MS,
  );
  for (const o of gone) {
    // Edited here in the last moment: kept.
    const [removed] = await db()
      .delete(schema.drafts)
      .where(and(eq(schema.drafts.id, o.id), eq(schema.drafts.updatedAt, o.updatedAt)))
      .returning({ id: schema.drafts.id });
    if (removed) await db().delete(schema.draftAttachments).where(eq(schema.draftAttachments.draftId, removed.id));
  }
}

/** One round over every mailbox that can be reached. */
export async function importAllDrafts() {
  const accounts = await db().select(ACCOUNT_COLUMNS).from(schema.accounts).where(ne(schema.accounts.status, "auth_error"));
  for (const account of accounts) {
    await importDrafts(account).catch((err) => logWarn(`[${account.id}] importing drafts failed`, err));
  }
}
