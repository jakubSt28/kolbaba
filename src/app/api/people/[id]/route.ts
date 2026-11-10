import { withUser } from "@/server/auth/session";
import { parseBody } from "@/server/api/validate";
import { getContact, hideContact, updateContact } from "@/server/contacts";
import { ContactBody } from "../schema";

type Ctx = { params: Promise<{ id: string }> };

/** One person: details, recent conversations, and what their signatures suggest. */
export const GET = withUser<Ctx>(async (user, _req, ctx) => Response.json(await getContact(user.id, (await ctx.params).id)));

export const PATCH = withUser<Ctx>(async (user, req, ctx) =>
  Response.json(await updateContact(user.id, (await ctx.params).id, await parseBody(req, ContactBody))),
);

/** Out of the address book (sent mail doesn't bring them back). */
export const DELETE = withUser<Ctx>(async (user, _req, ctx) => {
  await hideContact(user.id, (await ctx.params).id);
  return new Response(null, { status: 204 });
});
