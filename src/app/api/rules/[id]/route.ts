import { withUser } from "@/server/auth/session";
import { RuleBody } from "@/server/api/schemas";
import { parseBody } from "@/server/api/validate";
import { deleteRule, updateRule } from "@/server/mail/rules";

type Ctx = RouteContext<"/api/rules/[id]">;

export const PUT = withUser<Ctx>(async (user, req, ctx) => {
  const { id } = await ctx.params;
  return Response.json(await updateRule(user.id, id, await parseBody(req, RuleBody)));
});

export const DELETE = withUser<Ctx>(async (user, _req, ctx) => {
  const { id } = await ctx.params;
  await deleteRule(user.id, id);
  return Response.json({ ok: true });
});
