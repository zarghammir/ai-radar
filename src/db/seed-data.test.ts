import { describe, expect, it } from "vitest";
import { CONTENT_TYPES, SOURCE_KINDS, SOURCE_TIERS } from "./schema";
import { SOURCE_SEEDS, TOPIC_SEEDS } from "./seed-data";
import { getAdapter } from "@/sources/registry";

/**
 * The catalogue is data, and data can be wrong in ways the type system does not
 * see: a duplicate key silently drops a source in the upsert, a kind with no
 * adapter seeds a row nothing can ever read, and a feed URL left null makes the
 * rss adapter throw at fetch time rather than at seed time.
 */
describe("source catalogue", () => {
  it("has sources across every tier the product uses", () => {
    expect(SOURCE_SEEDS.length).toBeGreaterThanOrEqual(15);
    const tiers = new Set(SOURCE_SEEDS.map((s) => s.tier));
    expect(tiers.has("PRIMARY")).toBe(true);
    expect(tiers.has("HIGH_QUALITY_REPORTING")).toBe(true);
    expect(tiers.has("COMMUNITY")).toBe(true);
    // Two distinct established outlets is what CORROBORATED needs to be
    // reachable at all; one would make the level dead on arrival.
    expect(
      SOURCE_SEEDS.filter((s) => s.tier === "HIGH_QUALITY_REPORTING").length,
    ).toBeGreaterThanOrEqual(2);
  });

  it("uses unique keys", () => {
    const keys = SOURCE_SEEDS.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("only names tiers, kinds and content types the schema declares", () => {
    for (const s of SOURCE_SEEDS) {
      expect(SOURCE_TIERS).toContain(s.tier);
      expect(SOURCE_KINDS).toContain(s.kind);
      expect(CONTENT_TYPES).toContain(s.defaultContentType);
    }
  });

  it("registers an adapter for every kind it seeds", () => {
    for (const s of SOURCE_SEEDS) {
      expect(getAdapter(s.kind), `no adapter for ${s.key} (kind ${s.kind})`).toBeDefined();
    }
  });

  it("gives every feed-backed source a url and every api-backed source none", () => {
    for (const s of SOURCE_SEEDS) {
      if (s.kind === "rss") {
        expect(s.url, `${s.key} needs a feed url`).toBeTruthy();
        expect(s.url!).toMatch(/^https:\/\//);
      } else {
        expect(s.url, `${s.key} is api-backed and must not carry a feed url`).toBeNull();
      }
      expect(s.homepage).toMatch(/^https:\/\//);
    }
  });

  it("marks Hacker News so that a linked article is not labelled a discussion", () => {
    // The adapter sets DISCUSSION itself for self-posts; a DISCUSSION default
    // would mislabel every story that links out.
    const hn = SOURCE_SEEDS.find((s) => s.kind === "hackernews");
    expect(hn).toBeDefined();
    expect(hn!.defaultContentType).not.toBe("DISCUSSION");
  });

  it("asks arXiv for the AI categories the brief names", () => {
    const arxiv = SOURCE_SEEDS.find((s) => s.kind === "arxiv");
    expect(arxiv).toBeDefined();
    expect(arxiv!.config?.categories).toEqual([
      "cs.AI",
      "cs.LG",
      "cs.CL",
      "cs.CV",
      "cs.RO",
      "stat.ML",
    ]);
  });
});

describe("topic catalogue", () => {
  it("covers all three groups", () => {
    expect(TOPIC_SEEDS.length).toBeGreaterThanOrEqual(20);
    const groups = new Set(TOPIC_SEEDS.map((t) => t.group));
    expect([...groups].sort()).toEqual(["company", "domain", "field"]);
  });

  it("uses unique keys", () => {
    const keys = TOPIC_SEEDS.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("gives every topic usable keywords", () => {
    for (const t of TOPIC_SEEDS) {
      expect(t.keywords.length, `${t.key} has no keywords`).toBeGreaterThan(0);
      for (const k of t.keywords) {
        // Matching is done against lower-cased text, so a capital here would
        // simply never match anything.
        expect(k, `${t.key}: "${k}" must be lower case`).toBe(k.toLowerCase());
        expect(k, `${t.key}: "${k}" must be trimmed`).toBe(k.trim());
        expect(k.length).toBeGreaterThan(1);
      }
      expect(new Set(t.keywords).size, `${t.key} repeats a keyword`).toBe(t.keywords.length);
    }
  });

  it("does not give two topics in the same group the same keyword", () => {
    // Across groups a shared keyword is the point: a Copilot story is both the
    // Microsoft company topic and the coding domain topic, and story_topics is
    // many-to-many. Within one group it is an error — a keyword must not claim
    // to identify two different companies, or two different fields.
    const clashes: string[] = [];
    for (const group of ["company", "domain", "field"] as const) {
      const seen = new Map<string, string>();
      for (const t of TOPIC_SEEDS.filter((x) => x.group === group)) {
        for (const k of t.keywords) {
          const owner = seen.get(k);
          if (owner) clashes.push(`${group}: "${k}" in both ${owner} and ${t.key}`);
          else seen.set(k, t.key);
        }
      }
    }
    expect(clashes).toEqual([]);
  });

  it("tags a story that spans a company and a domain with both", () => {
    // The positive control for the rule above: cross-group overlap must exist,
    // or the rule is only describing a catalogue that never overlaps anyway.
    const company = TOPIC_SEEDS.filter((t) => t.group === "company").flatMap((t) => t.keywords);
    const domain = TOPIC_SEEDS.filter((t) => t.group === "domain").flatMap((t) => t.keywords);
    expect(company.filter((k) => domain.includes(k)).length).toBeGreaterThan(0);
  });
});
