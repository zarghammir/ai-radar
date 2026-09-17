import type { ContentType, Source, SourceKind } from "@/db/schema";

/**
 * The item shape every adapter must produce. Adapters do NOT touch the
 * database; the pipeline normalizes, dedupes and stores what they return.
 */
export interface FetchedItem {
  /** Stable id inside this source (guid, HN id, arXiv id). */
  externalId: string;
  url: string;
  title: string;
  /** Plain text or HTML; the normalizer strips tags and truncates. */
  excerpt?: string | null;
  author?: string | null;
  publishedAt: Date | null;
  /** Override the source default (e.g. an arXiv adapter always says PAPER). */
  contentType?: ContentType;
  /**
   * Whether the adapter's own AI vocabulary matched this title. Set by
   * adapters that evaluate it; normalizeItem computes it from the shared
   * vocabulary when they do not, so every stored item carries the answer.
   */
  matchedAiVocabulary?: boolean;
  /** Anything else worth keeping: points, comments, categories, stars … */
  metadata?: Record<string, unknown>;
}

export interface FetchContext {
  /** Items published before this cutoff may be skipped by the adapter. */
  since: Date;
  fetch: typeof fetch;
  log: (msg: string) => void;
}

export interface SourceAdapter {
  kind: SourceKind;
  /** Human description used in docs and the developer view. */
  description: string;
  fetch(source: Source, ctx: FetchContext): Promise<FetchedItem[]>;
}
