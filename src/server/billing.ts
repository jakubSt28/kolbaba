import Stripe from "stripe";
import { eq } from "drizzle-orm";
import type { Locale } from "@/lib/i18n";
import { legalUrl } from "@/lib/legal";
import { PLUS_PRICES, type PlusInterval } from "@/lib/plus";
import { db, schema } from "./db";
import { env } from "./env";
import { HttpError } from "./http-error";
import { logWarn } from "./log";
import { alertOperator } from "./ops-alert";
import { getPlus } from "./plus";

/**
 * Paying for Kolbaba Plus, through Stripe: Checkout to subscribe, the customer portal to change the
 * card, see invoices or cancel, and a webhook that mirrors the subscription onto the user
 * (src/lib/plus.ts reads it). The product and its two prices are made on the first checkout (found by
 * lookup key after that), so Stripe needs no setting up by hand beyond the key and the webhook.
 *
 * The Stripe account may sell other things too: Checkout, the card statement ("KOLBABA.APP") and the
 * portal say Kolbaba on their own, whatever the account's name and default settings are.
 */

export const hasBilling = () => !!env.stripeSecretKey;

let client: Stripe | null = null;
const stripe = () => {
  if (!env.stripeSecretKey) throw new HttpError(503, "Payments aren't available yet.", "billing_unavailable");
  return (client ??= new Stripe(env.stripeSecretKey, { maxNetworkRetries: 2, timeout: 20_000 }));
};

const PRODUCT_ID = "kolbaba_plus";
const LOOKUP: Record<PlusInterval, string> = { month: "kolbaba_plus_month", year: "kolbaba_plus_year" };
const prices = new Map<PlusInterval, string>();

async function priceId(interval: PlusInterval): Promise<string> {
  const known = prices.get(interval);
  if (known) return known;
  const find = async () => (await stripe().prices.list({ lookup_keys: [LOOKUP[interval]], active: true, limit: 1 })).data[0]?.id;
  let id = await find();
  if (!id) {
    await stripe()
      .products.retrieve(PRODUCT_ID)
      .catch(() =>
        stripe().products.create({
          id: PRODUCT_ID,
          name: "Kolbaba Plus",
          description: "Smart categories, Awaiting my reply and summaries",
          url: "https://kolbaba.app",
          // What the card statement says for the subscription's payments.
          statement_descriptor: "KOLBABA.APP",
        }),
      );
    id = await stripe()
      .prices.create({
        product: PRODUCT_ID,
        currency: "czk",
        unit_amount: PLUS_PRICES[interval] * 100,
        recurring: { interval },
        lookup_key: LOOKUP[interval],
        tax_behavior: "inclusive",
      })
      .then((p) => p.id)
      // Two first checkouts at once: the other one made it.
      .catch(async (err) => (await find()) ?? Promise.reject(err));
  }
  prices.set(interval, id);
  return id;
}

async function customerId(userId: string): Promise<string> {
  const [user] = await db()
    .select({ email: schema.users.email, name: schema.users.name, customer: schema.users.stripeCustomerId })
    .from(schema.users)
    .where(eq(schema.users.id, userId));
  if (!user) throw new HttpError(404, "Not found", "not_found");
  if (user.customer) return user.customer;
  const customer = await stripe().customers.create({ email: user.email, name: user.name || undefined, metadata: { userId } });
  await db().update(schema.users).set({ stripeCustomerId: customer.id }).where(eq(schema.users.id, userId));
  return customer.id;
}

/**
 * Stripe Checkout for Plus. Subscribing during the trial charges when the trial ends, not now. Someone
 * who already pays gets the portal instead of a second subscription.
 */
