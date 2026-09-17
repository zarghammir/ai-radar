CREATE TYPE "public"."content_type_source" AS ENUM('adapter', 'classifier', 'default');--> statement-breakpoint
ALTER TABLE "raw_items" ADD COLUMN "content_type_source" "content_type_source" DEFAULT 'default' NOT NULL;--> statement-breakpoint
-- Backfill provenance for rows written before the column existed.
--
-- This is the ONE moment at which `content_type <> default_content_type`
-- correctly means "an adapter declared this": every row here was written by a
-- normalizeItem that could only copy the adapter's value or the source
-- default. From the next ingest onwards the classifier can move a type too, so
-- the same comparison would report the classifier's own output as an adapter's
-- declaration — which is why provenance is a stored column and this statement
-- runs exactly once.
UPDATE "raw_items" ri
SET "content_type_source" = 'adapter'
FROM "sources" s
WHERE s."id" = ri."source_id"
  AND ri."content_type" <> s."default_content_type";
