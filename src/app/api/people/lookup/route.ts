import { z } from "zod";
import { withUser } from "@/server/auth/session";
import { parseBody } from "@/server/api/validate";
import { contactFor } from "@/server/contacts";

const Body = z.object({ email: z.string().min(3).max(320), name: z.string().max(200).default("") });

/** The contact behind an address in an email (made now if there isn't one). */
export const POST = withUser(async (user, req) => {
  const { email, name } = await parseBody(req, Body);
  return Response.json(await contactFor(user.id, email, name));
});
