import { readJson } from "@/server/auth/http";
import { withUser } from "@/server/auth/session";
import { EventPatch, ScopeParam } from "@/server/calendar/schemas";
import { deleteEvent, updateEvent } from "@/server/calendar/service";

type Ctx = { params: Promise<{ id: string }> };

/** Change an event; for a repeating one, `scope` says whether it's this occurrence or all of them. */
export const PATCH = withUser<Ctx>(async (user, req, ctx) => {
  const { event, scope } = await readJson(req, EventPatch);
  await updateEvent(user.id, (await ctx.params).id, event, scope);
  return Response.json({ ok: true });
});

export const DELETE = withUser<Ctx>(async (user, req, ctx) => {
  const scope = ScopeParam.catch("this").parse(new URL(req.url).searchParams.get("scope"));
  await deleteEvent(user.id, (await ctx.params).id, scope);
  return Response.json({ ok: true });
});
