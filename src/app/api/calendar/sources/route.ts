import { readJson } from "@/server/auth/http";
import { withUser } from "@/server/auth/session";
import { SourceBody } from "@/server/calendar/schemas";
import { addFeed, calendarBootstrap, connectCalDav } from "@/server/calendar/service";
import { limit, LIMITS } from "@/server/rate-limit";

// Finding a CalDAV server and reading its calendars for the first time can take a while.
export const maxDuration = 120;

/**
 * Add calendars: a CalDAV account (a mailbox's own, or another one with its password), or a link to
 * follow. Google and Microsoft go through their sign-in instead (/api/accounts/…/start?calendar=1).
 */
export const POST = withUser(async (user, req) => {
  const body = await readJson(req, SourceBody);
  // Each try signs in to someone's server with a password, or downloads a file: not something to hammer.
  await limit(LIMITS.calendarConnect(user.id));
  if (body.kind === "feed") await addFeed(user.id, body.url, body.name);
  else await connectCalDav(user.id, body);
  return Response.json(await calendarBootstrap(user.id), { status: 201 });
});
