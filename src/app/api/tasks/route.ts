import { readJson } from "@/server/auth/http";
import { withUser } from "@/server/auth/session";
import { createTask, listTasks, TaskBody } from "@/server/tasks";

/** Every open task and Trash with the latest completed ones; `?completedBefore=<ms>` pages back through older completed ones. */
export const GET = withUser(async (user, req) => {
  const before = Number(new URL(req.url).searchParams.get("completedBefore"));
  return Response.json(await listTasks(user.id, Number.isFinite(before) && before > 0 ? before : undefined));
});

export const POST = withUser(async (user, req) => Response.json(await createTask(user.id, await readJson(req, TaskBody)), { status: 201 }));
