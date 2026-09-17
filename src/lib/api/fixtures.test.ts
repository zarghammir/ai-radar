import { describe, expect, it } from "vitest";
import {
  FIXTURE_STORIES,
  fixtureBrief,
  fixtureEmptyBrief,
  fixtureQuietBrief,
} from "@/lib/api/fixtures";
import { alsoReportedBy, storyBody } from "@/lib/api/labels";
import { deriveVerification } from "@/pipeline/clustering/verification";
import { readingMinutes } from "@/pipeline/normalize/text";

/**
 * A floor on the fixtures. Without it someone tidies away the uncomfortable
 * story and every screen test still passes, having only ever been run against a
 * full healthy brief — which is the page nobody has seen.
 */
describe("the awkward cases are present", () => {
  it("keeps an UNVERIFIED story in the brief, labelled rather than dropped", () => {
    const unverified = FIXTURE_STORIES.filter((s) => s.verification === "UNVERIFIED");
    expect(unverified.length).toBeGreaterThan(0);
    // The owner's ruling: allowed, but it must not outrank confirmed stories.
    const best = Math.max(...FIXTURE_STORIES.map((s) => s.score));
    expect(Math.max(...unverified.map((s) => s.score))).toBeLessThan(best);
  });

  it("keeps a story whose only source is one outlet that filed twice", () => {
    const single = FIXTURE_STORIES.filter((s) => s.sourceCount === 1);
    expect(single.length).toBeGreaterThan(0);
    for (const s of single) {
      expect(s.sources.length).toBe(1);
      // The point of the case: no "+0 others" line.
      expect(alsoReportedBy(s)).toBeNull();
    }
  });

  it("keeps an analyst-only story, with no newsroom among its sources", () => {
    const analystOnly = FIXTURE_STORIES.filter(
      (s) =>
        s.sources.length > 1 && s.sources.every((src) => src.tier !== "HIGH_QUALITY_REPORTING"),
    );
    expect(analystOnly.length).toBeGreaterThan(0);
    // Analysts agreeing is weaker than newsrooms agreeing.
    for (const s of analystOnly) expect(s.verification).not.toBe("CORROBORATED");
  });

  it("gives every story a null summary, which is Phase 1 reality", () => {
    for (const s of FIXTURE_STORIES) {
      expect(s.summary).toBeNull();
      expect(s.whyItMatters).toBeNull();
      // So the card still has something to render — via the excerpt fallback.
      expect(storyBody(s)).not.toBeNull();
    }
  });

  it("covers more than one content type and more than one verification level", () => {
    expect(new Set(FIXTURE_STORIES.map((s) => s.contentType)).size).toBeGreaterThan(2);
    expect(new Set(FIXTURE_STORIES.map((s) => s.verification)).size).toBeGreaterThan(2);
  });
});

describe("fixtureBrief treats length as a reading-minute budget", () => {
  it("returns every story for 'all'", () => {
    const all = fixtureBrief("all");
    expect(all.stories.length).toBe(FIXTURE_STORIES.length);
    expect(all.count).toBe(all.stories.length);
  });

  it("returns fewer stories as the budget shrinks", () => {
    const five = fixtureBrief("5").stories.length;
    const ten = fixtureBrief("10").stories.length;
    const all = fixtureBrief("all").stories.length;
    expect(five).toBeLessThan(ten);
    // NOT strictly fewer: every fixture story is one minute, because that is
    // what readingMinutes() computes from a two-sentence excerpt. Six
    // one-minute stories all fit inside ten minutes, so the ten-minute brief
    // IS the whole brief here. An earlier version asserted ten < all and
    // passed only because the fixtures overstated reading time as article
    // time — the assertion was true about numbers the product never produces.
    expect(ten).toBeLessThanOrEqual(all);
    expect(five).toBeLessThan(all);
  });

  it("keeps the five-minute brief inside its budget", () => {
    const five = fixtureBrief("5");
    expect(five.readingMinutes).toBeLessThanOrEqual(5);
  });

  it("ranks by score, highest first", () => {
    const scores = fixtureBrief("all").stories.map((s) => s.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });

  it("always returns at least one story when the window has any", () => {
    // Even if the top story alone exceeded the budget, dropping to zero would
    // show an empty brief on a day that had news.
    expect(fixtureBrief("5").stories.length).toBeGreaterThan(0);
  });

  it("reports count and readingMinutes that describe the response, not the window", () => {
    for (const length of ["5", "10", "all"] as const) {
      const b = fixtureBrief(length);
      expect(b.count).toBe(b.stories.length);
      expect(b.readingMinutes).toBe(b.stories.reduce((t, s) => t + s.readingMinutes, 0));
    }
  });
});

describe("the thin days", () => {
  it("has a quiet day that is real but short", () => {
    const quiet = fixtureQuietBrief();
    expect(quiet.stories.length).toBe(1);
    expect(quiet.count).toBe(1);
  });

  it("has an empty day whose counts are zero rather than absent", () => {
    const empty = fixtureEmptyBrief();
    expect(empty.stories).toEqual([]);
    expect(empty.count).toBe(0);
    expect(empty.readingMinutes).toBe(0);
    // The window still exists on an empty day; the reader is told when it ran.
    expect(empty.window.briefTime).toBeTruthy();
  });
});

/**
 * The fixtures must describe states the product can actually reach. Without
 * this, a fixture can assert a combination the pipeline would never produce —
 * and the screens, the browser job and the screenshots would all be built
 * against a story that cannot exist. Two of these fixtures were exactly that
 * until this test was written.
 */
describe("fixtures are states the pipeline can actually produce", () => {
  it("derives each fixture's verification from its own sources", () => {
    const mismatches = FIXTURE_STORIES.filter((s) => {
      const derived = deriveVerification(
        s.sources.map((src) => ({ sourceKey: src.key, sourceName: src.name, tier: src.tier })),
      );
      return derived.level !== s.verification;
    }).map((s) => `${s.slug}: fixture says ${s.verification}`);
    expect(mismatches).toEqual([]);
  });

  it("keeps sourceCount equal to the number of distinct sources", () => {
    for (const s of FIXTURE_STORIES) {
      expect(s.sourceCount, s.slug).toBe(new Set(s.sources.map((x) => x.key)).size);
    }
  });

  it("names the primary source among the story's own sources", () => {
    for (const s of FIXTURE_STORIES) {
      expect(
        s.sources.map((x) => x.key),
        s.slug,
      ).toContain(s.primarySource.key);
    }
  });
});

/**
 * readingMinutes is COMPUTED by the pipeline from the story's summary or
 * excerpt at 220 words a minute — not the time to read the original article.
 * These fixtures originally carried 3-6 minutes, which is article time, and
 * that made the reading-length switch look far more aggressive than it is: a
 * ten-minute brief held two stories instead of all six.
 */
describe("fixture reading times are what the pipeline would compute", () => {
  it("matches readingMinutes() over each story's own body text", () => {
    const wrong = FIXTURE_STORIES.filter(
      (s) => s.readingMinutes !== readingMinutes([s.summary ?? s.excerpt ?? ""]),
    ).map(
      (s) =>
        `${s.slug}: fixture ${s.readingMinutes}, computed ${readingMinutes([s.summary ?? s.excerpt ?? ""])}`,
    );
    expect(wrong).toEqual([]);
  });
});
