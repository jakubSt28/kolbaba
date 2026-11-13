CREATE TABLE "task_lists" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"kind" text DEFAULT 'list' NOT NULL,
	"name" text NOT NULL,
	"emoji" text,
	"folder_id" text,
	"sort_order" double precision DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "list_id" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "repeat" text;--> statement-breakpoint
ALTER TABLE "task_lists" ADD CONSTRAINT "task_lists_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "task_lists_user_id_index" ON "task_lists" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_list_id_task_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."task_lists"("id") ON DELETE set null ON UPDATE no action;