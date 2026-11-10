ALTER TABLE "threads" ADD COLUMN "last_sent_at" timestamp with time zone;--> statement-breakpoint
-- The user's newest email in each conversation (Trash and Spam aside), as refreshThreads keeps it from now on.
UPDATE "threads" SET "last_sent_at" = s."at"
FROM (
  SELECT "thread_id", max("date") AS "at" FROM "messages"
  WHERE "is_outgoing" AND NOT ("labels" ? 'role:trash' OR "labels" ? 'role:spam')
  GROUP BY "thread_id"
) s
WHERE s."thread_id" = "threads"."id";--> statement-breakpoint
CREATE INDEX "threads_sent_idx" ON "threads" USING btree ("user_id","last_sent_at") WHERE "threads"."last_sent_at" is not null;
