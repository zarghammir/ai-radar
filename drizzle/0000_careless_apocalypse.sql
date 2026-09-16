CREATE TYPE "public"."content_type" AS ENUM('NEWS', 'RELEASE', 'RESEARCH', 'DISCUSSION', 'TREND', 'TOOL', 'MODEL', 'PAPER', 'BUSINESS', 'REGULATION');--> statement-breakpoint
CREATE TYPE "public"."item_role" AS ENUM('primary', 'report', 'discussion');--> statement-breakpoint
CREATE TYPE "public"."source_kind" AS ENUM('rss', 'hackernews', 'arxiv', 'gdelt', 'github', 'huggingface', 'openalex', 'x');--> statement-breakpoint
CREATE TYPE "public"."source_tier" AS ENUM('PRIMARY', 'HIGH_QUALITY_REPORTING', 'COMMUNITY', 'DISCOVERY');--> statement-breakpoint
CREATE TYPE "public"."verification_level" AS ENUM('PRIMARY_SOURCE', 'CORROBORATED', 'EMERGING', 'UNVERIFIED');--> statement-breakpoint
CREATE TABLE "ingest_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"source_id" integer,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"items_fetched" integer DEFAULT 0 NOT NULL,
	"items_new" integer DEFAULT 0 NOT NULL,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "llm_usage" (
	"id" serial PRIMARY KEY NOT NULL,
	"day" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"stories_summarized" integer DEFAULT 0 NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "raw_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"source_id" integer NOT NULL,
	"external_id" text NOT NULL,
	"url" text NOT NULL,
	"canonical_url" text NOT NULL,
	"title" text NOT NULL,
	"excerpt" text,
	"author" text,
	"published_at" timestamp with time zone NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"content_type" "content_type" NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"fingerprint" text NOT NULL,
	"story_id" integer,
	"role" "item_role"
);
--> statement-breakpoint
CREATE TABLE "read_state" (
	"story_id" integer PRIMARY KEY NOT NULL,
	"read_at" timestamp with time zone,
	"hidden" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "saved_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"story_id" integer NOT NULL,
	"note" text,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "saved_items_story_id_unique" UNIQUE("story_id")
);
--> statement-breakpoint
CREATE TABLE "sources" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"kind" "source_kind" NOT NULL,
	"tier" "source_tier" NOT NULL,
	"url" text,
	"homepage" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"default_content_type" "content_type" DEFAULT 'NEWS' NOT NULL,
	"last_fetched_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sources_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "stories" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"summary" text,
	"why_it_matters" text,
	"key_points" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"content_type" "content_type" NOT NULL,
	"verification" "verification_level" DEFAULT 'UNVERIFIED' NOT NULL,
	"verification_note" text,
	"primary_item_id" integer,
	"first_seen_at" timestamp with time zone NOT NULL,
	"last_activity_at" timestamp with time zone NOT NULL,
	"source_count" integer DEFAULT 1 NOT NULL,
	"score" real DEFAULT 0 NOT NULL,
	"score_components" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"summary_provider" text,
	"summarized_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stories_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "story_topics" (
	"story_id" integer NOT NULL,
	"topic_id" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "topics" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"group" text NOT NULL,
	"keywords" jsonb DEFAULT '[]'::jsonb NOT NULL,
	CONSTRAINT "topics_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "user_preferences" (
	"id" serial PRIMARY KEY NOT NULL,
	"topic_keys" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"brief_time" text DEFAULT '07:30' NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"brief_length" text DEFAULT '10' NOT NULL,
	"notification_channel" text DEFAULT 'none' NOT NULL,
	"email" text,
	"theme" text DEFAULT 'system' NOT NULL,
	"onboarded_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ingest_runs" ADD CONSTRAINT "ingest_runs_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raw_items" ADD CONSTRAINT "raw_items_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "read_state" ADD CONSTRAINT "read_state_story_id_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_items" ADD CONSTRAINT "saved_items_story_id_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_topics" ADD CONSTRAINT "story_topics_story_id_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_topics" ADD CONSTRAINT "story_topics_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "raw_items_fingerprint_idx" ON "raw_items" USING btree ("fingerprint");--> statement-breakpoint
CREATE UNIQUE INDEX "raw_items_source_external_idx" ON "raw_items" USING btree ("source_id","external_id");--> statement-breakpoint
CREATE INDEX "raw_items_published_idx" ON "raw_items" USING btree ("published_at");--> statement-breakpoint
CREATE INDEX "raw_items_story_idx" ON "raw_items" USING btree ("story_id");--> statement-breakpoint
CREATE INDEX "raw_items_content_type_idx" ON "raw_items" USING btree ("content_type");--> statement-breakpoint
CREATE INDEX "stories_score_idx" ON "stories" USING btree ("score");--> statement-breakpoint
CREATE INDEX "stories_last_activity_idx" ON "stories" USING btree ("last_activity_at");--> statement-breakpoint
CREATE INDEX "stories_content_type_idx" ON "stories" USING btree ("content_type");--> statement-breakpoint
CREATE UNIQUE INDEX "story_topics_unique" ON "story_topics" USING btree ("story_id","topic_id");