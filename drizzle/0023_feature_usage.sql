CREATE TABLE "feature_usage" (
	"user_id" text NOT NULL,
	"feature" text NOT NULL,
	"day" date NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "feature_usage_user_id_feature_day_pk" PRIMARY KEY("user_id","feature","day")
);
--> statement-breakpoint
ALTER TABLE "feature_usage" ADD CONSTRAINT "feature_usage_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "feature_usage_day_index" ON "feature_usage" USING btree ("day");