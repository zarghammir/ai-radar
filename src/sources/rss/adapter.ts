import type { SourceAdapter, FetchedItem } from "../types";
import { fetchText } from "../http";
import { parseFeed } from "./parse";

/**
 * Generic RSS / Atom adapter. Works for company blogs, publications, RSSHub
 * routes, and any other feed. Config options (sources.config):
 *   - maxItems?: number   (default 50)
 */
export const rssAdapter: SourceAdapter = {
  kind: "rss",
  description: "RSS 2.0 / Atom / RDF feeds (company blogs, publications, RSSHub routes).",
  async fetch(source, ctx): Promise<FetchedItem[]> {
    if (!source.url) throw new Error(`Source ${source.key} has no feed URL`);
    const xml = await fetchText(source.url, { fetchImpl: ctx.fetch });
    const { items } = parseFeed(xml);
    const maxItems = Number(source.config.maxItems ?? 50);
    return items.slice(0, maxItems).map((it) => ({
      externalId: it.id,
      url: it.url,
      title: it.title,
      excerpt: it.summary,
      author: it.author,
      publishedAt: it.publishedAt,
    }));
  },
};
