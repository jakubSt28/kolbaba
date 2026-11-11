CREATE TABLE "calendar_reminders" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"calendar_id" text NOT NULL,
	"key" text NOT NULL,
	"minutes" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "calendar_reminders" ADD CONSTRAINT "calendar_reminders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_reminders" ADD CONSTRAINT "calendar_reminders_calendar_id_calendars_id_fk" FOREIGN KEY ("calendar_id") REFERENCES "public"."calendars"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_reminders_calendar_id_key_index" ON "calendar_reminders" USING btree ("calendar_id","key");