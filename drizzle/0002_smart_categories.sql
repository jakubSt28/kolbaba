CREATE TABLE "insights" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"account_id" text NOT NULL,
	"thread_id" text NOT NULL,
	"message_id" text NOT NULL,
	"category" text NOT NULL,
	"group_key" text NOT NULL,
	"data" jsonb NOT NULL,
	"source" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "insights_messageId_unique" UNIQUE("message_id")
);
--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "insight_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "insights" ADD CONSTRAINT "insights_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insights" ADD CONSTRAINT "insights_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insights" ADD CONSTRAINT "insights_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insights" ADD CONSTRAINT "insights_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "insights_user_id_category_at_index" ON "insights" USING btree ("user_id","category","at");--> statement-breakpoint
CREATE INDEX "insights_thread_id_index" ON "insights" USING btree ("thread_id");--> statement-breakpoint
CREATE INDEX "messages_insight_todo_idx" ON "messages" USING btree ("user_id","date") WHERE "messages"."insight_checked_at" is null;