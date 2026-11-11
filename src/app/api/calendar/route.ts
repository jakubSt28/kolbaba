import { after } from "next/server";
import { withUser } from "@/server/auth/session";
import { calendarBootstrap, refreshStaleLists } from "@/server/calendar/service";
import { logWarn } from "@/server/log";

/** What the calendar needs to open: accounts, calendars, settings, and which mailboxes could add theirs. */
export const GET = withUser(async (user) => {
  // A calendar made at the provider since last time shows up on the next open.
  after(() => refreshStaleLists(user.id).catch((err) => logWarn("[calendar] lists", err)));
  return Response.json(await calendarBootstrap(user.id));
});
