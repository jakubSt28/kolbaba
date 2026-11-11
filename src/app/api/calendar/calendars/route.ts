import { readJson } from "@/server/auth/http";
import { withUser } from "@/server/auth/session";
import { CalendarBody } from "@/server/calendar/schemas";
import { createLocalCalendar } from "@/server/calendar/service";

/** A new calendar kept in Kolbaba itself. */
export const POST = withUser(async (user, req) => {
  const { name, hue } = await readJson(req, CalendarBody);
  return Response.json(await createLocalCalendar(user.id, name, hue), { status: 201 });
});
