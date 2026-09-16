import type { SourceAdapter, FetchedItem } from "../types";
import { fetchJson } from "../http";

/**
 * Hacker News via the official Firebase API (no key needed).
 * Config options (sources.config):
 *   - list?: "top" | "best" | "new"   (default "top")
 *   - limit?: number                  (default 120 ids scanned)
 *   - minPoints?: number              (default 20)
 *   - keywords?: string[]             AI filter; defaults to a built-in list
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

export const DEFAULT_AI_KEYWORDS = [
  "ai",
  "a.i.",
  "llm",
  "gpt",
  "openai",
  "anthropic",
  "claude",
  "gemini",
  "deepmind",
  "mistral",
  "llama",
  "transformer",
  "diffusion",
  "machine learning",
  "deep learning",
  "neural",
  "agent",
  "agentic",
  "model",
  "inference",
  "nvidia",
  "gpu",
  "cuda",
  "hugging face",
  "huggingface",
  "reinforcement learning",
  "rag",
  "embedding",
  "copilot",
  "cursor",
  "xai",
  "grok",
  "benchmark",
  "multimodal",
  "text-to-video",
  "text-to-image",
  "speech",
  "whisper",
  "robotics",
  "humanoid",
];

export function matchesKeywords(title: string, keywords: string[]): boolean {
  const t = ` ${title.toLowerCase().replace(/[^a-z0-9.+\- ]/g, " ")} `;
  return keywords.some((k) => {
    const kw = k.toLowerCase();
    // whole-word match for short tokens, substring for phrases
    return kw.length <= 4 ? t.includes(` ${kw} `) || t.includes(` ${kw}s `) : t.includes(kw);
  });
}

export const hackerNewsAdapter: SourceAdapter = {
  kind: "hackernews",
  description: "Hacker News front page / best stories filtered to AI topics (official API).",
  async fetch(source, ctx): Promise<FetchedItem[]> {
    const list = String(source.config.list ?? "top");
    const limit = Number(source.config.limit ?? 120);
    const minPoints = Number(source.config.minPoints ?? 20);
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
      const ids = failures
        .map((f) => f.id)
        .sort((a, b) => a - b)
        .slice(0, 10)
        .join(", ");
      ctx.log(
        `hackernews: ${failures.length} of ${slice.length} item fetches failed ` +
          `(ids ${ids}${failures.length > 10 ? ", …" : ""}); first reason: ${failures[0].reason}`,
      );
    }

    const out: FetchedItem[] = [];
    for (const it of items) {
      if (!it || it.deleted || it.dead || it.type !== "story" || !it.title) continue;
      if ((it.score ?? 0) < minPoints) continue;
      if (!matchesKeywords(it.title, keywords)) continue;
      const hnUrl = `https://news.ycombinator.com/item?id=${it.id}`;
      out.push({
        externalId: String(it.id),
        // Link to the article when there is one; HN thread is kept in metadata.
        url: it.url ?? hnUrl,
        title: it.title,
        excerpt: it.text ?? null,
        author: it.by ?? null,
        publishedAt: it.time ? new Date(it.time * 1000) : null,
        contentType: it.url ? undefined : "DISCUSSION",
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
