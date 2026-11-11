import { readJson } from "@/server/auth/http";
import { withUser } from "@/server/auth/session";
import { SettingsBody } from "@/server/calendar/schemas";
import { calendarSettings, saveCalendarSettings, validZone } from "@/server/calendar/service";

/** The calendar's own settings: the view it opens in, reminders, mailboxes not to offer again. */
export const PATCH = withUser(async (user, req) => {
  const { seen, timeZone, ...patch } = await readJson(req, SettingsBody);
  const current = await calendarSettings(user.id);
  await saveCalendarSettings(user.id, {
    ...patch,
    ...(validZone(timeZone) ? { timeZone } : {}),
    // The first time only: the admin overview reads it as "has opened the calendar".
    ...(seen && !current.seenAt ? { seenAt: Date.now() } : {}),
  });
  return Response.json({ ok: true });
});
