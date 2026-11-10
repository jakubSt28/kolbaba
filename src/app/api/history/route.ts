import { withUser } from "@/server/auth/session";
import { listHistory } from "@/server/history";

/** My history, newest first; `?before=<id of the last line>` for the next page. */
export const GET = withUser(async (user, req) => {
  const before = new URL(req.url).searchParams.get("before")?.slice(0, 64) || undefined;
  return Response.json(await listHistory(user.id, { before }));
});
