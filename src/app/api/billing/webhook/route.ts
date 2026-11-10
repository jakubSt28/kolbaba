import Stripe from "stripe";
import { handleWebhook } from "@/server/billing";
import { HttpError } from "@/server/http-error";
import { logWarn } from "@/server/log";

/**
 * Stripe's events about subscriptions (set up in Stripe as https://app.kolbaba.app/api/billing/webhook).
 * Checked by signature (STRIPE_WEBHOOK_SECRET) or by fetching the event from Stripe; anything that
 * doesn't check out is refused, anything we fail on Stripe retries.
 */
export async function POST(req: Request) {
  try {
    await handleWebhook(await req.text(), req.headers.get("stripe-signature"));
  } catch (err) {
    if (err instanceof Stripe.errors.StripeSignatureVerificationError || err instanceof SyntaxError) return new Response(null, { status: 400 });
    if (err instanceof HttpError && err.status === 400) return new Response(null, { status: 400 });
    if (err instanceof Stripe.errors.StripeInvalidRequestError && err.statusCode === 404) return new Response(null, { status: 400 });
    logWarn("[billing] webhook", err);
    return new Response(null, { status: 500 });
  }
  return new Response(null, { status: 204 });
}
