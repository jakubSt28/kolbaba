import { withUser } from "@/server/auth/session";
import { readChunk, startUpload } from "@/server/mail/outgoing-attachments";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Attach a file to a draft. The body is the file's first chunk (raw bytes, at most 3 MB); the rest
 * follows with PATCH …/attachments/[attachmentId]?offset=…. Name, type and full size travel in the query.
 */
export const POST = withUser<Ctx>(async (user, req, ctx) => {
  const { id } = await ctx.params;
  const q = new URL(req.url).searchParams;
  const chunk = await readChunk(req);
  const attachment = await startUpload(
    user.id,
    id,
    { name: q.get("name") ?? "", mime: q.get("mime") ?? "", size: Number(q.get("size")), inline: q.get("inline") === "1" },
    chunk,
  );
  return Response.json(attachment, { status: 201 });
});
