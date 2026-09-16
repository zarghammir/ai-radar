import { describe, expect, it } from "vitest";
import { canonicalizeUrl } from "./url";
import { stripHtml, truncate, slugify, readingMinutes } from "./text";
import { normalizeItem, fingerprintFor } from "./index";

describe("canonicalizeUrl", () => {
  it("drops tracking params, www, hash, trailing slash and sorts params", () => {
    expect(
      canonicalizeUrl("http://www.example.com/post/?utm_source=x&b=2&a=1#frag"),
    ).toBe("https://example.com/post?a=1&b=2");
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
    expect(normalizeItem({ externalId: "x", url: "", title: "t", publishedAt: null }, source)).toBeNull();
  });
  it("gives different sources different fingerprints for the same url", () => {
    expect(fingerprintFor("a", "https://e.com")).not.toBe(fingerprintFor("b", "https://e.com"));
  });
});
