import { z } from "zod";
import { readJson } from "@/server/auth/http";
import { withUser } from "@/server/auth/session";
import { blockSender, decideSender, forgetSender, listSenders } from "@/server/mail/screener-actions";

/**
 * Who may reach Inbox. GET lists blocked senders (Settings), POST decides (the screener's yes or no,
 * or `block` from any email: to Trash, optionally the whole domain), DELETE unblocks.
 */
export const GET = withUser(async (user) => Response.json({ blocked: await listSenders(user.id, "blocked") }));

const Decision = z.union([
  z.object({
    email: z.email().max(320),
    name: z.string().max(200).optional(),
    status: z.enum(["allowed", "blocked"]),
  }),
  z.object({
    email: z.email().max(320),
    name: z.string().max(200).optional(),
    block: z.enum(["address", "domain"]),
  }),
]);

export const POST = withUser(async (user, req) => {
  const body = await readJson(req, Decision);
  if ("block" in body) return Response.json(await blockSender(user.id, body, { domain: body.block === "domain" }));
  return Response.json(await decideSender(user.id, body, body.status));
});

export const DELETE = withUser(async (user, req) => {
  const { email } = await readJson(req, z.object({ email: z.string().max(320) }));
  await forgetSender(user.id, email);
  return Response.json({ ok: true });
});
