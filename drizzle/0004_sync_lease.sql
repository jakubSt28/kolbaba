ALTER TABLE "accounts" ADD COLUMN "sync_lease_owner" text;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "sync_lease_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "sync_requested" boolean DEFAULT false NOT NULL;