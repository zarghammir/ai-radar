/**
 * The shapes docs/api.md defines, as TypeScript.
 *
 * The enums are IMPORTED from src/db/schema.ts rather than redeclared, so a
 * value added to the database cannot silently go unhandled here. There are ten
 * content types, not the six the prototype drew.
 */
import type {
  BriefLength,
  ContentType,
  NotificationChannel,
  SourceTier,
  VerificationLevel,
} from "@/db/schema";

export type { BriefLength, ContentType, NotificationChannel, SourceTier, VerificationLevel };

export interface SourceRef {
  key: string;
  name: string;
  tier: SourceTier;
  homepage: string | null;
}

export interface Topic {
  key: string;
  name: string;
  group: "company" | "domain" | "field";
}

/**
 * What a list renders. Returned by /api/brief and /api/radar.
 *
 * /api/saved returns the WIDER `SavedCard` below. This comment used to claim
 * it returned this shape, which is how the saved list ended up with no name
 * for the note and the tags it was already being sent.
 */
export interface StoryCard {
  id: number;
  slug: string;
  title: string;
  /** Null until the Phase 2 summariser lands. ALWAYS fall back to `excerpt`. */
  summary: string | null;
  excerpt: string | null;
  /**
   * Null until the Phase 2 summariser lands. Added to StoryCard for issue #13:
   * a list screen cannot make one detail request per story to fill a line.
   */
  whyItMatters: string | null;
  url: string;
  /**
   * A SECOND link when the story has one: `url` is the thing, this is the
   * conversation about it. Null for most stories, and #84 is why it exists —
   * a Show HN launch carries both, the adapter built both, and only one could
   * reach a screen.
   *
   * `string | null` rather than optional on purpose: an optional field has two
   * ways to be absent and every consumer then has to treat them alike with
   * nothing making it. It is also NEVER equal to `url` — the server drops it
   * when they match, so "has a discussion" stays a real distinction rather
   * than something every story satisfies.
   */
  discussionUrl: string | null;
  contentType: ContentType;
  verification: VerificationLevel;
  verificationNote: string | null;
  /** De-duplicated: one entry per source however many items that source filed. */
  sourceCount: number;
  sources: SourceRef[];
  primarySource: SourceRef;
  topics: Topic[];
  publishedAt: string;
  /** When this app first saw it — the "detected" time, not the published one. */
  firstSeenAt: string;
  lastActivityAt: string;
  readingMinutes: number;
  score: number;
  saved: boolean;
  read: boolean;
}

/**
 * One item on the Saved screen: the card, plus the three things that are true
 * only because the reader put it there. Mirrors `SavedCard` in src/api/reader.ts.
 */
export interface SavedCard extends StoryCard {
  note: string | null;
  tags: string[];
  savedAt: string;
}

export interface SavedResponse {
  stories: SavedCard[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface BriefWindow {
  from: string;
  to: string;
  briefTime: string;
  timezone: string;
}

export type BriefLengthParam = "5" | "10" | "all";

export interface BriefResponse {
  window: BriefWindow;
  length: BriefLengthParam;
  /** Which view produced this. "all" is everything stored. See views.ts. */
  view: "built" | "all";
  /** Describes the RESPONSE, not the window. */
  count: number;
  readingMinutes: number;
  stories: StoryCard[];
}

export interface ApiError {
  error: {
    code: "VALIDATION_ERROR" | "NOT_FOUND" | "METHOD_NOT_ALLOWED" | "INTERNAL";
    message: string;
  };
}

/**
 * The reader's preferences, as /api/preferences returns them.
 *
 * `briefLength`, `notificationChannel` and `theme` are `string` and not their
 * unions ON PURPOSE. The write path validates them, but the columns are plain
 * text, so a value this build has never heard of can come back from a database
 * an older or newer build wrote. Typing them as the union here would be a
 * promise the data does not keep, and every screen that reads one would then
 * be free to assume a branch it never handles. Narrow them where they are used,
 * with a fallback the reader can see.
 */
export interface Preferences {
  topicKeys: string[];
  /** "HH:MM", 24-hour, in `timezone`. */
  briefTime: string;
  /** An IANA zone name, e.g. "America/Toronto". */
  timezone: string;
  briefLength: string;
  notificationChannel: string;
  theme: string;
  /** Null until first-run onboarding finishes. The gate, and nothing else. */
  onboardedAt: string | null;
  updatedAt: string;
}

/**
 * A topic as the catalogue lists it, with how much it has carried lately.
 *
 * `group` is `string` rather than Topic["group"] because it comes back from raw
 * SQL over a text column. A screen that groups by it must put an unrecognised
 * group SOMEWHERE VISIBLE rather than filter it out — a topic that exists and
 * is not shown is a topic the reader cannot turn off.
 */
export interface TopicSummary {
  key: string;
  name: string;
  group: string;
  /** Stories in the recent window. 0 is a real answer, not a missing one. */
  storyCount: number;
}

export interface TopicsResponse {
  topics: TopicSummary[];
}
