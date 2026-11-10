import { opensInBrowser } from "@/lib/attachment-inline";
import { withUser } from "@/server/auth/session";
import { HttpError } from "@/server/http-error";
import { appendChunk, getDraftAttachment, readChunk, removeAttachment } from "@/server/mail/outgoing-attachments";

type Ctx = { params: Promise<{ id: string; attachmentId: string }> };

/** The next chunk of an upload, at `?offset=` (bytes already there). */
export const PATCH = withUser<Ctx>(async (user, req, ctx) => {
  const { id, attachmentId } = await ctx.params;
  const offset = Number(new URL(req.url).searchParams.get("offset"));
  if (!Number.isInteger(offset) || offset < 0) throw new HttpError(400, "Invalid request", "bad_request");
  return Response.json(await appendChunk(user.id, id, attachmentId, offset, await readChunk(req)));
});

export const DELETE = withUser<Ctx>(async (user, _req, ctx) => {
  const { id, attachmentId } = await ctx.params;
  await removeAttachment(user.id, id, attachmentId);
  return Response.json({ ok: true });
});

/** The editor's preview of a pasted image (and a way to open any attached file before sending). */
export const GET = withUser<Ctx>(async (user, _req, ctx) => {
  const { id, attachmentId } = await ctx.params;
  const row = await getDraftAttachment(user.id, id, attachmentId);
  const inline = opensInBrowser(row.mime);
  return new Response(new Uint8Array(row.content), {
    headers: {
      "content-type": inline ? row.mime : "application/octet-stream",
      "content-disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(row.name)}`,
      "cache-control": "private, max-age=3600",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; sandbox",
    },
  });
});
