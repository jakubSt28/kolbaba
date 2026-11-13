import { readJson } from "@/server/auth/http";
import { withUser } from "@/server/auth/session";
import { deleteTask, TaskPatchBody, updateTask } from "@/server/tasks";

type Ctx = { params: Promise<{ id: string }> };

/** Change a task: its text, day, priority or place; tick it off, move it to Trash or back. */
export const PATCH = withUser<Ctx>(async (user, req, ctx) => Response.json(await updateTask(user.id, (await ctx.params).id, await readJson(req, TaskPatchBody))));

/** Delete a task for good. */
export const DELETE = withUser<Ctx>(async (user, _req, ctx) => {
  await deleteTask(user.id, (await ctx.params).id);
  return Response.json({ ok: true });
});
