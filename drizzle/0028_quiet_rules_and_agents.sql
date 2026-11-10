CREATE TABLE "away_replies" (
	"account_id" text NOT NULL,
	"email" text NOT NULL,
	"sent_at" timestamp with time zone NOT NULL,
	CONSTRAINT "away_replies_account_id_email_pk" PRIMARY KEY("account_id","email")
);
--> statement-breakpoint
CREATE TABLE "rule_hints" (
	"user_id" text NOT NULL,
	"sender" text NOT NULL,
	"folder_id" text NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"asked" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rule_hints_user_id_sender_folder_id_pk" PRIMARY KEY("user_id","sender","folder_id")
);
--> statement-breakpoint
CREATE TABLE "rules" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"account_id" text,
	"from_match" text DEFAULT '' NOT NULL,
	"subject_match" text DEFAULT '' NOT NULL,
	"action" text NOT NULL,
	"folder_id" text,
	"mark_read" boolean DEFAULT false NOT NULL,
	"applied" integer DEFAULT 0 NOT NULL,
	"last_applied_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "notify" text DEFAULT 'all' NOT NULL;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "account_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "vip" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "threads" ADD COLUMN "watched_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "threads" ADD COLUMN "ruled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "away_replies" ADD CONSTRAINT "away_replies_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_hints" ADD CONSTRAINT "rule_hints_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_hints" ADD CONSTRAINT "rule_hints_folder_id_mail_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."mail_folders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rules" ADD CONSTRAINT "rules_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rules" ADD CONSTRAINT "rules_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rules" ADD CONSTRAINT "rules_folder_id_mail_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."mail_folders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "rules_user_id_index" ON "rules" USING btree ("user_id");--> statement-breakpoint
-- Every agent keeps seeing what all agents saw until now: the mailboxes shared with agents.
UPDATE "agents" a SET "account_ids" = coalesce((SELECT jsonb_agg(c."id") FROM "accounts" c WHERE c."user_id" = a."user_id" AND c."mcp_enabled"), '[]'::jsonb);
