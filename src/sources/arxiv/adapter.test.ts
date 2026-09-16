import { describe, expect, it } from "vitest";
import type { Source } from "@/db/schema";
import type { FetchContext } from "../types";
import { arxivAdapter, arxivIdFromUrl } from "./adapter";

/**
 * Entry 1 has several <link> elements; entry 2 has exactly one, which
 * fast-xml-parser hands back as a bare object rather than an array.
 */
const FEED = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>http://arxiv.org/abs/2509.01234v2</id>
    <title>A   Study   of
    Scaling Laws</title>
    <summary>We study   scaling.</summary>
    <published>2026-09-15T10:00:00Z</published>
    <updated>2026-09-16T10:00:00Z</updated>
    <author><name>Ada Lovelace</name></author>
    <author><name>Alan Turing</name></author>
    <link href="http://arxiv.org/abs/2509.01234v2" rel="alternate" type="text/html"/>
    <link title="pdf" href="http://arxiv.org/pdf/2509.01234v2" rel="related" type="application/pdf"/>
    <category term="cs.LG"/>
    <category term="cs.AI"/>
    <arxiv:primary_category xmlns:arxiv="http://arxiv.org/schemas/atom" term="cs.LG"/>
  </entry>
  <entry>
    <id>http://arxiv.org/abs/2509.05555v1</id>
    <title>Single Link Paper</title>
    <summary>Short.</summary>
    <published>2026-09-14T10:00:00Z</published>
    <updated>2026-09-14T10:00:00Z</updated>
    <author><name>Grace Hopper</name></author>
    <link href="http://arxiv.org/abs/2509.05555v1" rel="alternate" type="text/html"/>
    <category term="cs.CL"/>
  </entry>
  <entry>
    <id>urn:arxiv:2509.07777</id>
    <title>Id Differs From Link</title>
    <summary>Short.</summary>
    <published>2026-09-13T10:00:00Z</published>
    <updated>2026-09-13T10:00:00Z</updated>
    <author><name>Katherine Johnson</name></author>
    <link href="http://arxiv.org/abs/2509.07777v1" rel="alternate" type="text/html"/>
    <category term="cs.CV"/>
  </entry>
</feed>`;

function sourceWith(config: Record<string, unknown>): Source {
  return {
    id: 2,
    key: "arxiv",
    name: "arXiv",
    kind: "arxiv",
    tier: "PRIMARY",
    url: null,
    homepage: "https://arxiv.org",
    enabled: true,
    config,
    defaultContentType: "PAPER",
    lastFetchedAt: null,
    lastError: null,
    createdAt: new Date("2026-09-16T00:00:00Z"),
  } as Source;
}

function contextCapturing(xml: string) {
  const urls: string[] = [];
  const logged: string[] = [];
  const ctx: FetchContext = {
    since: new Date("2026-09-01T00:00:00Z"),
    fetch: (async (input: string | URL | Request) => {
      urls.push(String(input));
      return { ok: true, status: 200, text: async () => xml } as Response;
    }) as unknown as typeof fetch,
    log: (m) => logged.push(m),
  };
  return { ctx, urls, logged };
}

describe("arxivIdFromUrl", () => {
  it("strips the version suffix", () => {
    expect(arxivIdFromUrl("http://arxiv.org/abs/2509.01234v2")).toBe("2509.01234");
    expect(arxivIdFromUrl("http://arxiv.org/abs/2509.01234")).toBe("2509.01234");
  });
});

describe("arxivAdapter", () => {
  it("queries the configured categories and result cap", async () => {
    const { ctx, urls } = contextCapturing(FEED);
    await arxivAdapter.fetch(sourceWith({ categories: ["cs.AI", "cs.CL"], maxResults: 5 }), ctx);
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain("search_query=cat:cs.AI+OR+cat:cs.CL");
    expect(urls[0]).toContain("max_results=5");
  });

  it("picks the abstract link and the pdf link when an entry has several", async () => {
    const { ctx } = contextCapturing(FEED);
    const out = await arxivAdapter.fetch(sourceWith({}), ctx);
    expect(out[0].url).toBe("https://arxiv.org/abs/2509.01234v2");
    expect(out[0].metadata?.pdfUrl).toBe("http://arxiv.org/pdf/2509.01234v2");
  });

  it("reads the href when an entry has exactly one link element", async () => {
    const { ctx } = contextCapturing(FEED);
    const out = await arxivAdapter.fetch(sourceWith({}), ctx);
    expect(out[1].url).toBe("https://arxiv.org/abs/2509.05555v1");
    expect(out[1].metadata?.pdfUrl).toBeNull();
    // Entry 3's id is deliberately not its link, so reading the single <link>
    // is the only way to get this value: the `?? e.id` fallback would not.
    expect(out[2].url).toBe("https://arxiv.org/abs/2509.07777v1");
  });

  it("collapses whitespace in titles and always reports PAPER", async () => {
    const { ctx } = contextCapturing(FEED);
    const out = await arxivAdapter.fetch(sourceWith({}), ctx);
    expect(out[0].title).toBe("A Study of Scaling Laws");
    expect(out.every((i) => i.contentType === "PAPER")).toBe(true);
  });

  it("keeps every author in metadata and the external id free of the version", async () => {
    const { ctx } = contextCapturing(FEED);
    const out = await arxivAdapter.fetch(sourceWith({}), ctx);
    expect(out[0].externalId).toBe("2509.01234");
    expect(out[0].metadata?.authors).toEqual(["Ada Lovelace", "Alan Turing"]);
    expect(out[0].author).toBe("Ada Lovelace, Alan Turing");
  });
});
