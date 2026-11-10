-- Conversations that aren't automatic mail after all (threadKind in src/server/sync/sink.ts): from a shared
-- address (info@, support@, team@, hello@) whose first email answers something, and the user's own.
UPDATE "threads" SET "kind" = 'person'
FROM (
  SELECT DISTINCT ON (m."thread_id") m."thread_id", m."is_outgoing", m."from"->>'email' AS "email", m."in_reply_to", m."references"
  FROM "messages" m JOIN "threads" t ON t."id" = m."thread_id"
  WHERE t."kind" = 'notification'
  ORDER BY m."thread_id", m."date"
) f
WHERE f."thread_id" = "threads"."id"
  AND (f."is_outgoing" OR (f."email" ~* '^(info|support|team|hello)[@+.-]' AND (f."in_reply_to" IS NOT NULL OR jsonb_array_length(f."references") > 0)));
