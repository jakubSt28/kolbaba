import { revokeSession } from "@/server/auth/devices";
import { currentSessionId, withUser } from "@/server/auth/session";

/** Sign one other device out. */
export const DELETE = withUser<{ params: Promise<{ id: string }> }>(async (user, _req, ctx) => {
  await revokeSession(user.id, (await ctx.params).id, await currentSessionId());
  return Response.json({ ok: true });
});
