import { z } from "zod";
import { translate } from "@/lib/i18n";
import { withUser } from "@/server/auth/session";
import { parseBody } from "@/server/api/validate";
import { requestLocale } from "@/server/i18n";
import { cancelSend, outboxStatus, reschedule } from "@/server/mail/service";

type Ctx = RouteContext<"/api/outbox/[id]">;

export const GET = withUser<Ctx>(async (user, _req, ctx) => {
  const { id } = await ctx.params;
  const row = await outboxStatus(user.id, id);
  return Response.json({ ...row, sendAt: row.sendAt.getTime() });
});

/** Undo send / cancel a scheduled message: the draft comes back. 409 when it already left. */
export const DELETE = withUser<Ctx>(async (user, req, ctx) => {
  const { id } = await ctx.params;
  const draft = await cancelSend(user.id, id);
  if (!draft) return Response.json({ error: translate(requestLocale(req), "Too late — it's already sent") }, { status: 409 });
  return Response.json({ draft });
});

export const PATCH = withUser<Ctx>(async (user, req, ctx) => {
  const { id } = await ctx.params;
  const { sendAt } = await parseBody(req, z.object({ sendAt: z.number() }));
  await reschedule(user.id, id, new Date(sendAt));
  return Response.json({ ok: true });
});
