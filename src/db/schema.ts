import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// ─── Enumerations ────────────────────────────────────────────────────────────
// Verification (credibility of the claim) and content type (what kind of thing
// it is) are deliberately separate fields. See docs/architecture.md.

/**
 * Where a claim comes from, strongest first.
 *
 * ANALYST sits between a newsroom and the crowd on purpose: a named expert
 * newsletter is worth more than anonymous chatter for ranking, but it is a
 * reading of the news rather than independent reporting of it, so two analysts
 * agreeing must not earn the same badge as two newsrooms agreeing. The rule
 * that enforces that lives in deriveVerification.
 */
export const SOURCE_TIERS = [
  "PRIMARY",
  "HIGH_QUALITY_REPORTING",
  "ANALYST",
  "COMMUNITY",
  "DISCOVERY",
] as const;
export const SOURCE_KINDS = [
  "rss",
  "hackernews",
  "arxiv",
  "gdelt",
  "github",
  "huggingface",
  "openalex",
  "x",
] as const;
export const CONTENT_TYPES = [
  "NEWS",
  "RELEASE",
  "RESEARCH",
  "DISCUSSION",
  "TREND",
  "TOOL",
  "MODEL",
  "PAPER",
  "BUSINESS",
  "REGULATION",
] as const;
export const VERIFICATION_LEVELS = [
  "PRIMARY_SOURCE",
  "CORROBORATED",
  "EMERGING",
  "UNVERIFIED",
] as const;
/**
 * Why an item carries the content type it does.
 *
 * Recorded rather than inferred. It used to be derivable — a stored type that
 * differed from its source default could only have come from an adapter —
 * but the classifier moves types too, so that comparison now conflates the
 * classifier's own output with an adapter's declaration, and a source default
 * edited in the catalogue changes the answer retroactively.
 */
export const CONTENT_TYPE_SOURCES = ["adapter", "classifier", "default"] as const;
export const ITEM_ROLES = ["primary", "report", "discussion"] as const;
export const NOTIFICATION_CHANNELS = ["push", "email", "none"] as const;
export const BRIEF_LENGTHS = ["5", "10", "all"] as const;

export type SourceTier = (typeof SOURCE_TIERS)[number];
export type SourceKind = (typeof SOURCE_KINDS)[number];
export type ContentType = (typeof CONTENT_TYPES)[number];
export type ContentTypeSource = (typeof CONTENT_TYPE_SOURCES)[number];
export type VerificationLevel = (typeof VERIFICATION_LEVELS)[number];
export type ItemRole = (typeof ITEM_ROLES)[number];
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];
export type BriefLength = (typeof BRIEF_LENGTHS)[number];

export const sourceTierEnum = pgEnum("source_tier", SOURCE_TIERS);
export const sourceKindEnum = pgEnum("source_kind", SOURCE_KINDS);
export const contentTypeEnum = pgEnum("content_type", CONTENT_TYPES);
export const contentTypeSourceEnum = pgEnum("content_type_source", CONTENT_TYPE_SOURCES);
export const verificationEnum = pgEnum("verification_level", VERIFICATION_LEVELS);
export const itemRoleEnum = pgEnum("item_role", ITEM_ROLES);

// ─── Sources ─────────────────────────────────────────────────────────────────

