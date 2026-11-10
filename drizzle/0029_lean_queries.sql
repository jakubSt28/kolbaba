DROP INDEX "threads_folder_id_last_message_at_index";--> statement-breakpoint
CREATE INDEX "messages_user_date_idx" ON "messages" USING btree ("user_id","date");--> statement-breakpoint
CREATE INDEX "messages_outgoing_idx" ON "messages" USING btree ("user_id","date") WHERE "messages"."is_outgoing";--> statement-breakpoint
CREATE INDEX "messages_folder_uid_idx" ON "messages" USING btree ("account_id","imap_path","imap_uid");--> statement-breakpoint
CREATE INDEX "messages_references_gin" ON "messages" USING gin ("references" jsonb_path_ops);--> statement-breakpoint
CREATE INDEX "threads_inbox_sort_idx" ON "threads" USING btree ("user_id",greatest("last_message_at", "woke_at")) WHERE "threads"."folder" = 'inbox' and not "threads"."screening" and "threads"."muted_at" is null and "threads"."message_count" > 0;--> statement-breakpoint
CREATE INDEX "threads_folder_sort_idx" ON "threads" USING btree ("folder_id",greatest("last_message_at", "woke_at")) WHERE "threads"."folder_id" is not null;--> statement-breakpoint
CREATE INDEX "threads_pinned_idx" ON "threads" USING btree ("user_id","last_message_at") WHERE "threads"."pinned";--> statement-breakpoint
CREATE INDEX "threads_screening_idx" ON "threads" USING btree ("user_id","last_message_at") WHERE "threads"."screening";--> statement-breakpoint
CREATE INDEX "threads_folder_counts_idx" ON "threads" USING btree ("user_id","folder_id","account_id","unread","folder","message_count","snoozed_until") WHERE "threads"."folder_id" is not null;--> statement-breakpoint
CREATE INDEX "threads_inbox_unread_idx" ON "threads" USING btree ("user_id","kind","snoozed_until") WHERE "threads"."folder" = 'inbox' and "threads"."unread" and not "threads"."screening" and "threads"."muted_at" is null and "threads"."message_count" > 0;--> statement-breakpoint
CREATE INDEX "threads_snooze_release_idx" ON "threads" USING btree ("snoozed_until") WHERE "threads"."snoozed_at" is not null or "threads"."snooze_moved" <> '[]'::jsonb;--> statement-breakpoint
CREATE INDEX "threads_muted_inbox_idx" ON "threads" USING btree ("user_id") WHERE "threads"."muted_at" is not null and "threads"."folder" = 'inbox';--> statement-breakpoint
CREATE INDEX "threads_empty_idx" ON "threads" USING btree ("account_id","updated_at") WHERE "threads"."message_count" = 0;