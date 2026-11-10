-- Search without diacritics, and addresses, domains and links come apart into words (src/server/db/schema.ts).
CREATE EXTENSION IF NOT EXISTS unaccent;--> statement-breakpoint
-- A generated column needs an immutable function; unaccent() is only stable (its dictionary could change).
CREATE OR REPLACE FUNCTION immutable_unaccent(text) RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT AS $$ SELECT public.unaccent('public.unaccent'::regdictionary, $1) $$;--> statement-breakpoint
ALTER TABLE "messages" DROP COLUMN "search";--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "search" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', immutable_unaccent(translate(coalesce(subject,'') || ' ' || coalesce("from"->>'name','') || ' ' || coalesce("from"->>'email','') || ' ' || coalesce(snippet,'') || ' ' || left(coalesce(body_text,''), 20000), '@./<>', '     ')))) STORED;--> statement-breakpoint
-- Dropping the column took its index along.
CREATE INDEX "messages_search_idx" ON "messages" USING gin ("search");
