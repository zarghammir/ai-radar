import { describe, expect, it } from "vitest";
import { deriveVerification } from "./verification";

const openai = { sourceKey: "openai", sourceName: "OpenAI", tier: "PRIMARY" as const };
const reuters = {
  sourceKey: "reuters",
  sourceName: "Reuters",
  tier: "HIGH_QUALITY_REPORTING" as const,
};
const verge = {
  sourceKey: "verge",
  sourceName: "The Verge",
  tier: "HIGH_QUALITY_REPORTING" as const,
};
const hn = { sourceKey: "hn", sourceName: "Hacker News", tier: "COMMUNITY" as const };
const x = { sourceKey: "x", sourceName: "X", tier: "COMMUNITY" as const };

describe("deriveVerification", () => {
  it("primary source wins regardless of others", () => {
    expect(deriveVerification([hn, openai]).level).toBe("PRIMARY_SOURCE");
    expect(deriveVerification([openai]).note).toContain("OpenAI");
  });
  it("two established outlets corroborate", () => {
    expect(deriveVerification([reuters, verge]).level).toBe("CORROBORATED");
  });
  it("one outlet is emerging, not corroborated", () => {
    expect(deriveVerification([reuters]).level).toBe("EMERGING");
    expect(deriveVerification([reuters, hn]).level).toBe("EMERGING");
  });
  it("community chatter alone is unverified until it spreads", () => {
    expect(deriveVerification([hn]).level).toBe("UNVERIFIED");
    expect(deriveVerification([hn, x]).level).toBe("EMERGING");
  });
  it("counts distinct sources, not duplicate items", () => {
    expect(deriveVerification([reuters, reuters]).level).toBe("EMERGING");
  });
});

const wired = { sourceKey: "wired", sourceName: "Wired", tier: "HIGH_QUALITY_REPORTING" as const };
const arxiv = { sourceKey: "arxiv", sourceName: "arXiv", tier: "DISCOVERY" as const };

describe("deriveVerification invariants", () => {
  it("never corroborates a story carried by a single established outlet", () => {
    // However loudly one outlet repeats itself, it is still one outlet.
    expect(deriveVerification([reuters, reuters, reuters, reuters]).level).toBe("EMERGING");
    expect(deriveVerification([reuters, hn, x, arxiv]).level).toBe("EMERGING");
  });

  it("corroborates only when two distinct established outlets agree", () => {
    // The positive control for the assertion above.
    expect(deriveVerification([reuters, verge]).level).toBe("CORROBORATED");
    expect(deriveVerification([reuters, verge, wired]).level).toBe("CORROBORATED");
  });

  it("does not let community volume alone reach corroborated", () => {
    expect(deriveVerification([hn, x, arxiv]).level).toBe("EMERGING");
  });

  it("names every established outlet it claims corroboration from", () => {
    const r = deriveVerification([reuters, verge]);
    expect(r.note).toContain("Reuters");
    expect(r.note).toContain("The Verge");
  });

  it("does not invent a source when the cluster is empty", () => {
    const r = deriveVerification([]);
    expect(r.level).toBe("UNVERIFIED");
    expect(r.note).not.toContain("Single");
    expect(r.note.toLowerCase()).toContain("no source");
  });
});
