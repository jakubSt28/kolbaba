import { readJson } from "@/server/auth/http";
import { withUser } from "@/server/auth/session";
import { ImportBody, importTickTick } from "@/server/ticktick";

/** A TickTick backup (CSV): its tasks, lists and folders come over. */
export const POST = withUser(async (user, req) => {
  const { csv, tz } = await readJson(req, ImportBody);
  return Response.json(await importTickTick(user.id, csv, tz));
});
