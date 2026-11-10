/**
 * Server configuration, read lazily so `next build` and the mock prototype work without any secrets.
 * Every variable is documented in `.env.example`.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name} (see .env.example)`);
  return value;
}

function optional(name: string): string | undefined {
  return process.env[name] || undefined;
}

export const env = {
  /**
   * Someone runs this copy on their own server (selfhost/README.md): nobody pays, new accounts come only
   * from a setup link, and nothing goes to the people who make Kolbaba.
   */
  get selfHosted() {
    return process.env.SELF_HOSTED === "1";
  },
  /** "mock" keeps the clickable prototype on fake data; "live" talks to the real backend. */
  get dataMode() {
    return process.env.NEXT_PUBLIC_DATA_MODE === "live" ? "live" : "mock";
  },
  get databaseUrl() {
    return required("DATABASE_URL");
  },
  /** Public origin of the web app, e.g. https://mail.example.com — used for OAuth redirects, pixels and MCP. */
  get appUrl() {
    return (optional("APP_URL") ?? "http://localhost:3000").replace(/\/$/, "");
  },
  /** Base64 32-byte key encryption keys, "v1:<key>,v2:<key>"; the last one encrypts, all of them decrypt. */
  get kekRing() {
    return required("CREDENTIALS_KEK");
  },
  get sessionSecret() {
    return required("SESSION_SECRET");
  },
  /** Google sign-in and the Gmail API are set up. A self-hosted copy usually goes without them. */
  get hasGoogle() {
    return !!optional("GOOGLE_CLIENT_ID") && !!optional("GOOGLE_CLIENT_SECRET");
  },
  get googleClientId() {
    return required("GOOGLE_CLIENT_ID");
  },
  get googleClientSecret() {
    return required("GOOGLE_CLIENT_SECRET");
  },
  /** Microsoft sign-in for Outlook and Microsoft 365 mailboxes (src/server/microsoft.ts). Without them, Outlook stays "coming soon". */
  get microsoftClientId() {
    return required("MICROSOFT_CLIENT_ID");
  },
  get microsoftClientSecret() {
    return required("MICROSOFT_CLIENT_SECRET");
  },
  get googlePubsubTopic() {
    return optional("GOOGLE_PUBSUB_TOPIC");
  },
  /** Shared secret in the Pub/Sub push subscription URL (?token=…). Unset once push is authenticated (below). */
  get googlePubsubToken() {
    return optional("GOOGLE_PUBSUB_VERIFICATION_TOKEN");
  },
  /** Authenticated push: the service account Pub/Sub signs its requests as (src/server/mail/pubsub-auth.ts). */
  get googlePubsubServiceAccount() {
    return optional("GOOGLE_PUBSUB_SERVICE_ACCOUNT");
  },
  /** The audience those requests are signed for: the push endpoint itself unless set otherwise. */
  get googlePubsubAudience() {
    return optional("GOOGLE_PUBSUB_AUDIENCE") || `${this.appUrl}/api/webhooks/gmail`;
  },
  get vapidPublicKey() {
    return optional("NEXT_PUBLIC_VAPID_PUBLIC_KEY");
  },
  get vapidPrivateKey() {
    return optional("VAPID_PRIVATE_KEY");
  },
  get vapidSubject() {
    return optional("VAPID_SUBJECT") ?? "mailto:admin@example.com";
  },
  /** Lets the web app nudge the worker (new send queued, account added). */
  get workerUrl() {
    return optional("WORKER_URL");
  },
  /** Smart categories (order, travel, invoice and subscription emails). Without it they stay off. */
  get openaiApiKey() {
    return required("OPENAI_API_KEY");
  },
  get hasOpenAI() {
    return !!optional("OPENAI_API_KEY");
  },
  get insightsModel() {
    return optional("INSIGHTS_MODEL") ?? "gpt-6-luna";
  },
  /** How hard the model thinks before filling in a card: "low" (default) or "none". */
  get insightsReasoning(): "low" | "none" {
    return optional("INSIGHTS_REASONING") === "none" ? "none" : "low";
  },
  /** TypeSafe's Jev sorts mail before OpenAI reads it (insights/jev.ts). Without a key, rules do. */
  get typesafeApiKey() {
    return optional("TYPESAFE_API_KEY");
  },
  get jevModel() {
    return optional("JEV_MODEL") ?? "jev-latest";
  },
  /** Stripe for Kolbaba Plus (src/server/billing.ts). Without it the trial and gifts still work; paying doesn't. */
  get stripeSecretKey() {
    return optional("STRIPE_SECRET_KEY");
  },
  /** Signing secret of the webhook endpoint /api/billing/webhook in Stripe. Optional: without it events are fetched from Stripe. */
  get stripeWebhookSecret() {
    return optional("STRIPE_WEBHOOK_SECRET");
  },
  get workerSecret() {
    return optional("WORKER_SECRET");
  },
  /** Resend key for the app's own emails (sign-up codes, feedback). Without it, codes are only logged in development. */
  get resendApiKey() {
    return optional("RESEND_API_KEY");
  },
  /** Self-hosted instead of Resend: an SMTP server for those emails, e.g. smtps://user:password@smtp.example.com:465. */
  get smtpUrl() {
    return optional("SMTP_URL");
  },
  /** The app can send its own emails (sign-in codes). */
  get canSendMail() {
    return !!this.resendApiKey || !!this.smtpUrl;
  },
  /** Sender of those emails, e.g. "Kolbaba <noreply@kolbaba.app>". */
  get mailFrom() {
    return optional("MAIL_FROM") ?? "Kolbaba <noreply@kolbaba.app>";
  },
  /** Where feedback, feature requests and operator alerts are sent. A self-hosted copy has no default: nothing goes to us. */
  get feedbackTo() {
    return optional("FEEDBACK_TO") ?? (this.selfHosted ? undefined : "hello@kolbaba.app");
  },
  /** Comma-separated emails that may open /admin (the operator's overview of users). Empty = nobody. */
  get adminEmails() {
    return (optional("ADMIN_EMAILS") ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
  },
  /** Comma-separated emails allowed to create an account. Empty = anyone. */
  get signupAllowlist() {
    return (optional("SIGNUP_ALLOWLIST") ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
  },
};
