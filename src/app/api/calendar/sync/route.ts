import { readJson } from "@/server/auth/http";
import { withUser } from "@/server/auth/session";
import { instant, SyncBody } from "@/server/calendar/schemas";
import { calendarBootstrap, calendarSettings, listEvents, saveCalendarSettings, syncRange, validZone } from "@/server/calendar/service";
import { HttpError } from "@/server/http-error";

// Several accounts are read from their providers in one go.
export const maxDuration = 120;

/**
 * Brings the days on screen up to date from the providers and returns them, with the accounts as
 * they now stand (one that needs connecting again says so).
 */
export const POST = withUser(async (user, req) => {
  const body = await readJson(req, SyncBody);
  const from = instant(body.from);
  const to = instant(body.to);
  if (!from || !to || to <= from || to.getTime() - from.getTime() > 400 * 86_400_000) throw new HttpError(400, "Invalid request", "bad_request");
  // The zone the app runs in: reminders and times written without a zone use it.
  const tz = validZone(body.tz);
  if (tz && (await calendarSettings(user.id)).timeZone !== tz) await saveCalendarSettings(user.id, { timeZone: tz });
  await syncRange(user.id, from, to, { force: body.force });
  const [events, state] = await Promise.all([listEvents(user.id, from, to), calendarBootstrap(user.id)]);
  return Response.json({ events, sources: state.sources, calendars: state.calendars });
});
