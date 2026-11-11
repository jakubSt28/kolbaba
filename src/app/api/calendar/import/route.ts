import { readJson } from "@/server/auth/http";
import { withUser } from "@/server/auth/session";
import { ImportBody } from "@/server/calendar/schemas";
import { importIcs } from "@/server/calendar/service";

/** Events from an .ics file go into one of Kolbaba's own calendars (a new one unless one is named). */
export const POST = withUser(async (user, req) => Response.json(await importIcs(user.id, await readJson(req, ImportBody)), { status: 201 }));
