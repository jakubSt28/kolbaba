import { z } from "zod";
import { withUser } from "@/server/auth/session";
import { parseBody } from "@/server/api/validate";
import { checkoutUrl } from "@/server/billing";
import { requestLocale } from "@/server/i18n";

const Body = z.object({ interval: z.enum(["month", "year"]) });

/** Stripe Checkout for Kolbaba Plus: the app goes there and comes back to /?plus=thanks. */
export const POST = withUser(async (user, req) => {
  const { interval } = await parseBody(req, Body);
  return Response.json({ url: await checkoutUrl(user.id, interval, requestLocale(req)) });
});
