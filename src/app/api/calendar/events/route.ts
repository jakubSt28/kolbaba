import { readJson } from "@/server/auth/http";
import { withUser } from "@/server/auth/session";
import { EventBody, instant } from "@/server/calendar/schemas";
import { createEvent, listEvents } from "@/server/calendar/service";
import { HttpError } from "@/server/http-error";

/** Events of the ticked calendars between `from` and `to`, from the copy kept here (see ../sync for bringing it up to date). */
export const GET = withUser(async (user, req) => {
  const params = new URL(req.url).searchParams;
  const from = instant(params.get("from"));
  const to = instant(params.get("to"));
  if (!from || !to || to <= from) throw new HttpError(400, "Invalid request", "bad_request");
  return Response.json({ events: await listEvents(user.id, from, to) });
});

export const POST = withUser(async (user, req) => {
  const event = await createEvent(user.id, await readJson(req, EventBody));
  return Response.json({ event }, { status: 201 });
});
