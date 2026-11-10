CREATE TABLE "ops_alerts" (
	"key" text PRIMARY KEY NOT NULL,
	"sent_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sender_memory" (
	"user_id" text NOT NULL,
	"sender" text NOT NULL,
	"nothing" integer DEFAULT 0 NOT NULL,
	"skipped" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sender_memory_user_id_sender_pk" PRIMARY KEY("user_id","sender")
);
--> statement-breakpoint
ALTER TABLE "insights" ADD COLUMN "dismissed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "trial_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "plus_gifted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "stripe_customer_id" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "stripe_subscription_id" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "subscription_status" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "subscription_interval" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "subscription_period_end" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "subscription_cancels_at_end" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "sender_memory" ADD CONSTRAINT "sender_memory_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_stripeCustomerId_unique" UNIQUE("stripe_customer_id");--> statement-breakpoint
-- Smart categories are part of Kolbaba Plus now. Whoever already uses them keeps them: their 14-day trial starts today.
UPDATE "users" SET "trial_started_at" = now()
WHERE ("settings"->>'smartCategories')::boolean IS TRUE AND "trial_started_at" IS NULL;
