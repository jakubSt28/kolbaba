import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { DraftAttachment } from "@/lib/types";
import { db, schema } from "../db";
import { HttpError } from "../http-error";

/** What one email may carry, all files together (Gmail's limit; most servers take as much). */
export const MAX_ATTACHMENTS_BYTES = 25 * 1024 * 1024;
/** One upload request; web functions take at most 4.5 MB. */
export const MAX_CHUNK_BYTES = 3 * 1024 * 1024;

/** A request body that is one chunk of a file. */
export async function readChunk(req: Request) {
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_CHUNK_BYTES) throw new HttpError(413, "Invalid request", "bad_request");
  const buf = Buffer.from(await req.arrayBuffer());
  if (buf.length > MAX_CHUNK_BYTES) throw new HttpError(413, "Invalid request", "bad_request");
  return buf;
}

const att = schema.draftAttachments;
type Row = typeof att.$inferSelect;

export const attachmentDto = (r: Pick<Row, "id" | "name" | "size" | "mime" | "inline">): DraftAttachment => ({
  id: r.id,
  name: r.name,
  size: r.size,
  mime: r.mime,
  ...(r.inline ? { inline: true } : {}),
});

/** Where the editor shows an uploaded image while writing; replaced by `cid:` when sending. */
export const previewUrl = (draftId: string, attachmentId: string) => `/api/drafts/${draftId}/attachments/${attachmentId}`;

async function ownedDraft(userId: string, draftId: string) {
  const [d] = await db()
    .select({ id: schema.drafts.id })
    .from(schema.drafts)
    .where(and(eq(schema.drafts.id, draftId), eq(schema.drafts.userId, userId)));
  if (!d) throw new HttpError(404, "Draft not found", "not_found");
}

const cleanName = (name: string) => name.replace(/[\u0000-\u001f\u007f/\\]/g, "").trim().slice(0, 200) || "attachment";
const cleanMime = (mime: string) => (/^[\w.+-]+\/[\w.+-]+$/.test(mime) ? mime.toLowerCase() : "application/octet-stream");

/** First chunk of a file (or the whole of a small one). */
export async function startUpload(
  userId: string,
  draftId: string,
  file: { name: string; mime: string; size: number; inline?: boolean },
  chunk: Buffer,
): Promise<DraftAttachment> {
  await ownedDraft(userId, draftId);
  if (!Number.isInteger(file.size) || file.size <= 0) throw new HttpError(400, "That file is empty", "empty_file");
  if (chunk.length > MAX_CHUNK_BYTES || chunk.length > file.size) throw new HttpError(400, "Invalid request", "bad_request");
  const total = await draftAttachmentBytes(userId, draftId);
  if (total + file.size > MAX_ATTACHMENTS_BYTES) {
    throw new HttpError(413, "Attachments can be at most {mb} MB per email.", "too_large", { mb: MAX_ATTACHMENTS_BYTES / 1024 / 1024 });
  }
  const mime = cleanMime(file.mime);
  const inline = !!file.inline && mime.startsWith("image/");
  const [row] = await db()
    .insert(att)
    .values({
      userId,
      draftId,
      name: cleanName(file.name),
      mime,
      size: file.size,
      received: chunk.length,
      inline,
      cid: inline ? `${randomUUID()}@kolbaba` : null,
      content: chunk,
    })
    .returning();
  return attachmentDto(row);
}

/** How much the draft's files take up so far, in bytes. */
export async function draftAttachmentBytes(userId: string, draftId: string) {
  const [{ total }] = await db()
    .select({ total: sql<number>`coalesce(sum(${att.size}), 0)::int` })
    .from(att)
    .where(and(eq(att.userId, userId), eq(att.draftId, draftId)));
  return total;
}

/** Whole files at once (forwarding copies the forwarded email's files). Pictures marked `inline` get a `cid:`. */
export async function addFiles(
  userId: string,
  draftId: string,
  files: { name: string; mime: string; content: Buffer; inline?: boolean }[],
): Promise<DraftAttachment[]> {
  if (!files.length) return [];
  const rows = await db()
    .insert(att)
    .values(
      files.map((f) => {
        const mime = cleanMime(f.mime);
        const inline = !!f.inline && mime.startsWith("image/");
        return {
          userId,
          draftId,
          name: cleanName(f.name),
          mime,
          size: f.content.length,
          received: f.content.length,
          inline,
          cid: inline ? `${randomUUID()}@kolbaba` : null,
          content: f.content,
        };
      }),
    )
    .returning();
  return rows.map(attachmentDto);
}

