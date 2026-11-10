import { withUser } from "@/server/auth/session";
import { DraftBody } from "@/server/api/schemas";
import { parseBody } from "@/server/api/validate";
import { deleteDraft, saveDraft } from "@/server/mail/service";

type Ctx = RouteContext<"/api/drafts/[id]">;

export const PATCH = withUser<Ctx>(async (user, req, ctx) => {
  const { id } = await ctx.params;
  const body = await parseBody(req, DraftBody.omit({ id: true }));
  return Response.json(await saveDraft(user.id, { ...body, id }, { byUser: true }));
});

export const DELETE = withUser<Ctx>(async (user, _req, ctx) => {
  const { id } = await ctx.params;
  return Response.json({ draft: await deleteDraft(user.id, id) });
});
