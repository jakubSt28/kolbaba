import { z } from "zod";
import { withUser } from "@/server/auth/session";
import { parseBody } from "@/server/api/validate";
import { cleanUpSender } from "@/server/mail/screener-actions";

/** Moving hundreds of conversations goes one at a time through the provider. */
export const maxDuration = 300;

/** After unsubscribing: everything still here from that sender to Archive (from Inbox) or to Trash. */
export const POST = withUser(async (user, req) => {
  const { email, to } = await parseBody(req, z.object({ email: z.email().max(320), to: z.enum(["archive", "trash"]) }));
  return Response.json(await cleanUpSender(user.id, email, to));
});
