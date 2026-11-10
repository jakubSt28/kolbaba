import { z } from "zod";
import { readJson } from "@/server/auth/http";
import { withUser } from "@/server/auth/session";
import { forwardAttachments } from "@/server/mail/service";

type Ctx = { params: Promise<{ id: string }> };

const Body = z.object({ messageId: z.string().min(1).max(200) });

/** Forwarding: copy the forwarded email's files (and the pictures in its text) into the draft. */
export const POST = withUser<Ctx>(async (user, req, ctx) => {
  const { id } = await ctx.params;
  const { messageId } = await readJson(req, Body);
  return Response.json(await forwardAttachments(user.id, id, messageId));
});
