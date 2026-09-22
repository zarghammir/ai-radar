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
-- Written by hand rather than generated, as 0003 was. The snapshot in
-- meta/0007_snapshot.json is written alongside it so the NEXT drizzle-kit
-- generate diffs against a tree that contains these tables — without it the
-- next person's migration would try to create them a second time.
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
