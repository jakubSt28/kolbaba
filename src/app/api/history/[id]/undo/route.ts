import { withUser } from "@/server/auth/session";
import { undoHistory } from "@/server/history";

type Ctx = { params: Promise<{ id: string }> };

/** Put the conversations back the way they were before that change. */
export const POST = withUser<Ctx>(async (user, _req, ctx) => Response.json(await undoHistory(user.id, (await ctx.params).id)));
