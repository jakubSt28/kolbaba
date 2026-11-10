import { z } from "zod";
import { readJson } from "@/server/auth/http";
import { withUser } from "@/server/auth/session";
import { requestLocale } from "@/server/i18n";
import { inviteFor, respondToInvite } from "@/server/mail/invites";

type Ctx = { params: Promise<{ id: string }> };

/** The calendar invitation in a message: what, when, where, and whether it's been answered. */
export const GET = withUser<Ctx>(async (user, _req, ctx) => Response.json(await inviteFor(user.id, (await ctx.params).id)));

const Answer = z.object({ status: z.enum(["ACCEPTED", "TENTATIVE", "DECLINED"]) });

/** Accept, maybe or decline: an iTIP REPLY goes to the organizer. */
export const POST = withUser<Ctx>(async (user, req, ctx) => {
  const { status } = await readJson(req, Answer);
  return Response.json(await respondToInvite(user.id, (await ctx.params).id, status, requestLocale(req)));
});
