/**
 * The shapes docs/api.md defines, as TypeScript.
 *
 * The enums are IMPORTED from src/db/schema.ts rather than redeclared, so a
 * value added to the database cannot silently go unhandled here. There are ten
 * content types, not the six the prototype drew.
 */
import type { ContentType, SourceTier, VerificationLevel } from "@/db/schema";

export type { ContentType, SourceTier, VerificationLevel };

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

/** What a list renders. Returned by /api/brief, /api/radar and /api/saved. */
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
