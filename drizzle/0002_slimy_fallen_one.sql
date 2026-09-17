CREATE TYPE "public"."content_type_source" AS ENUM('adapter', 'classifier', 'default');--> statement-breakpoint
ALTER TABLE "raw_items" ADD COLUMN "content_type_source" "content_type_source" DEFAULT 'default' NOT NULL;
--> statement-breakpoint
-- Backfill provenance for rows written before this column existed.
--
-- NOT "stored <> default means an adapter set it". That inference is false on
-- any database whose rows were written by something other than normalizeItem —
-- including one where the #41 backfill has already run, which is the state the
-- development database on the author's machine is in: 40 rows differing from
-- their source default, none of them adapter-declared.
--
-- What is actually decidable here needs no titles and no classifier. Exactly
-- two adapters declare a type at all, and both declare a type the classifier
-- can never emit:
--
--   src/sources/arxiv/adapter.ts       contentType: "PAPER"
--   src/sources/hackernews/adapter.ts  contentType: "DISCUSSION"  (text posts)
--
-- CLASSIFIABLE excludes PAPER by construction and DISCUSSION is not in it, so
-- a stored PAPER or DISCUSSION can only have come from an adapter, and any
-- other value differing from the source default can only have come from the
-- classifier. Both statements are correct on a clean database and on an
-- already-backfilled one alike, which is the property the previous version
-- lacked.
--
-- `pipeline/normalize/content-type.test.ts` guards the premise: it fails if an
-- adapter ever declares a type outside that pair.
UPDATE "raw_items"
SET "content_type_source" = 'adapter'
WHERE "content_type" IN ('PAPER', 'DISCUSSION');--> statement-breakpoint
UPDATE "raw_items" ri
SET "content_type_source" = 'classifier'
FROM "sources" s
WHERE s."id" = ri."source_id"
  AND ri."content_type_source" <> 'adapter'
  AND ri."content_type" <> s."default_content_type";
