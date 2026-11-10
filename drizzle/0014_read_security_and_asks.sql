-- Smart categories learned security notices (and, opt-in, asks from people): the last month's mail
-- without a card gets another reading. Cards already found stay as they are.
UPDATE "messages" SET "insight_checked_at" = NULL
WHERE "insight_checked_at" IS NOT NULL
  AND "date" > now() - interval '30 days'
  AND NOT EXISTS (SELECT 1 FROM "insights" i WHERE i."message_id" = "messages"."id");
