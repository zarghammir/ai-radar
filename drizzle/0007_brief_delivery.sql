-- #72: give the notification preference something that reads it.
--
-- Two tables, and the second is the one that matters for operability.
--
-- push_subscriptions is an ADDRESS BOOK, not reader state. #91 put saves,
-- reads and hides in the browser because one instance can be read by more than
-- one person; a push endpoint is the opposite case — the server cannot send to
-- an address it does not hold. One row per browser, so a shared instance tells
-- each of its readers rather than making them share one subscription.
--
-- brief_sends exists because A SEND THAT SILENTLY DOES NOTHING IS THE SHAPE
-- THAT HID THE COLLECTOR OUTAGE FOR THREE DAYS. Without it, "it was not time
-- yet", "nobody is subscribed", "there was nothing to say" and "the push
-- service refused us" are all the same observable: no notification. Each is
-- now a row with its own outcome and a sentence saying which.
--
-- ─────────────────────────────────────────────────────────────────────────
-- IF YOU ARE WRITING A HAND MIGRATION, READ THIS FIRST.
--
-- This file was written by hand rather than generated, as 0003 was. But it
-- carries a snapshot and 0003 does not, and the difference is not an
-- inconsistency — it is the rule:
--
--   0003 CHANGED NO SCHEMA. It was two UPDATE statements. drizzle-kit diffs
--   TABLE SHAPES, so a data-only migration leaves the shape identical and
--   needs no snapshot to keep the next diff honest.
--
--   0007 CREATES TABLES. Without meta/0007_snapshot.json, the next
--   `drizzle-kit generate` diffs the schema against 0006 — a tree with no
--   push_subscriptions and no brief_sends — decides they are missing, and
--   emits a migration that CREATES THEM A SECOND TIME. That migration then
--   fails against any database where 0007 already ran.
--
-- So: a hand migration that changes a table's shape MUST be accompanied by a
-- snapshot; one that only moves data must not bother. Getting this wrong does
-- not fail here — it fails in whoever's branch comes next, which is the worst
-- place for it to surface. The collector spent three days down in September
-- on a migration that was listed and never executed; this is the neighbouring
-- failure, and it is cheap to avoid and expensive to diagnose.
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "push_subscriptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_success_at" timestamp with time zone,
	"last_error" text,
	"failure_count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "push_subscriptions_endpoint_unique" UNIQUE("endpoint")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "brief_sends" (
	"id" serial PRIMARY KEY NOT NULL,
	"local_day" text NOT NULL,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL,
	"channel" text NOT NULL,
	"outcome" text NOT NULL,
	"detail" text,
	"story_count" integer DEFAULT 0 NOT NULL,
	"attempted" integer DEFAULT 0 NOT NULL,
	"delivered" integer DEFAULT 0 NOT NULL,
	"failed" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "brief_sends_day_idx" ON "brief_sends" USING btree ("local_day");
