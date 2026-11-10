import { z } from "zod";
import { withUser } from "@/server/auth/session";
import { parseBody } from "@/server/api/validate";
import { NOTE_MAX, setNote } from "@/server/mail/service";

type Ctx = RouteContext<"/api/threads/[id]/note">;

/** The user's private note on a conversation; an empty one removes it. */
export const PUT = withUser<Ctx>(async (user, req, ctx) => {
  const { id } = await ctx.params;
  const { note } = await parseBody(req, z.object({ note: z.string().max(NOTE_MAX * 2) }));
  return Response.json({ note: await setNote(user.id, id, note) });
});
