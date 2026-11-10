import { z } from "zod";
import { assertSameOrigin, readJson } from "@/server/auth/http";
import { withUser } from "@/server/auth/session";
import { removeAgent, updateAgent } from "@/server/mcp/agents";

type Ctx = RouteContext<"/api/agents/[id]">;

const Patch = z
  .object({
    enabled: z.boolean().optional(),
    permission: z.enum(["read", "draft", "full"]).optional(),
    accountIds: z.array(z.string().max(64)).max(50).optional(),
  })
  .refine((p) => p.enabled !== undefined || p.permission !== undefined || p.accountIds !== undefined, "Nothing to change");

export const PATCH = withUser<Ctx>(async (user, req, ctx) => {
  assertSameOrigin(req);
  const { id } = await ctx.params;
  return Response.json(await updateAgent(user.id, id, await readJson(req, Patch)));
});

export const DELETE = withUser<Ctx>(async (user, req, ctx) => {
  assertSameOrigin(req);
  const { id } = await ctx.params;
  await removeAgent(user.id, id);
  return Response.json({ ok: true });
});
