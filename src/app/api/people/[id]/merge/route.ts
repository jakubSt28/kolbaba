import { z } from "zod";
import { withUser } from "@/server/auth/session";
import { parseBody } from "@/server/api/validate";
import { mergeContacts } from "@/server/contacts";

type Ctx = { params: Promise<{ id: string }> };

const Body = z.object({ from: z.string().min(1).max(64) });

/** Two entries for one person: `from` joins this one. */
export const POST = withUser<Ctx>(async (user, req, ctx) => {
  const { from } = await parseBody(req, Body);
  return Response.json(await mergeContacts(user.id, (await ctx.params).id, from));
});