export async function checkoutUrl(userId: string, interval: PlusInterval, locale: Locale): Promise<string> {
  const plus = await getPlus(userId);
  if (plus.source === "subscription") return portalUrl(userId);
  const [customer, price] = await Promise.all([customerId(userId), priceId(interval)]);
  // Stripe wants a trial end at least two days away; closer than that, the first charge is today.
  const trialEnd = plus.level === "trial" && plus.trialEndsAt && plus.trialEndsAt - Date.now() > 50 * 3600_000 ? Math.floor(plus.trialEndsAt / 1000) : undefined;
  const cs = locale === "cs";
  const params: Stripe.Checkout.SessionCreateParams = {
    mode: "subscription",
    customer,
    client_reference_id: userId,
    line_items: [{ price, quantity: 1 }],
    allow_promotion_codes: true,
    locale: cs ? "cs" : "en",
    // Stripe wants the icon's address to end in .png.
    branding_settings: { display_name: "Kolbaba", icon: { type: "url", url: `${env.appUrl}/kolbaba-icon.png` } },
    customer_update: { name: "auto", address: "auto" },
    subscription_data: { description: "Kolbaba Plus", metadata: { userId }, ...(trialEnd ? { trial_end: trialEnd } : {}) },
    // A required checkbox: the Terms, and the consumer's express request to start Plus now. Without that
    // request, withdrawing within 14 days would owe nothing for the days with Plus (§ 1823 and § 1834 OZ).
    consent_collection: { terms_of_service: "required" },
    custom_text: {
      submit: {
        message: cs
          ? "Předplatné můžeš kdykoli zrušit v Nastavení Kolbaby. Platí pak do konce zaplaceného období."
          : "You can cancel any time in Kolbaba's Settings. It then lasts until the end of the period you paid for.",
      },
      terms_of_service_acceptance: {
        message: cs
          ? `Souhlasím s [Podmínkami použití](${legalUrl("cs", "terms")}) a žádám, aby Plus začalo hned. Když do 14 dnů odstoupím, Kolbaba mi vrátí zaplacené peníze kromě poměrné části za dny s Plus.`
          : `I agree to the [Terms of Service](${legalUrl("en", "terms")}) and ask for Plus to start right away. If I withdraw within 14 days, Kolbaba refunds what I paid, minus a fair share for the days I had Plus.`,
      },
    },
    success_url: `${env.appUrl}/?plus=thanks&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${env.appUrl}/?plus=back`,
  };
  const session = await stripe()
    .checkout.sessions.create(params)
    .catch((err) => {
      // Stripe shows the checkbox only once the account has a Terms URL (Dashboard → Settings → Public
      // details). Until then people can still subscribe, without it, and the operator hears.
      if (!(err instanceof Stripe.errors.StripeInvalidRequestError) || !/terms of service/i.test(err.message)) throw err;
      void alertOperator("stripe-terms-url", "Stripe Checkout runs without the Terms checkbox", [
        "Stripe refused the Terms checkbox in Checkout because the Kolbaba account has no Terms of Service URL.",
        "Set it in the Stripe Dashboard → Settings → Public details: https://kolbaba.app/terms",
        `Stripe said: ${err.message}`,
      ]);
      return stripe().checkout.sessions.create({ ...params, consent_collection: undefined, custom_text: { submit: params.custom_text?.submit } });
    });
  if (!session.url) throw new HttpError(502, "Payments aren't available right now. Try again in a moment.", "billing_failed");
  return session.url;
}

let portalConfiguration: string | null = null;

/** Kolbaba's own portal settings (its terms, cancelling at the period's end), never the account's default. Made once, found by metadata after. */
async function portalConfigurationId(): Promise<string> {
  if (portalConfiguration) return portalConfiguration;
  const existing = await stripe().billingPortal.configurations.list({ active: true, limit: 100 });
  const ours = existing.data.find((c) => c.metadata?.app === "kolbaba");
  const config =
    ours ??
    (await stripe().billingPortal.configurations.create({
      name: "Kolbaba Plus",
      metadata: { app: "kolbaba" },
      default_return_url: `${env.appUrl}/?plus=back`,
      business_profile: { headline: "Kolbaba Plus", privacy_policy_url: "https://kolbaba.app/privacy", terms_of_service_url: "https://kolbaba.app/terms" },
      features: {
        invoice_history: { enabled: true },
        payment_method_update: { enabled: true },
        customer_update: { enabled: true, allowed_updates: ["email", "name", "address", "tax_id"] },
        subscription_cancel: { enabled: true, mode: "at_period_end", cancellation_reason: { enabled: true, options: ["too_expensive", "unused", "missing_features", "other"] } },
      },
    }));
  portalConfiguration = config.id;
  return config.id;
}

/** Stripe's page for the card, invoices and cancelling (at the end of the paid period). */
export async function portalUrl(userId: string): Promise<string> {
  const [customer, configuration] = await Promise.all([customerId(userId), portalConfigurationId()]);
  const session = await stripe().billingPortal.sessions.create({ customer, configuration, return_url: `${env.appUrl}/?plus=back` });
  return session.url;
}

