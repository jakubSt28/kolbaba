ALTER TABLE "push_subscriptions" ADD COLUMN "session_id" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "reauth_at" timestamp with time zone;