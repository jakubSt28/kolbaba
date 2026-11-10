import { withUser } from "@/server/auth/session";
import { portalUrl } from "@/server/billing";

/** Stripe's page for the card, invoices and cancelling. */
export const POST = withUser(async (user) => Response.json({ url: await portalUrl(user.id) }));
