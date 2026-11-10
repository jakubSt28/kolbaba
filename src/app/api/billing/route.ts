import { withUser } from "@/server/auth/session";
import { hasBilling, refreshFromStripe } from "@/server/billing";
import { logWarn } from "@/server/log";
import { getPlus } from "@/server/plus";

/** Kolbaba Plus for this user, and whether paying works yet. `?refresh=1` asks Stripe first (Settings opened). */
export const GET = withUser(async (user, req) => {
  if (new URL(req.url).searchParams.has("refresh")) await refreshFromStripe(user.id).catch((err) => logWarn("[billing] refresh", err));
  return Response.json({ plus: await getPlus(user.id), billing: hasBilling() }, { headers: { "Cache-Control": "private, no-store" } });
});
