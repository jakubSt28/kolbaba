ALTER TABLE "threads" ADD COLUMN "list_unsubscribe_one_click" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "threads" ADD COLUMN "unsubscribed_at" timestamp with time zone;