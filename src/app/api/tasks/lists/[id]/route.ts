import { readJson } from "@/server/auth/http";
import { withUser } from "@/server/auth/session";
import { deleteTaskList, ListPatchBody, updateTaskList } from "@/server/tasks";

type Ctx = { params: Promise<{ id: string }> };

/** Rename a list or folder, give it an emoji, move it into a folder or to another place. */
export const PATCH = withUser<Ctx>(async (user, req, ctx) => Response.json(await updateTaskList(user.id, (await ctx.params).id, await readJson(req, ListPatchBody))));

/** Delete a list (its tasks go to Trash), or take a folder apart (its lists stay). */
export const DELETE = withUser<Ctx>(async (user, _req, ctx) => {
  await deleteTaskList(user.id, (await ctx.params).id);
  return Response.json({ ok: true });
});
