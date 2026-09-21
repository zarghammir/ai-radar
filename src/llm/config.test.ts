import { describe, expect, it } from "vitest";
import { DEFAULT_MODELS, isPaidProvider, readLlmSettings } from "./config";

describe("readLlmSettings", () => {
  it("is disabled with an empty environment, naming the variable", () => {
    const settings = readLlmSettings({});
    expect(settings.enabled).toBe(false);
    if (!settings.enabled) expect(settings.reason).toMatch(/LLM_PROVIDER/);
  });

  it("is disabled for the documented default of none", () => {
    const settings = readLlmSettings({ LLM_PROVIDER: "none" });
    expect(settings.enabled).toBe(false);
  });

  // The point of the feature being optional: a key that is absent disables it
  // rather than throwing, or a worker with seventeen working feeds dies over
  // an enhancement.
  it("is disabled, not thrown, when anthropic is chosen without a key", () => {
    const settings = readLlmSettings({ LLM_PROVIDER: "anthropic" });
    expect(settings.enabled).toBe(false);
    if (!settings.enabled) expect(settings.reason).toContain("ANTHROPIC_API_KEY");
  });

  it("is disabled for an unrecognised provider and says what it was", () => {
    const settings = readLlmSettings({ LLM_PROVIDER: "antropic" });
    expect(settings.enabled).toBe(false);
    if (!settings.enabled) expect(settings.reason).toContain("antropic");
  });

  it("enables anthropic with a key and takes the default model", () => {
    const settings = readLlmSettings({ LLM_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "k" });
    expect(settings.enabled).toBe(true);
    if (settings.enabled) {
      expect(settings.config.provider).toBe("anthropic");
      expect(settings.config.model).toBe(DEFAULT_MODELS.anthropic);
    }
  });

  it("requires both halves of an openai-compatible endpoint", () => {
    const noKey = readLlmSettings({
      LLM_PROVIDER: "openai-compatible",
      OPENAI_COMPATIBLE_BASE_URL: "https://x/v1",
    });
    expect(noKey.enabled).toBe(false);
    if (!noKey.enabled) expect(noKey.reason).toContain("OPENAI_COMPATIBLE_API_KEY");

    const noUrl = readLlmSettings({
      LLM_PROVIDER: "openai-compatible",
      OPENAI_COMPATIBLE_API_KEY: "k",
    });
    expect(noUrl.enabled).toBe(false);
    if (!noUrl.enabled) expect(noUrl.reason).toContain("OPENAI_COMPATIBLE_BASE_URL");
  });

  it("enables a keyless local ollama", () => {
    const settings = readLlmSettings({ LLM_PROVIDER: "ollama" });
    expect(settings.enabled).toBe(true);
    if (settings.enabled) expect(settings.config.baseUrl).toContain("11434");
  });
});

describe("isPaidProvider", () => {
  it("counts the metered providers and not the local one", () => {
    expect(isPaidProvider("anthropic")).toBe(true);
    expect(isPaidProvider("openai-compatible")).toBe(true);
    expect(isPaidProvider("ollama")).toBe(false);
  });
});
