import { z } from "zod";
import { withUser } from "@/server/auth/session";
import { HttpError } from "@/server/http-error";
import { listFiles } from "@/server/mail/files";

const Query = z.object({
  scope: z.string().max(64).default("all"),
  kind: z.enum(["all", "image", "pdf", "doc", "sheet", "zip"]).default("all"),
  q: z.string().max(200).default(""),
  since: z.coerce.number().int().nonnegative().optional(),
  cursor: z.string().max(100).optional(),
});

/** Files: attachments across the mailboxes, filtered by kind, name or sender, and date. */
export const GET = withUser(async (user, req) => {
  const parsed = Query.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!parsed.success) throw new HttpError(400, "Invalid request", "bad_request");
  const params = parsed.data;
  return Response.json(await listFiles(user.id, { scope: params.scope, kind: params.kind, query: params.q, since: params.since, cursor: params.cursor }));
});
