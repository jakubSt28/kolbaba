import { readJson } from "@/server/auth/http";
import { withUser } from "@/server/auth/session";
import { RespondBody } from "@/server/calendar/schemas";
import { respondToEvent } from "@/server/calendar/service";

type Ctx = { params: Promise<{ id: string }> };

/** Answer an invitation (yes, maybe, no); the organizer hears about it from the calendar's provider, or by email from here. */
export const POST = withUser<Ctx>(async (user, req, ctx) => {
  const { status, scope } = await readJson(req, RespondBody);
  await respondToEvent(user.id, (await ctx.params).id, status, scope);
  return Response.json({ ok: true });
});
