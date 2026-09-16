import { createHash } from "node:crypto";
import type { ContentType, NewRawItem, Source } from "@/db/schema";
import type { FetchedItem } from "@/sources/types";
import { canonicalizeUrl } from "./url";
import { cleanTitle, stripHtml, truncate } from "./text";

export const EXCERPT_MAX = 600;

export function fingerprintFor(sourceKey: string, canonicalUrl: string): string {
  return createHash("sha256").update(`${sourceKey}|${canonicalUrl}`).digest("hex");
}

/**
 * Turn an adapter item into a database row. Pure: no I/O.
 * Returns null when the item is unusable (no title / URL).
 */
export function normalizeItem(
  item: FetchedItem,
  source: Pick<Source, "id" | "key" | "defaultContentType">,
  now: Date = new Date(),
): NewRawItem | null {
  const title = cleanTitle(item.title ?? "");
  const url = (item.url ?? "").trim();
  if (!title || !url) return null;
  const canonicalUrl = canonicalizeUrl(url);
  const excerptRaw = item.excerpt ? stripHtml(item.excerpt) : "";
  const excerpt = excerptRaw ? truncate(excerptRaw, EXCERPT_MAX) : null;
  let publishedAt = item.publishedAt ?? now;
  // Guard against feeds with future timestamps or unparseable dates.
  if (publishedAt.getTime() > now.getTime() + 60 * 60 * 1000) publishedAt = now;
  const contentType: ContentType = item.contentType ?? source.defaultContentType;
  return {
    sourceId: source.id,
    externalId: item.externalId || canonicalUrl,
    url,
    canonicalUrl,
    title,
    excerpt,
    author: item.author?.trim() || null,
    publishedAt,
    fetchedAt: now,
    contentType,
    metadata: item.metadata ?? {},
    fingerprint: fingerprintFor(source.key, canonicalUrl),
  };
}
