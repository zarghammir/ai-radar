ALTER TABLE "raw_items" ADD COLUMN "matched_ai_vocabulary" boolean;--> statement-breakpoint
ALTER TABLE "stories" ADD COLUMN "adjacent_tech" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- No data backfill here, deliberately, and both columns say why in their own way.
--
-- `matched_ai_vocabulary` is left NULL for existing rows because nothing in SQL
-- can answer it: the vocabulary is forty keywords with a whole-word rule for
-- short tokens and a substring rule for long ones, and the hyphen handling from
-- #73 on top. NULL is the honest value — "never evaluated" is a different
-- answer from "did not match", and reading one as the other would hide stories
-- that have been visible all along. `npm run backfill:ai-vocabulary` fills them
-- in through the real matcher.
--
-- `adjacent_tech` defaults to FALSE, which is what makes this migration add
-- nothing to the default view: every story that existed before it stays in the
-- front door. A story only becomes adjacent tech once a source with
-- keywordPolicy "label" keeps something that matched nothing, and no seeded
-- source sets that yet.
