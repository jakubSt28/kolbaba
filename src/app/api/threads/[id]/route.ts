import { withUser } from "@/server/auth/session";
import { ThreadPatchBody } from "@/server/api/schemas";
import { parseBody } from "@/server/api/validate";
import { patchOneWithHistory, recordHistory, snapshotThreads } from "@/server/history";
import { deleteThreadForever, getThread } from "@/server/mail/service";

type Ctx = RouteContext<"/api/threads/[id]">;

export const GET = withUser<Ctx>(async (user, req, ctx) => {
  const { id } = await ctx.params;
  const images = new URL(req.url).searchParams.get("images");
  return Response.json(await getThread(user.id, id, images === "1" ? { allowRemoteImages: true } : {}));
});

export const PATCH = withUser<Ctx>(async (user, req, ctx) => {
  const { id } = await ctx.params;
  await patchOneWithHistory(user.id, id, await parseBody(req, ThreadPatchBody));
  return Response.json({ ok: true });
});

/** Delete for good (only from Trash or Spam). */
export const DELETE = withUser<Ctx>(async (user, _req, ctx) => {
  const { id } = await ctx.params;
  const before = await snapshotThreads(user.id, [id]);
  await deleteThreadForever(user.id, id);
  await recordHistory(user.id, { kind: "deleted_forever" }, before, { undoable: false });
  return Response.json({ ok: true });
});
