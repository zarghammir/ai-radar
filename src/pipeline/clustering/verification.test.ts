import { describe, expect, it } from "vitest";
import { deriveVerification } from "./verification";

const openai = { sourceKey: "openai", sourceName: "OpenAI", tier: "PRIMARY" as const };
const reuters = { sourceKey: "reuters", sourceName: "Reuters", tier: "HIGH_QUALITY_REPORTING" as const };
const verge = { sourceKey: "verge", sourceName: "The Verge", tier: "HIGH_QUALITY_REPORTING" as const };
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
