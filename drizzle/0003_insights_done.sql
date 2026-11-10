ALTER TABLE "insights" ADD COLUMN "done_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "insights_user_id_group_key_index" ON "insights" USING btree ("user_id","group_key");--> statement-breakpoint
-- Smart categories read mail better now (buyer or seller, bill or receipt, what was bought): read it again.
-- Cards stay as they are until the new reading replaces them.
UPDATE "messages" SET "insight_checked_at" = NULL WHERE "insight_checked_at" IS NOT NULL;
