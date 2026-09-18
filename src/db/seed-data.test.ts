import { describe, expect, it } from "vitest";
import { CONTENT_TYPES, SOURCE_KINDS, SOURCE_TIERS } from "./schema";
import { SOURCE_SEEDS, TOPIC_SEEDS } from "./seed-data";
import { getAdapter } from "@/sources/registry";
import { deriveVerification } from "@/pipeline/clustering/verification";
import { rankStory } from "@/pipeline/ranking/score";

/**
 * The catalogue is data, and data can be wrong in ways the type system does not
 * see: a duplicate key silently drops a source in the upsert, a kind with no
 * adapter seeds a row nothing can ever read, and a feed URL left null makes the
 * rss adapter throw at fetch time rather than at seed time.
 */
describe("source catalogue", () => {
  it("has sources across every tier the product uses", () => {
    // NO SIZE FLOOR HERE, deliberately (#90). There was one — `>= 15`, a
    // number with no derivation, sitting in a test about TIERS. The tier
    // assertions below are the floor and they are derived from the property:
    // an emptied catalogue has no PRIMARY, so `tiers.has("PRIMARY")` fails on
    // its own. A size floor added nothing, and a floor that adds nothing is a
    // number somebody will one day adjust instead of reading.
    //
    // It also did not agree with the other floor on this same array, at
    // content-type.test.ts — and #90's title called that a disagreement to
    // reconcile. IT WAS NOT ONE. The two guarded different properties:
    // coverage there, tier representation here. Making them match would have
    // been making two unrelated numbers equal. Each is now derived from its
    // own failure, so there is no shared number left to drift.
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

  it("files the named expert newsletters under ANALYST", () => {
    const analysts = SOURCE_SEEDS.filter((s) => s.tier === "ANALYST")
      .map((s) => s.key)
      .sort();
    // import-ai was removed on 2026-09-17 (#38): Substack refuses datacenter
    // IPs, so it failed every hosted run. Two analysts is the floor for the
    // "two expert newsletters agreeing" case below to be writable at all — if
    // this list ever drops to one, that test cannot exist and the tier stops
    // being able to produce EMERGING on its own.
    expect(analysts).toEqual(["interconnects", "simon-willison"]);
  });

  it("keeps enough newsrooms for corroboration to stay reachable", () => {
    // ANALYST cannot supply corroboration on its own, so moving sources into it
    // must not leave fewer than two newsrooms behind.
    expect(
      SOURCE_SEEDS.filter((s) => s.tier === "HIGH_QUALITY_REPORTING").length,
    ).toBeGreaterThanOrEqual(2);
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

  it("marks every Hacker News source so a linked article is not labelled a discussion", () => {
    // The adapter sets DISCUSSION itself for self-posts; a DISCUSSION default
    // would mislabel every story that links out.
    //
    // Checks all of them rather than the first. There are two now — the front
    // page and Show HN — and a `find` would have gone on asserting this about
    // one source while the name claimed it about the feed.
    const hn = SOURCE_SEEDS.filter((s) => s.kind === "hackernews");
    expect(hn.length).toBeGreaterThanOrEqual(2);
    for (const s of hn) expect(s.defaultContentType, s.key).not.toBe("DISCUSSION");
  });

  it("points the two Hacker News sources at different lists", () => {
    // Same kind, same adapter, same API. The only thing that stops them being
    // two rows fetching one list is the config, so it is worth asserting:
    // identical lists would double every front-page story rather than fail.
    const lists = SOURCE_SEEDS.filter((s) => s.kind === "hackernews").map((s) => s.config?.list);
    expect(lists).toContain("top");
    expect(lists).toContain("show");
    expect(new Set(lists).size).toBe(lists.length);
  });

  it("puts Show HN on the label policy and leaves the front page gating", () => {
    // #107. The value, not merely that a config exists: the adapter gates on
    // anything that is not exactly "label", so a misspelling here is silent —
    // the ticket reads done while Show HN keeps discarding every non-AI post.
    const show = SOURCE_SEEDS.find((s) => s.config?.list === "show");
    expect(show?.config?.keywordPolicy).toBe("label");

    // And the other half, which is what stops this being "turn the gate off".
    // The front page is a general technology firehose; ungated it is the
    // unfiltered newspaper nobody asked for.
    const top = SOURCE_SEEDS.find((s) => s.config?.list === "top");
    expect(top?.config?.keywordPolicy).toBeUndefined();
  });

  it("files a Show HN launch as RELEASE, with a points floor measured for that list", () => {
    const show = SOURCE_SEEDS.find((s) => s.config?.list === "show");
    expect(show).toBeDefined();
    // RELEASE rather than DISCUSSION or a new content type: see the reasoning
    // recorded beside the seed. A debut is not a version bump, and that
    // imprecision is deliberate and cheaper than either alternative.
    expect(show!.defaultContentType).toBe("RELEASE");
    // Not the front page's 20. The live show list runs at a median of 4, so
    // inheriting 20 keeps under a quarter of it — a threshold calibrated for
    // one list silently empties another.
    expect(show!.config?.minPoints).toBe(3);
    const top = SOURCE_SEEDS.find((s) => s.config?.list === "top");
    expect(show!.config?.minPoints).not.toBe(top!.config?.minPoints);
  });

  it("gives first-party sources a default topic that resolves to a real topic", () => {
    // A primary source with a vague headline ("Introducing our new model")
    // matches no keyword, so without this it carries no company topic at all.
    const withDefaults = SOURCE_SEEDS.filter((s) => (s.config?.topicKeys as string[])?.length);
    // Floor: every assertion below passes on an empty list.
    expect(withDefaults.length).toBeGreaterThanOrEqual(6);

    const known = new Set(TOPIC_SEEDS.map((t) => t.key));
    for (const s of withDefaults) {
      for (const key of s.config!.topicKeys as string[]) {
        expect(known.has(key), `${s.key} defaults to unknown topic "${key}"`).toBe(true);
      }
    }
  });

  it("only gives defaults to sources that speak for one organisation", () => {
    // An outlet reports on everyone, so a default topic there would tag every
    // story it files with whoever the outlet happens to be about.
    for (const s of SOURCE_SEEDS) {
      const defaults = (s.config?.topicKeys as string[]) ?? [];
      if (s.tier === "PRIMARY" && s.kind === "rss") continue;
      expect(
        defaults,
        `${s.key} is not a first-party source and must carry no default topic`,
      ).toEqual([]);
    }
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

describe("the shipped catalogue produces the badges the product promises", () => {
  // The rules are unit-tested against synthetic sources elsewhere. This runs
  // them against the rows that actually ship, so a tier typo in the catalogue
  // shows up as a wrong badge rather than as a passing unit test.
  const item = (key: string) => {
    const s = SOURCE_SEEDS.find((x) => x.key === key);
    if (!s) throw new Error(`catalogue has no source "${key}"`);
    return { sourceKey: s.key, sourceName: s.name, tier: s.tier };
  };

  it("two expert newsletters agreeing is emerging, and names them", () => {
    const r = deriveVerification([item("simon-willison"), item("interconnects")]);
    expect(r.level).toBe("EMERGING");
    expect(r.note).toContain("Simon Willison");
    expect(r.note).toContain("Interconnects");
  });

  it("a newsroom plus an expert newsletter is corroborated", () => {
    const r = deriveVerification([item("ars-technica-ai"), item("interconnects")]);
    expect(r.level).toBe("CORROBORATED");
  });

  it("two newsrooms are corroborated", () => {
    expect(deriveVerification([item("verge-ai"), item("wired-ai")]).level).toBe("CORROBORATED");
  });

  it("a lab publishing its own work is a primary source", () => {
    expect(deriveVerification([item("openai-blog"), item("techcrunch-ai")]).level).toBe(
      "PRIMARY_SOURCE",
    );
  });

  it("ranks a shipped analyst source between a shipped newsroom and Hacker News", () => {
    const now = new Date("2026-09-16T12:00:00Z");
    const score = (key: string) => {
      const s = item(key);
      return rankStory(
        {
          lastActivityAt: new Date("2026-09-16T11:00:00Z"),
          contentType: "NEWS",
          sources: [{ sourceKey: s.sourceKey, tier: s.tier }],
          // Held constant so this measures the tier difference and nothing
          // else; the verification penalty has its own tests.
          verification: "CORROBORATED",
          topicKeys: [],
          userTopicKeys: [],
        },
        now,
      ).score;
    };
    expect(score("interconnects")).toBeLessThan(score("verge-ai"));
    expect(score("interconnects")).toBeGreaterThan(score("hackernews-ai"));
  });
});
