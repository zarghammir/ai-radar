import { XMLParser } from "fast-xml-parser";
import type { SourceAdapter, FetchedItem } from "../types";
import { fetchText } from "../http";

/**
 * arXiv via the public Atom API (no key needed).
 * Config options (sources.config):
 *   - categories?: string[]  (default cs.AI, cs.LG, cs.CL, cs.CV, cs.RO, stat.ML)
 *   - maxResults?: number    (default 60)
 */
const DEFAULT_CATEGORIES = ["cs.AI", "cs.LG", "cs.CL", "cs.CV", "cs.RO", "stat.ML"];

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });

type Entry = {
  id: string;
  title: string;
  summary: string;
  published: string;
  updated: string;
  author: { name: string } | { name: string }[];
  link: { "@_href": string; "@_rel"?: string; "@_title"?: string }[] | { "@_href": string };
  category: { "@_term": string } | { "@_term": string }[];
  "arxiv:primary_category"?: { "@_term": string };
  "arxiv:comment"?: string;
};

function arr<T>(v: T | T[] | undefined): T[] {
  return v == null ? [] : Array.isArray(v) ? v : [v];
}

export function arxivIdFromUrl(url: string): string {
  // http://arxiv.org/abs/2509.01234v2 -> 2509.01234
  const m = url.match(/abs\/([^/]+?)(v\d+)?$/);
  return m ? m[1] : url;
}

export const arxivAdapter: SourceAdapter = {
  kind: "arxiv",
  description: "arXiv listings for AI categories via the public Atom API.",
  async fetch(source, ctx): Promise<FetchedItem[]> {
    const categories = Array.isArray(source.config.categories)
      ? (source.config.categories as string[])
      : DEFAULT_CATEGORIES;
    const maxResults = Number(source.config.maxResults ?? 60);
    const query = categories.map((c) => `cat:${c}`).join("+OR+");
    const url =
      `https://export.arxiv.org/api/query?search_query=${query}` +
      `&sortBy=submittedDate&sortOrder=descending&max_results=${maxResults}`;
    const xml = await fetchText(url, { fetchImpl: ctx.fetch, timeoutMs: 30_000 });
    const doc = parser.parse(xml) as { feed?: { entry?: Entry | Entry[] } };
    const entries = arr(doc.feed?.entry);

    return entries
      .filter((e) => e.id && e.title)
      .map((e) => {
        const links = arr(e.link);
        const abs = links.find((l) => !l["@_rel"] || l["@_rel"] === "alternate")?.["@_href"] ?? e.id;
        const pdf = links.find((l) => l["@_title"] === "pdf")?.["@_href"] ?? null;
        const authors = arr(e.author).map((a) => a.name);
        const cats = arr(e.category).map((c) => c["@_term"]);
        return {
          externalId: arxivIdFromUrl(e.id),
          url: abs.replace(/^http:/, "https:"),
          title: e.title.replace(/\s+/g, " ").trim(),
          excerpt: e.summary?.replace(/\s+/g, " ").trim() ?? null,
          author: authors.slice(0, 6).join(", ") + (authors.length > 6 ? " et al." : ""),
          publishedAt: e.published ? new Date(e.published) : null,
          contentType: "PAPER" as const,
          metadata: {
            arxivId: arxivIdFromUrl(e.id),
            authors,
            categories: cats,
            primaryCategory: e["arxiv:primary_category"]?.["@_term"] ?? cats[0] ?? null,
            pdfUrl: pdf,
            comment: e["arxiv:comment"] ?? null,
          },
        };
      });
  },
};
