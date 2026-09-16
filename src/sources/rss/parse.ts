import { XMLParser } from "fast-xml-parser";

export interface ParsedFeedItem {
  id: string;
  url: string;
  title: string;
  summary: string | null;
  author: string | null;
  publishedAt: Date | null;
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  cdataPropName: "#cdata",
  trimValues: true,
});

type Node = Record<string, unknown> | string | number | undefined | null;

function text(node: Node): string | null {
  if (node == null) return null;
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (typeof node === "object") {
    const n = node as Record<string, unknown>;
    if (typeof n["#cdata"] === "string") return n["#cdata"] as string;
    if (typeof n["#text"] === "string" || typeof n["#text"] === "number")
      return String(n["#text"]);
  }
  return null;
}

function asArray<T>(v: T | T[] | undefined | null): T[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

function parseDate(v: string | null): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Atom `<link>` can be one element or many with rel attributes. */
function atomLink(links: Node | Node[]): string | null {
  const arr = asArray(links) as Array<Record<string, unknown> | string>;
  let fallback: string | null = null;
  for (const l of arr) {
    if (typeof l === "string") return l;
    const href = l["@_href"];
    const rel = l["@_rel"];
    if (typeof href !== "string") continue;
    if (!rel || rel === "alternate") return href;
    fallback ??= href;
  }
  return fallback;
}

/** Parses RSS 2.0, RSS 1.0 (RDF) and Atom feeds into a common shape. */
export function parseFeed(xml: string): { title: string | null; items: ParsedFeedItem[] } {
  const doc = parser.parse(xml) as Record<string, unknown>;

  // Atom
  if (doc.feed && typeof doc.feed === "object") {
    const feed = doc.feed as Record<string, unknown>;
    const entries = asArray(feed.entry as Node[]) as Record<string, unknown>[];
    return {
      title: text(feed.title as Node),
      items: entries
        .map((e) => {
          const url = atomLink(e.link as Node);
          const id = text(e.id as Node) ?? url ?? "";
          const author = asArray(e.author as Node[])
            .map((a) => text((a as Record<string, unknown>)?.name as Node))
            .filter(Boolean)
            .join(", ");
          return {
            id,
            url: url ?? "",
            title: text(e.title as Node) ?? "",
            summary: text(e.summary as Node) ?? text(e.content as Node),
            author: author || null,
            publishedAt: parseDate(text(e.published as Node) ?? text(e.updated as Node)),
          };
        })
        .filter((i) => i.url && i.title),
    };
  }

  // RSS 2.0
  const rss = doc.rss as Record<string, unknown> | undefined;
  const channel = (rss?.channel ?? (doc["rdf:RDF"] as Record<string, unknown>)?.channel) as
    | Record<string, unknown>
    | undefined;
  const rdf = doc["rdf:RDF"] as Record<string, unknown> | undefined;
  const items = asArray((rss ? channel?.item : rdf?.item) as Node[]) as Record<string, unknown>[];
  return {
    title: text(channel?.title as Node),
    items: items
      .map((it) => {
        const url = text(it.link as Node) ?? text(it.guid as Node) ?? "";
        const guid = text(it.guid as Node) ?? url;
        const summary =
          text(it.description as Node) ??
          text(it["content:encoded"] as Node) ??
          text(it.summary as Node);
        return {
          id: guid,
          url,
          title: text(it.title as Node) ?? "",
          summary,
          author: text(it["dc:creator"] as Node) ?? text(it.author as Node),
          publishedAt: parseDate(
            text(it.pubDate as Node) ?? text(it["dc:date"] as Node) ?? text(it.published as Node),
          ),
        };
      })
      .filter((i) => i.url && i.title),
  };
}
