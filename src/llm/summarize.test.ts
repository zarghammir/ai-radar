import { describe, expect, it } from "vitest";
import {
  buildPrompt,
  extractJson,
  MAX_ITEMS_IN_PROMPT,
  parseSummary,
  UnusableSummaryError,
} from "./summarize";

const good = JSON.stringify({
  summary: "A model was released.",
  whyItMatters: "It is cheaper than the last one.",
  keyPoints: ["Cheaper", "Faster"],
});

describe("extractJson", () => {
  it("finds a bare object", () => {
    expect(extractJson('{"a":1}')).toBe('{"a":1}');
  });

  it("finds one wrapped in a code fence and prose", () => {
    expect(extractJson('Sure!\n```json\n{"a":1}\n```\nHope that helps')).toBe('{"a":1}');
  });

  // A non-greedy regex stops at the first closing brace and truncates the
  // object; this is the case that distinguishes a balanced scan from one.
  it("keeps a nested object whole", () => {
    expect(extractJson('text {"a":{"b":2},"c":3} tail')).toBe('{"a":{"b":2},"c":3}');
  });

  it("is not fooled by a brace inside a string", () => {
    expect(extractJson('{"a":"}"}')).toBe('{"a":"}"}');
  });

  it("returns null when there is no object at all", () => {
    expect(extractJson("I am afraid I cannot help with that.")).toBeNull();
  });
});

describe("parseSummary", () => {
  it("accepts a well-formed reply", () => {
    const parsed = parseSummary(good);
    expect(parsed.summary).toBe("A model was released.");
    expect(parsed.keyPoints).toHaveLength(2);
  });

  it("accepts one wrapped in prose, because that is formatting, not rubbish", () => {
    expect(parseSummary("Here you go:\n" + good).whyItMatters).toContain("cheaper");
  });

  // Each of these used to be a way of writing an empty or half-built row into
  // stories.summary and calling it a success.
  it.each([
    ["prose with no JSON", "The story is about a model release."],
    ["malformed JSON", '{"summary": "x", '],
    ["an empty object", "{}"],
    ["a missing field", '{"summary":"x","whyItMatters":"y"}'],
    ["an empty summary", '{"summary":"","whyItMatters":"y","keyPoints":["z"]}'],
    ["a whitespace summary", '{"summary":"   ","whyItMatters":"y","keyPoints":["z"]}'],
    ["no key points", '{"summary":"x","whyItMatters":"y","keyPoints":[]}'],
    ["key points of the wrong type", '{"summary":"x","whyItMatters":"y","keyPoints":[1,2]}'],
  ])("rejects %s", (_label, reply) => {
    expect(() => parseSummary(reply)).toThrow(UnusableSummaryError);
  });

  it("rejects a summary longer than the column is meant to hold", () => {
    const huge = JSON.stringify({
      summary: "x".repeat(5000),
      whyItMatters: "y",
      keyPoints: ["z"],
    });
    expect(() => parseSummary(huge)).toThrow(UnusableSummaryError);
  });
});

describe("buildPrompt", () => {
  const story = {
    id: 1,
    title: "Acme ships a model",
    items: Array.from({ length: 12 }, (_, i) => ({
      title: `Report ${i}`,
      excerpt: "e".repeat(2000),
      sourceName: `Source ${i}`,
    })),
  };

  it("caps how many reports it pays to send", () => {
    const prompt = buildPrompt(story);
    expect(prompt).toContain("Report 0");
    expect(prompt).not.toContain(`Report ${MAX_ITEMS_IN_PROMPT}`);
  });

  // The bill is set by the prompt, so a single pathological feed must not be
  // able to set it. Without the clip this prompt is 24,000 characters.
  it("clips a runaway excerpt so one feed cannot set the bill", () => {
    expect(buildPrompt(story).length).toBeLessThan(6000);
  });

  it("survives an item with no excerpt", () => {
    const prompt = buildPrompt({
      id: 2,
      title: "t",
      items: [{ title: "a", excerpt: null, sourceName: "S" }],
    });
    expect(prompt).toContain("(no excerpt)");
  });
});
