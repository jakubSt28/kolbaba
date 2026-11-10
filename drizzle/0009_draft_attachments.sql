CREATE TABLE "draft_attachments" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"draft_id" text,
	"outbox_id" text,
	"name" text NOT NULL,
	"mime" text NOT NULL,
	"size" integer NOT NULL,
	"received" integer DEFAULT 0 NOT NULL,
	"inline" boolean DEFAULT false NOT NULL,
	"cid" text,
	"content" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "draft_attachments" ADD CONSTRAINT "draft_attachments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "draft_attachments_draft_id_index" ON "draft_attachments" USING btree ("draft_id");--> statement-breakpoint
CREATE INDEX "draft_attachments_outbox_id_index" ON "draft_attachments" USING btree ("outbox_id");