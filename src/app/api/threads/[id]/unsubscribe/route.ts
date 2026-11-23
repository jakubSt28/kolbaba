import { withUser } from "@/server/auth/session";
import { unsubscribe } from "@/server/mail/unsubscribe";

type Ctx = { params: Promise<{ id: string }> };

/** Leave the mailing list this conversation came from (one-click POST or the list's unsubscribe email). */
export const POST = withUser<Ctx>(async (user, _req, ctx) => {
  const { id } = await ctx.params;
  return Response.json(await unsubscribe(user.id, id));
});
