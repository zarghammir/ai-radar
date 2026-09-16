import { describe, expect, it } from "vitest";
import { tokenize, entities, titleSimilarity, isSameStory } from "./similarity";

describe("tokenize / entities", () => {
  it("removes stopwords and keeps model names", () => {
    expect(tokenize("OpenAI announces the GPT-6 model today")).toEqual([
      "openai",
      "gpt-6",
      "model",
    ]);
  });
  it("extracts entities", () => {
    const e = entities("Anthropic releases Claude Opus 5 with 1M context");
    expect(e.has("claude")).toBe(true);
    expect(e.has("opus")).toBe(true);
    expect(e.has("5")).toBe(true);
    expect(e.has("1m")).toBe(true);
    expect(e.has("releases")).toBe(false);
  });
});

describe("isSameStory", () => {
  it("matches the same development reported with different headlines", () => {
    expect(
      isSameStory(
        "OpenAI launches GPT-6, its most capable model yet",
        "GPT-6 is here: OpenAI's new flagship model explained",
      ),
    ).toBe(true);
    expect(
      isSameStory(
        "Anthropic releases Claude Opus 5",
        "Anthropic's Claude Opus 5 arrives with a 1M context window",
      ),
    ).toBe(true);
  });
  it("does not merge different stories about the same company", () => {
    expect(isSameStory("OpenAI hires a new CFO", "OpenAI launches GPT-6")).toBe(false);
    expect(
      isSameStory(
        "Nvidia reports record quarterly revenue",
        "Nvidia unveils Rubin GPU architecture",
      ),
    ).toBe(false);
  });
  it("does not merge unrelated titles", () => {
    expect(isSameStory("Show HN: I built a Rust game engine", "Meta AI open-sources Llama 5")).toBe(
      false,
    );
    expect(titleSimilarity("", "anything").score).toBe(0);
  });
});
