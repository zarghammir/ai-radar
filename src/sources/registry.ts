import type { SourceKind } from "@/db/schema";
import type { SourceAdapter } from "./types";
import { rssAdapter } from "./rss/adapter";
import { hackerNewsAdapter } from "./hackernews/adapter";
import { arxivAdapter } from "./arxiv/adapter";

/**
 * Register a new adapter here and it becomes usable by any row in `sources`
 * whose `kind` matches. Nothing else in the app needs to change.
 */
const adapters: Partial<Record<SourceKind, SourceAdapter>> = {
  rss: rssAdapter,
  hackernews: hackerNewsAdapter,
  arxiv: arxivAdapter,
};

export function getAdapter(kind: SourceKind): SourceAdapter | undefined {
  return adapters[kind];
}

export function listAdapters(): SourceAdapter[] {
  return Object.values(adapters).filter((a): a is SourceAdapter => Boolean(a));
}
