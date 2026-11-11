import { withUser } from "@/server/auth/session";
import { calendarBootstrap, removeSource } from "@/server/calendar/service";

type Ctx = { params: Promise<{ id: string }> };

/** Disconnect a calendar account: its calendars leave Kolbaba, nothing changes at the provider. */
export const DELETE = withUser<Ctx>(async (user, _req, ctx) => {
  await removeSource(user.id, (await ctx.params).id);
  return Response.json(await calendarBootstrap(user.id));
});
