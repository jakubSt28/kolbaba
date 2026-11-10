import { z } from "zod";
import { isAdmin, setPlusGift } from "@/server/admin";
import { parseBody } from "@/server/api/validate";
import { withUser } from "@/server/auth/session";
import { HttpError } from "@/server/http-error";

const Body = z.object({ gift: z.boolean() });

/** The operator gives someone Kolbaba Plus for free (or takes it back). Admins only, like /admin. */
export const POST = withUser<{ params: Promise<{ id: string }> }>(async (user, req, ctx) => {
  if (!isAdmin(user.email)) throw new HttpError(404, "Not found", "not_found");
  const { gift } = await parseBody(req, Body);
  await setPlusGift((await ctx.params).id, gift);
  return Response.json({ ok: true });
});
