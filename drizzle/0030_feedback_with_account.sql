-- Feedback left by accounts that were already deleted: the privacy policy promised it went with them.
DELETE FROM "feedback" WHERE "user_id" IS NULL;--> statement-breakpoint
ALTER TABLE "feedback" DROP CONSTRAINT "feedback_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;