export const sources = pgTable("sources", {
  id: serial("id").primaryKey(),
  /** Stable machine key, e.g. "openai-blog". Used by seeds and config. */
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  kind: sourceKindEnum("kind").notNull(),
  tier: sourceTierEnum("tier").notNull(),
  /** Feed / API URL the adapter fetches. */
  url: text("url"),
  /** Human-facing homepage shown in provenance. */
  homepage: text("homepage"),
  enabled: boolean("enabled").notNull().default(true),
  /** Adapter-specific options (arXiv categories, HN keyword filter, …). */
  config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
  /** Default content type for items from this source; adapters may override. */
  defaultContentType: contentTypeEnum("default_content_type").notNull().default("NEWS"),
  lastFetchedAt: timestamp("last_fetched_at", { withTimezone: true }),
  lastError: text("last_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── Raw items (one row per thing a source produced) ─────────────────────────

export const rawItems = pgTable(
  "raw_items",
  {
    id: serial("id").primaryKey(),
    sourceId: integer("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
    /** Source-scoped id: guid, HN item id, arXiv id … */
    externalId: text("external_id").notNull(),
    url: text("url").notNull(),
    canonicalUrl: text("canonical_url").notNull(),
    title: text("title").notNull(),
    excerpt: text("excerpt"),
    author: text("author"),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
    contentType: contentTypeEnum("content_type").notNull(),
    /** Where contentType came from; see CONTENT_TYPE_SOURCES. */
    contentTypeSource: contentTypeSourceEnum("content_type_source").notNull().default("default"),
    /**
     * Whether this item's title used AI vocabulary. NULLABLE on purpose: a row
     * written before #71 was never evaluated, and "not evaluated" is not the
     * same answer as "did not match". The backfill fills them in.
     *
     * A fact about words. Never a quality signal — see ai-vocabulary.ts.
     */
    matchedAiVocabulary: boolean("matched_ai_vocabulary"),
    /** Anything adapter-specific: HN points, arXiv authors/categories, stars … */
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    /**
     * Dedupe key: sha256 of "<source key>|<canonical url>". Scoped to the
     * source on purpose — the same article arriving from three sources must
     * stay three rows, or there is nothing left to count as corroboration.
     */
    fingerprint: text("fingerprint").notNull(),
    /** Assigned by the clusterer. Null until clustered. */
    storyId: integer("story_id"),
    role: itemRoleEnum("role"),
  },
  (t) => [
    uniqueIndex("raw_items_fingerprint_idx").on(t.fingerprint),
    uniqueIndex("raw_items_source_external_idx").on(t.sourceId, t.externalId),
    index("raw_items_published_idx").on(t.publishedAt),
    index("raw_items_story_idx").on(t.storyId),
    index("raw_items_content_type_idx").on(t.contentType),
  ],
);

// ─── Stories (clusters of raw items about one development) ───────────────────

export type ScoreComponents = Record<string, number>;

export const stories = pgTable(
  "stories",
  {
    id: serial("id").primaryKey(),
    slug: text("slug").notNull().unique(),
    title: text("title").notNull(),
    /** AI summary when available; otherwise null and the UI shows the excerpt. */
    summary: text("summary"),
    whyItMatters: text("why_it_matters"),
    keyPoints: jsonb("key_points").$type<string[]>().notNull().default([]),
    contentType: contentTypeEnum("content_type").notNull(),
    verification: verificationEnum("verification").notNull().default("UNVERIFIED"),
    /**
     * Adjacent tech: kept deliberately, not shown by default.
     *
     * True only when a story reached us through a source that carries more
     * than AI AND none of its items used AI vocabulary. The owner's ruling is
     * that a growing developer tool which never says "AI" should be findable
     * rather than discarded, so these are stored and filtered at read time.
     *
     * Defaults false, which is what makes this change add nothing to the
     * default view: every story that existed before it stays visible.
     */
    adjacentTech: boolean("adjacent_tech").notNull().default(false),
    /** Plain-language reason for the verification level (provenance). */
    verificationNote: text("verification_note"),
    primaryItemId: integer("primary_item_id"),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull(),
    lastActivityAt: timestamp("last_activity_at", { withTimezone: true }).notNull(),
    sourceCount: integer("source_count").notNull().default(1),
    score: real("score").notNull().default(0),
    scoreComponents: jsonb("score_components").$type<ScoreComponents>().notNull().default({}),
    summaryProvider: text("summary_provider"),
    summarizedAt: timestamp("summarized_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("stories_score_idx").on(t.score),
    index("stories_last_activity_idx").on(t.lastActivityAt),
    index("stories_content_type_idx").on(t.contentType),
  ],
);

// ─── Topics ──────────────────────────────────────────────────────────────────

export const topics = pgTable("topics", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  /** "company" | "domain" | "field" — used to group the onboarding chips. */
  group: text("group").notNull(),
  /** Lower-case phrases that tag a story with this topic. */
  keywords: jsonb("keywords").$type<string[]>().notNull().default([]),
});

export const storyTopics = pgTable(
  "story_topics",
  {
    storyId: integer("story_id")
      .notNull()
      .references(() => stories.id, { onDelete: "cascade" }),
    topicId: integer("topic_id")
      .notNull()
      .references(() => topics.id, { onDelete: "cascade" }),
  },
  (t) => [uniqueIndex("story_topics_unique").on(t.storyId, t.topicId)],
);

// ─── User preferences ────────────────────────────────────────────────────────
// V1 is single-user (self-hosted, no login). One row with id = 1.
//
// AND THE READER'S OWN STATE IS NOT HERE, BY DECISION — see #91. Saved stories,
// read marks and hidden stories live in the reader's BROWSER, not in this
// database, because one instance can be read by more than one person and this
// row is shared by all of them. saved_items and read_state below are still
// written by their routes and still serve anyone using the API directly; the
// app's own screens do not use them. Before moving a reader's state INTO this
// schema, read that ruling: it was decided rather than defaulted, and accounts
// or an anonymous device identity can be added on top without discarding it.
// The column shape is ready for a user_id when accounts arrive.

export const userPreferences = pgTable("user_preferences", {
  id: serial("id").primaryKey(),
  topicKeys: jsonb("topic_keys").$type<string[]>().notNull().default([]),
  briefTime: text("brief_time").notNull().default("07:30"),
  /**
   * briefTime and timezone STAY SERVER-SIDE, and this is the reasoned half of
   * #94 rather than an oversight. They are the schedule of the deployment: the
   * worker's sweep and the brief window are computed from them before anyone
   * opens a page, so a reader's browser is the wrong place for them and moving
   * them would mean sending a timezone with every request to compute a window
   * the server already knows. A self-hoster sets when their own instance cuts
   * its brief; a reader of someone else's instance reads it on that schedule.
   */
  timezone: text("timezone").notNull().default("UTC"),

  notificationChannel: text("notification_channel")
    .$type<NotificationChannel>()
    .notNull()
    .default("none"),
  // NO EMAIL COLUMN, deliberately — see #94. It stored an address for a
  // feature that does not exist: #72 records that nothing sends a brief, not a
  // push and not a mail. On a shared instance that is one person's personal
  // data served to the next person who opens Settings, collected for nothing.
  // You cannot leak what you do not collect. It returns when #72 gives sending
  // a purpose, with whatever identity model that feature actually needs.
  // NO briefLength, theme OR onboardedAt either — see #94. They are the
  // reader's, not the instance's, so they live in the reader's browser beside
  // their saves. What remains here is what a self-hoster sets for their own
  // deployment.
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── Saved items & read state ────────────────────────────────────────────────

export const savedItems = pgTable("saved_items", {
  id: serial("id").primaryKey(),
  storyId: integer("story_id")
    .notNull()
    .unique()
    .references(() => stories.id, { onDelete: "cascade" }),
  note: text("note"),
  tags: jsonb("tags").$type<string[]>().notNull().default([]),
  archived: boolean("archived").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const readState = pgTable("read_state", {
  storyId: integer("story_id")
    .primaryKey()
    .references(() => stories.id, { onDelete: "cascade" }),
  readAt: timestamp("read_at", { withTimezone: true }),
  hidden: boolean("hidden").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── Operational: ingestion runs (developer view, debugging) ─────────────────

export const ingestRuns = pgTable("ingest_runs", {
  id: serial("id").primaryKey(),
  sourceId: integer("source_id").references(() => sources.id, { onDelete: "cascade" }),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  itemsFetched: integer("items_fetched").notNull().default(0),
  itemsNew: integer("items_new").notNull().default(0),
  error: text("error"),
});

// ─── LLM usage (cost guardrail) ──────────────────────────────────────────────

export const llmUsage = pgTable("llm_usage", {
  id: serial("id").primaryKey(),
  day: text("day").notNull(), // YYYY-MM-DD in UTC
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  storiesSummarized: integer("stories_summarized").notNull().default(0),
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
});

export type Source = typeof sources.$inferSelect;
export type RawItem = typeof rawItems.$inferSelect;
export type NewRawItem = typeof rawItems.$inferInsert;
export type Story = typeof stories.$inferSelect;
export type Topic = typeof topics.$inferSelect;
export type UserPreferences = typeof userPreferences.$inferSelect;
export type SavedItem = typeof savedItems.$inferSelect;
