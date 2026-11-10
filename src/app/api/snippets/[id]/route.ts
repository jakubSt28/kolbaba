import { readJson } from "@/server/auth/http";
import { withUser } from "@/server/auth/session";
import { deleteSnippet, SnippetBody, updateSnippet } from "@/server/mail/snippets";

type Ctx = { params: Promise<{ id: string }> };

export const PUT = withUser<Ctx>(async (user, req, ctx) => Response.json(await updateSnippet(user.id, (await ctx.params).id, await readJson(req, SnippetBody))));

export const DELETE = withUser<Ctx>(async (user, _req, ctx) => {
  await deleteSnippet(user.id, (await ctx.params).id);
  return Response.json({ ok: true });
});
