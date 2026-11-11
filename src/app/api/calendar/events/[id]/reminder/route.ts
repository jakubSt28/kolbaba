import { readJson } from "@/server/auth/http";
import { withUser } from "@/server/auth/session";
import { ReminderBody } from "@/server/calendar/schemas";
import { setEventReminder } from "@/server/calendar/service";

type Ctx = { params: Promise<{ id: string }> };

/** Give one event (or its whole series) a reminder time of its own, or none. */
export const PUT = withUser<Ctx>(async (user, req, ctx) => {
  const { minutes, scope } = await readJson(req, ReminderBody);
  await setEventReminder(user.id, (await ctx.params).id, minutes, scope);
  return Response.json({ ok: true });
});
