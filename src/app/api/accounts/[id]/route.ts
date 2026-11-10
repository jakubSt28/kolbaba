import { z } from "zod";
import { NOTIFY_MODES } from "@/lib/types";
import { assertSameOrigin, readJson } from "@/server/auth/http";
import { withUser } from "@/server/auth/session";
import { removeAccount, updateAccount } from "@/server/mail/service";
import { nudgeWorker } from "@/server/worker-client";

type Ctx = RouteContext<"/api/accounts/[id]">;

const Patch = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  fromName: z.string().trim().max(120).optional(),
  hue: z.number().int().min(0).max(360).optional(),
  icon: z.string().max(40).optional(),
  signature: z.string().max(100_000).optional(),
  mcpEnabled: z.boolean().optional(),
  notify: z.enum(NOTIFY_MODES).optional(),
  sortOrder: z.number().int().optional(),
});

export const PATCH = withUser<Ctx>(async (user, req, ctx) => {
  assertSameOrigin(req);
  const { id } = await ctx.params;
  await updateAccount(user.id, id, await readJson(req, Patch));
  return Response.json({ ok: true });
});

/** Disconnect: forget the mailbox and its cached mail here. Nothing is deleted at the provider. */
export const DELETE = withUser<Ctx>(async (user, req, ctx) => {
  assertSameOrigin(req);
  const { id } = await ctx.params;
  await removeAccount(user.id, id);
  await nudgeWorker({ kind: "account-removed", accountId: id });
  return Response.json({ ok: true });
});
