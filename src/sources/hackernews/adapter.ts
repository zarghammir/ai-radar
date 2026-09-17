import type { SourceAdapter, FetchedItem } from "../types";
import { matchesAnyKeyword } from "@/pipeline/normalize/keywords";
import { DEFAULT_AI_KEYWORDS } from "@/pipeline/normalize/ai-vocabulary";
import { fetchJson } from "../http";

/**
 * Hacker News via the official Firebase API (no key needed).
 * Config options (sources.config):
 *   - list?: "top" | "best" | "new" | "show"   (default "top")
 *   - limit?: number                  (default 120 ids scanned)
 *   - minPoints?: number              (default 20)
 *   - keywords?: string[]             AI filter; defaults to a built-in list
 *   - keywordPolicy?: "gate" | "label"  (default "gate")
 *       gate  — drop an item whose title never mentions AI. Right for the
 *               front page, which is a general technology firehose.
 *       label — keep it and record that it did not match, so a reader can
 *               choose to see it. Right for a discovery list like Show HN,
 *               where a growing developer tool that never says "AI" is
 *               exactly what the owner asked to be findable (#71).
 */
interface HnItem {
  id: number;
  type: string;
  title?: string;
  url?: string;
  by?: string;
  time?: number;
  score?: number;
  descendants?: number;
  text?: string;
  deleted?: boolean;
  dead?: boolean;
}

export { DEFAULT_AI_KEYWORDS } from "@/pipeline/normalize/ai-vocabulary";

/** Kept as the adapter's own name for the shared matcher; see keywords.ts. */
export function matchesKeywords(title: string, keywords: string[]): boolean {
  return matchesAnyKeyword(title, keywords);
}

export const hackerNewsAdapter: SourceAdapter = {
  kind: "hackernews",
  description: "Hacker News front page / best stories filtered to AI topics (official API).",
  async fetch(source, ctx): Promise<FetchedItem[]> {
    const list = String(source.config.list ?? "top");
    // Show HN is a launch list, not a news list, and that changes what a
    // self-post means; see the contentType note below.
    const isShowList = list === "show";
    const limit = Number(source.config.limit ?? 120);
    const minPoints = Number(source.config.minPoints ?? 20);
    // "gate" keeps today's behaviour for every source that does not ask
    // otherwise, so this change adds nothing to the default view on its own.
    const keywordPolicy = String(source.config.keywordPolicy ?? "gate");
    const keywords = Array.isArray(source.config.keywords)
      ? (source.config.keywords as string[])
      : DEFAULT_AI_KEYWORDS;

    const ids = await fetchJson<number[]>(
      `https://hacker-news.firebaseio.com/v0/${list}stories.json`,
      { fetchImpl: ctx.fetch },
    );
    const slice = ids.slice(0, limit);
    // A fetch that failed is not the same as a story that does not exist:
    // swallowing both as null makes an outage look like a quiet news day.
    const failures: { id: number; reason: string }[] = [];
    const items = await Promise.all(
      slice.map((id) =>
        fetchJson<HnItem | null>(`https://hacker-news.firebaseio.com/v0/item/${id}.json`, {
          fetchImpl: ctx.fetch,
        }).catch((err: unknown) => {
          failures.push({ id, reason: err instanceof Error ? err.message : String(err) });
          return null;
        }),
      ),
    );
    if (failures.length) {
      const failedIds = failures
        .map((f) => f.id)
        .sort((a, b) => a - b)
        .slice(0, 10)
        .join(", ");
      ctx.log(
        `hackernews: ${failures.length} of ${slice.length} item fetches failed ` +
          `(ids ${failedIds}${failures.length > 10 ? ", …" : ""}); first reason: ${failures[0].reason}`,
      );
    }

    const out: FetchedItem[] = [];
    for (const it of items) {
      if (!it || it.deleted || it.dead || it.type !== "story" || !it.title) continue;
      if ((it.score ?? 0) < minPoints) continue;
      const matched = matchesKeywords(it.title, keywords);
      // The gate that #71 turns into a label. Under "label" the item is kept
      // and the miss is recorded instead: you cannot offer a reader
      // "everything" over items you threw away.
      if (keywordPolicy === "gate" && !matched) continue;
      const hnUrl = `https://news.ycombinator.com/item?id=${it.id}`;
      out.push({
        externalId: String(it.id),
        // Link to the article when there is one; HN thread is kept in metadata.
        url: it.url ?? hnUrl,
        title: it.title,
        excerpt: it.text ?? null,
        author: it.by ?? null,
        publishedAt: it.time ? new Date(it.time * 1000) : null,
<<<<<<< HEAD
        // A self-post on the front page is a discussion: someone is asking
        // or arguing. A self-post on Show HN is a person launching a thing
        // and describing it rather than linking to it — a debut, not a
        // conversation — so it falls through to the source default instead.
        contentType: it.url || isShowList ? undefined : "DISCUSSION",
=======
        contentType: it.url ? undefined : "DISCUSSION",
        matchedAiVocabulary: matched,
>>>>>>> 3ebeb60 (Keep what the AI gate used to discard, and label it instead (#71))
        metadata: {
          hnId: it.id,
          hnUrl,
          points: it.score ?? 0,
          comments: it.descendants ?? 0,
        },
      });
    }
    return out;
  },
};