/** The subscription mirrored onto its user. A cancelled old subscription doesn't overwrite a newer live one. */
export async function syncSubscription(sub: Stripe.Subscription) {
  const customer = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  const [user] = await db()
    .select({ id: schema.users.id, current: schema.users.stripeSubscriptionId, status: schema.users.subscriptionStatus })
    .from(schema.users)
    .where(eq(schema.users.stripeCustomerId, customer));
  if (!user) {
    logWarn("[billing] subscription for an unknown customer", new Error(`${sub.id} ${customer}`));
    return;
  }
  const live = (s: string | null) => s === "active" || s === "trialing" || s === "past_due";
  if (user.current && user.current !== sub.id && live(user.status) && !live(sub.status)) return;
  const item = sub.items.data[0];
  await db()
    .update(schema.users)
    .set({
      stripeSubscriptionId: sub.id,
      subscriptionStatus: sub.status,
      subscriptionInterval: item?.price.recurring?.interval === "year" ? "year" : "month",
      subscriptionPeriodEnd: sub.cancel_at ? new Date(sub.cancel_at * 1000) : item ? new Date(item.current_period_end * 1000) : null,
      subscriptionCancelsAtEnd: sub.cancel_at_period_end || !!sub.cancel_at,
    })
    .where(eq(schema.users.id, user.id));
}

/** Back from Checkout: take the subscription now instead of waiting for the webhook. */
export async function syncCheckout(userId: string, sessionId: string) {
  const session = await stripe().checkout.sessions.retrieve(sessionId, { expand: ["subscription"] });
  if (session.client_reference_id !== userId) throw new HttpError(404, "Not found", "not_found");
  if (session.subscription && typeof session.subscription !== "string") await syncSubscription(session.subscription);
}

/** Ask Stripe again (Settings opened): fixes anything a missed webhook left behind. */
export async function refreshFromStripe(userId: string) {
  if (!hasBilling()) return;
  const [user] = await db().select({ customer: schema.users.stripeCustomerId }).from(schema.users).where(eq(schema.users.id, userId));
  if (!user?.customer) return;
  const subs = await stripe().subscriptions.list({ customer: user.customer, status: "all", limit: 5 });
  const rank = (s: Stripe.Subscription) => (s.status === "active" ? 3 : s.status === "trialing" ? 2 : s.status === "past_due" ? 1 : 0);
  const best = [...subs.data].sort((a, b) => rank(b) - rank(a) || b.created - a.created)[0];
  if (best) await syncSubscription(best);
}

/**
 * A webhook from Stripe: the events that change a subscription. With STRIPE_WEBHOOK_SECRET the
 * signature proves it's from Stripe; without it, the event is fetched from Stripe by its id instead,
 * so nothing sent to the endpoint by anyone else is ever believed (an unknown id is just a 404).
 */
export async function handleWebhook(body: string, signature: string | null) {
  let event: Stripe.Event;
  if (env.stripeWebhookSecret) {
    if (!signature) throw new HttpError(400, "Invalid request", "bad_request");
    event = stripe().webhooks.constructEvent(body, signature, env.stripeWebhookSecret);
  } else {
    const id = (JSON.parse(body) as { id?: unknown }).id;
    if (typeof id !== "string" || !id.startsWith("evt_")) throw new HttpError(400, "Invalid request", "bad_request");
    event = await stripe().events.retrieve(id);
  }
  switch (event.type) {
    case "checkout.session.completed": {
      const sub = event.data.object.subscription;
      if (sub) await syncSubscription(typeof sub === "string" ? await stripe().subscriptions.retrieve(sub) : sub);
      break;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
    case "customer.subscription.paused":
    case "customer.subscription.resumed":
      // Asked again rather than read from the event: the latest state, in the API version this code knows.
      await syncSubscription(await stripe().subscriptions.retrieve(event.data.object.id));
      break;
  }
}

/** Deleting the account ends the subscription now: nobody pays for an account that's gone. If Stripe says no, the account stays. */
export async function cancelOnAccountDelete(userId: string) {
  const [user] = await db().select({ sub: schema.users.stripeSubscriptionId, status: schema.users.subscriptionStatus }).from(schema.users).where(eq(schema.users.id, userId));
  if (!user?.sub || !hasBilling() || user.status === "canceled" || user.status === "incomplete_expired") return;
  await stripe()
    .subscriptions.cancel(user.sub)
    .catch((err) => {
      if (err instanceof Stripe.errors.StripeInvalidRequestError && err.code === "resource_missing") return;
      logWarn(`[billing] cancel ${user.sub} on account delete`, err);
      throw new HttpError(502, "We couldn't cancel your subscription. Try again in a moment.", "billing_failed");
    });
}
