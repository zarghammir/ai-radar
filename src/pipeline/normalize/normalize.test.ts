import { describe, expect, it } from "vitest";
import { canonicalizeUrl } from "./url";
import { stripHtml, truncate, slugify, readingMinutes } from "./text";
import { normalizeItem, fingerprintFor, EXCERPT_MAX } from "./index";

describe("canonicalizeUrl", () => {
  it("drops tracking params, www, hash, trailing slash and sorts params", () => {
    expect(canonicalizeUrl("http://www.example.com/post/?utm_source=x&b=2&a=1#frag")).toBe(
      "https://example.com/post?a=1&b=2",
    );
  });
  it("unifies arXiv abs/pdf and strips versions", () => {
    const a = canonicalizeUrl("https://arxiv.org/abs/2509.01234v2");
    const b = canonicalizeUrl("http://arxiv.org/pdf/2509.01234v1.pdf");
    const c = canonicalizeUrl("https://arxiv.org/html/2509.01234");
    expect(a).toBe("https://arxiv.org/abs/2509.01234");
    expect(b).toBe(a);
    expect(c).toBe(a);
  });
  it("maps twitter to x.com", () => {
    expect(canonicalizeUrl("https://twitter.com/openai/status/1?s=20")).toBe(
      "https://x.com/openai/status/1",
    );
  });
  it("returns garbage unchanged", () => {
    expect(canonicalizeUrl("not a url")).toBe("not a url");
  });
});

describe("text helpers", () => {
  it("strips html and decodes entities", () => {
    expect(stripHtml("<p>Hello &amp; <b>world</b>&nbsp;&#8217;</p>")).toBe("Hello & world ’");
  });
  it("truncates on a word boundary", () => {
    expect(truncate("the quick brown fox jumps", 15)).toBe("the quick brown…");
    expect(truncate("short", 15)).toBe("short");
  });
  it("slugifies", () => {
    expect(slugify("OpenAI releases GPT-6: what's new?")).toBe("openai-releases-gpt-6-what-s-new");
  });
  it("estimates reading time with a floor of one minute", () => {
    expect(readingMinutes(["a b c"])).toBe(1);
    expect(readingMinutes([Array(660).fill("w").join(" ")])).toBe(3);
  });
});

describe("normalizeItem", () => {
  const source = { id: 1, key: "test", defaultContentType: "NEWS" as const };
  it("builds a row with canonical url, excerpt and fingerprint", () => {
    const now = new Date("2026-09-16T10:00:00Z");
    const row = normalizeItem(
      {
        externalId: "g1",
        url: "https://www.example.com/a?utm_medium=rss",
        title: "  Big   release ",
        excerpt: "<p>Some <i>html</i></p>",
        publishedAt: new Date("2026-09-16T09:00:00Z"),
      },
      source,
      now,
    );
    expect(row).not.toBeNull();
    expect(row!.canonicalUrl).toBe("https://example.com/a");
    expect(row!.title).toBe("Big release");
    expect(row!.excerpt).toBe("Some html");
    expect(row!.contentType).toBe("NEWS");
    expect(row!.fingerprint).toBe(fingerprintFor("test", "https://example.com/a"));
  });
  it("clamps future dates and rejects empty items", () => {
    const now = new Date("2026-09-16T10:00:00Z");
    const row = normalizeItem(
      { externalId: "x", url: "https://e.com/x", title: "t", publishedAt: new Date("2030-01-01") },
      source,
      now,
    );
    expect(row!.publishedAt).toEqual(now);
    expect(
      normalizeItem({ externalId: "x", url: "", title: "t", publishedAt: null }, source),
    ).toBeNull();
  });
  it("gives different sources different fingerprints for the same url", () => {
    expect(fingerprintFor("a", "https://e.com")).not.toBe(fingerprintFor("b", "https://e.com"));
  });
});

describe("normalizeItem date guarding", () => {
  const source = { id: 1, key: "test", defaultContentType: "NEWS" as const };
  const now = new Date("2026-09-16T10:00:00Z");

  it("falls back to now when the feed date is unparseable", () => {
    const row = normalizeItem(
      {
        externalId: "x",
        url: "https://e.com/x",
        title: "t",
        publishedAt: new Date("definitely not a date"),
      },
      source,
      now,
    );
    expect(row).not.toBeNull();
    expect(Number.isNaN(row!.publishedAt.getTime())).toBe(false);
    expect(row!.publishedAt).toEqual(now);
  });

  it("keeps a valid past date untouched", () => {
    const published = new Date("2026-09-15T08:00:00Z");
    const row = normalizeItem(
      { externalId: "x", url: "https://e.com/x", title: "t", publishedAt: published },
      source,
      now,
    );
    expect(row!.publishedAt).toEqual(published);
  });
});

describe("cross-source identity", () => {
  const now = new Date("2026-09-16T10:00:00Z");
  const blog = { id: 1, key: "openai-blog", defaultContentType: "RELEASE" as const };
  const news = { id: 2, key: "verge", defaultContentType: "NEWS" as const };

  it("collapses the same article to one canonical url but keeps one row per source", () => {
    // Clustering counts distinct sources, so these must agree on the canonical
    // url and disagree on the fingerprint. If the fingerprints matched, the
    // unique index would drop the second source and corroboration would vanish.
    const a = normalizeItem(
      {
        externalId: "a1",
        url: "https://www.example.com/post/?utm_source=hn",
        title: "Model released",
        publishedAt: now,
      },
      blog,
      now,
    );
    const b = normalizeItem(
      {
        externalId: "b1",
        url: "http://example.com/post",
        title: "Model released",
        publishedAt: now,
      },
      news,
      now,
    );
    expect(a!.canonicalUrl).toBe(b!.canonicalUrl);
    expect(a!.fingerprint).not.toBe(b!.fingerprint);
  });

  it("takes the content type from the source when the adapter does not set one", () => {
    const a = normalizeItem(
      { externalId: "a", url: "https://e.com/a", title: "t", publishedAt: now },
      blog,
      now,
    );
    expect(a!.contentType).toBe("RELEASE");
  });

  it("lets an adapter override the source default", () => {
    const a = normalizeItem(
      {
        externalId: "a",
        url: "https://e.com/a",
        title: "t",
        publishedAt: now,
        contentType: "PAPER",
      },
      blog,
      now,
    );
    expect(a!.contentType).toBe("PAPER");
  });

  it("strips html from the excerpt and truncates it to the cap", () => {
    const long = `<p>${"word ".repeat(400)}</p>`;
    const a = normalizeItem(
      { externalId: "a", url: "https://e.com/a", title: "t", excerpt: long, publishedAt: now },
      blog,
      now,
    );
    expect(a!.excerpt!).not.toContain("<p>");
    expect(a!.excerpt!.length).toBeLessThanOrEqual(EXCERPT_MAX + 1);
    expect(a!.excerpt!.endsWith("…")).toBe(true);
  });
});
