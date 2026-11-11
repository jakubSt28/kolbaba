CREATE TABLE "calendar_events" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"calendar_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"series_id" text,
	"uid" text,
	"etag" text,
	"title" text DEFAULT '' NOT NULL,
	"location" text DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"all_day" boolean DEFAULT false NOT NULL,
	"time_zone" text,
	"recurrence" text,
	"organizer" jsonb,
	"attendees" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"my_status" text,
	"join_url" text,
	"url" text,
	"can_edit" boolean DEFAULT true NOT NULL,
	"reminded_for" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calendar_objects" (
	"id" text PRIMARY KEY NOT NULL,
	"calendar_id" text NOT NULL,
	"uid" text NOT NULL,
	"ics" text NOT NULL,
	"first_at" timestamp with time zone,
	"last_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calendar_sources" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"account_id" text,
	"label" text DEFAULT '' NOT NULL,
	"url" text,
	"credentials" jsonb,
	"status" text DEFAULT 'ok' NOT NULL,
	"status_message" text,
	"listed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calendars" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"source_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"name" text NOT NULL,
	"hue" integer NOT NULL,
	"visible" boolean DEFAULT true NOT NULL,
	"read_only" boolean DEFAULT false NOT NULL,
	"primary" boolean DEFAULT false NOT NULL,
	"synced_from" timestamp with time zone,
	"synced_to" timestamp with time zone,
	"synced_at" timestamp with time zone,
	"sync_state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "calendar" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_calendar_id_calendars_id_fk" FOREIGN KEY ("calendar_id") REFERENCES "public"."calendars"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_objects" ADD CONSTRAINT "calendar_objects_calendar_id_calendars_id_fk" FOREIGN KEY ("calendar_id") REFERENCES "public"."calendars"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_sources" ADD CONSTRAINT "calendar_sources_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_sources" ADD CONSTRAINT "calendar_sources_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendars" ADD CONSTRAINT "calendars_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendars" ADD CONSTRAINT "calendars_source_id_calendar_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."calendar_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_events_calendar_id_provider_id_index" ON "calendar_events" USING btree ("calendar_id","provider_id");--> statement-breakpoint
CREATE INDEX "calendar_events_user_id_start_at_index" ON "calendar_events" USING btree ("user_id","start_at");--> statement-breakpoint
CREATE INDEX "calendar_events_start_at_index" ON "calendar_events" USING btree ("start_at");--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_objects_calendar_id_uid_index" ON "calendar_objects" USING btree ("calendar_id","uid");--> statement-breakpoint
CREATE INDEX "calendar_sources_user_id_index" ON "calendar_sources" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "calendars_user_id_index" ON "calendars" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "calendars_source_id_provider_id_index" ON "calendars" USING btree ("source_id","provider_id");