/** The next chunk; `offset` must be what's already there, so a retried request can't duplicate bytes. */
export async function appendChunk(userId: string, draftId: string, attachmentId: string, offset: number, chunk: Buffer) {
  if (chunk.length > MAX_CHUNK_BYTES) throw new HttpError(400, "Invalid request", "bad_request");
  const rows = await db()
    .update(att)
    .set({ content: sql`${att.content} || ${chunk}`, received: sql`${att.received} + ${chunk.length}` })
    .where(
      and(
        eq(att.id, attachmentId),
        eq(att.userId, userId),
        eq(att.draftId, draftId),
        eq(att.received, offset),
        sql`${att.received} + ${chunk.length} <= ${att.size}`,
      ),
    )
    .returning({ received: att.received, size: att.size });
  if (!rows.length) throw new HttpError(409, "The upload got out of step. Please attach the file again.", "upload_conflict");
  return rows[0];
}

export async function removeAttachment(userId: string, draftId: string, attachmentId: string) {
  await db().delete(att).where(and(eq(att.id, attachmentId), eq(att.userId, userId), eq(att.draftId, draftId)));
}

export async function getDraftAttachment(userId: string, draftId: string, attachmentId: string) {
  const [row] = await db()
    .select()
    .from(att)
    .where(and(eq(att.id, attachmentId), eq(att.userId, userId), eq(att.draftId, draftId)));
  if (!row) throw new HttpError(404, "Attachment not found", "not_found");
  return row;
}

/** Finished files per draft (for the drafts list and reopening a draft). */
export async function attachmentsByDraft(userId: string, draftIds: string[]) {
  const out = new Map<string, DraftAttachment[]>();
  if (!draftIds.length) return out;
  const rows = await db()
    .select({ id: att.id, draftId: att.draftId, name: att.name, size: att.size, mime: att.mime, inline: att.inline })
    .from(att)
    .where(and(eq(att.userId, userId), inArray(att.draftId, draftIds), sql`${att.received} = ${att.size}`));
  for (const r of rows) out.set(r.draftId!, [...(out.get(r.draftId!) ?? []), attachmentDto(r)]);
  return out;
}

/**
 * Queueing a send: the draft's finished files go with the outbox entry, editor previews of pasted
 * images become `cid:` references, and pasted images no longer in the text are dropped.
 */
export async function moveToOutbox(userId: string, draftId: string, outboxId: string, html: string): Promise<string> {
  const rows = await db()
    .select({ id: att.id, inline: att.inline, cid: att.cid, received: att.received, size: att.size })
    .from(att)
    .where(and(eq(att.userId, userId), eq(att.draftId, draftId)));
  let out = html;
  const keep: string[] = [];
  const drop: string[] = [];
  for (const r of rows) {
    if (r.received !== r.size) {
      drop.push(r.id);
      continue;
    }
    if (r.inline && r.cid) {
      const url = previewUrl(draftId, r.id);
      if (!out.includes(url)) {
        drop.push(r.id);
        continue;
      }
      out = out.split(url).join(`cid:${r.cid}`);
    }
    keep.push(r.id);
  }
  if (drop.length) await db().delete(att).where(inArray(att.id, drop));
  if (keep.length) await db().update(att).set({ draftId: null, outboxId }).where(inArray(att.id, keep));
  return out;
}

/** A draft's text and files as an email, without moving anything (for the provider's copy of the draft). */
export async function draftParts(userId: string, draftId: string, html: string) {
  const rows = await db().select().from(att).where(and(eq(att.userId, userId), eq(att.draftId, draftId), sql`${att.received} = ${att.size}`));
  let out = html;
  const files = [];
  for (const r of rows) {
    if (r.inline && r.cid) {
      const url = previewUrl(draftId, r.id);
      if (!out.includes(url)) continue;
      out = out.split(url).join(`cid:${r.cid}`);
    }
    files.push({ filename: r.name, content: r.content, contentType: r.mime, ...(r.inline && r.cid ? { cid: r.cid } : {}) });
  }
  return { html: out, attachments: files };
}

/** Undo send / cancelling a scheduled one: the files go back to the restored draft. */
export async function backToDraft(outboxId: string, draftId: string) {
  await db().update(att).set({ draftId, outboxId: null }).where(eq(att.outboxId, outboxId));
}

/** The files of an outbox entry, as the adapters want them. */
export async function outboxAttachments(outboxId: string) {
  const rows = await db().select().from(att).where(eq(att.outboxId, outboxId));
  return rows.map((r) => ({ filename: r.name, content: r.content, contentType: r.mime, ...(r.inline && r.cid ? { cid: r.cid } : {}) }));
}

/** Once the email is out, the files live at the provider; our copy goes. */
export async function deleteOutboxAttachments(outboxId: string) {
  await db().delete(att).where(eq(att.outboxId, outboxId));
}

/** Clean-up: files of drafts that are gone, and of outbox entries that no longer exist. */
export async function clearOrphanAttachments() {
  await db().execute(sql`
    delete from ${att} a
    where a.created_at < now() - interval '1 day'
      and ((a.draft_id is not null and not exists (select 1 from ${schema.drafts} d where d.id = a.draft_id))
        or (a.outbox_id is not null and not exists (select 1 from ${schema.outbox} o where o.id = a.outbox_id))
        or (a.draft_id is null and a.outbox_id is null))`);
}

