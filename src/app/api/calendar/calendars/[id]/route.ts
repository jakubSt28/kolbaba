import { readJson } from "@/server/auth/http";
import { withUser } from "@/server/auth/session";
import { CalendarPatch } from "@/server/calendar/schemas";
import { deleteCalendar, updateCalendar } from "@/server/calendar/service";

type Ctx = { params: Promise<{ id: string }> };

/** Tick or untick a calendar, recolour it, rename one of Kolbaba's own. */
export const PATCH = withUser<Ctx>(async (user, req, ctx) => Response.json(await updateCalendar(user.id, (await ctx.params).id, await readJson(req, CalendarPatch))));

/** Delete one of Kolbaba's own calendars, or stop following a link. */
export const DELETE = withUser<Ctx>(async (user, _req, ctx) => {
  await deleteCalendar(user.id, (await ctx.params).id);
  return Response.json({ ok: true });
});
