CREATE TABLE "ai_usage" (
	"user_id" text NOT NULL,
	"day" date NOT NULL,
	"kind" text NOT NULL,
	"calls" integer DEFAULT 0 NOT NULL,
	"input_tokens" bigint DEFAULT 0 NOT NULL,
	"cached_tokens" bigint DEFAULT 0 NOT NULL,
	"output_tokens" bigint DEFAULT 0 NOT NULL,
	"cost_micros" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "ai_usage_user_id_day_kind_pk" PRIMARY KEY("user_id","day","kind")
);
--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_usage_day_index" ON "ai_usage" USING btree ("day");--> statement-breakpoint
-- Smart categories read mail in a cheaper way now (Jev sorts it first, OpenAI reads only the last 90 days,
-- older mail gets cards without details): everything without a card gets a reading under the new rules.
-- Cards that are already there stay as they are.
UPDATE "messages" SET "insight_checked_at" = NULL
WHERE "insight_checked_at" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "insights" i WHERE i."message_id" = "messages"."id");
