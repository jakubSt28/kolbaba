CREATE INDEX "messages_placeholder_idx" ON "messages" USING btree ("account_id") WHERE "messages"."provider_message_id" like 'local:%';--> statement-breakpoint
-- A new mailbox imports thousands of messages before the default autoanalyze (10% of the table) notices it.
-- Until then Postgres thinks the mailbox is empty and walks all of it for every imported message.
ALTER TABLE "messages" SET (autovacuum_analyze_scale_factor = 0, autovacuum_analyze_threshold = 1000);
