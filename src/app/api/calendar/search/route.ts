import { withUser } from "@/server/auth/session";
import { searchEvents } from "@/server/calendar/service";

/**
 * Events that match `q`, a year back and a year ahead. Without `deep` the answer comes at once from
 * the copy kept here; with it the providers are asked for that whole time first.
 */
export const GET = withUser(async (user, req) => {
  const params = new URL(req.url).searchParams;
  return Response.json({ events: await searchEvents(user.id, params.get("q") ?? "", { deep: params.get("deep") === "1" }) });
});
