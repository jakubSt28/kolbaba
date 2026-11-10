import { assertSameOrigin } from "@/server/auth/http";
import { withUser } from "@/server/auth/session";
import { undoEvent } from "@/server/mcp/activity";

type Ctx = RouteContext<"/api/agents/events/[id]/undo">;

export const POST = withUser<Ctx>(async (user, req, ctx) => {
  assertSameOrigin(req);
  const { id } = await ctx.params;
  return Response.json(await undoEvent(user.id, id));
});
