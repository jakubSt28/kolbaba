import { z } from "zod";
import { withUser } from "@/server/auth/session";
import { parseBody } from "@/server/api/validate";
import { syncCheckout } from "@/server/billing";
import { getPlus } from "@/server/plus";

const Body = z.object({ sessionId: z.string().min(1).max(200) });

/** Back from Checkout: Plus is on right away, without waiting for Stripe's webhook. */
export const POST = withUser(async (user, req) => {
  const { sessionId } = await parseBody(req, Body);
  await syncCheckout(user.id, sessionId);
  return Response.json({ plus: await getPlus(user.id) });
});
