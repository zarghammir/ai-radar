/**
 * What the environment says about summarising, or nothing at all.
 *
 * READING THIS NEVER THROWS, and that is the whole design. Summaries are an
 * enhancement: `LLM_PROVIDER=none`, a missing key, a typo in the provider name
 * — every one of them means "no summaries today" and none of them may stop a
 * worker that still has seventeen feeds to collect. The brief is useful
 * without summaries; it is useless if the pass dies before it runs.
 *
 * So the return type is `LlmConfig | null` and the REASON travels with the
 * null. A worker that logs "disabled: LLM_PROVIDER is none" and one that logs
 * "disabled: ANTHROPIC_API_KEY is not set" are two different operator actions,
 * and a bare null cannot tell them apart — that is the absent-versus-failed
 * family, one layer up from the stories.
 */

/** Providers this app knows how to call. `none` is the documented default. */
export const LLM_PROVIDERS = ["none", "ollama", "anthropic", "openai-compatible"] as const;
export type LlmProvider = (typeof LLM_PROVIDERS)[number];

/** Model used when the operator names a provider but no model. */
export const DEFAULT_MODELS: Record<Exclude<LlmProvider, "none">, string> = {
  anthropic: "claude-haiku-4-5",
  "openai-compatible": "llama-3.3-70b-versatile",
  ollama: "llama3.2",
};

export const DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434";

export type LlmEnv = Partial<Record<string, string>>;

export interface LlmConfig {
  provider: Exclude<LlmProvider, "none">;
  model: string;
  /** Present for anthropic and openai-compatible; absent for a local ollama. */
  apiKey?: string;
  /** Present for openai-compatible and ollama. */
  baseUrl?: string;
}

export interface LlmDisabled {
  /** Plain sentence naming the variable an operator would have to set. */
  reason: string;
}

export type LlmSettings = { enabled: true; config: LlmConfig } | ({ enabled: false } & LlmDisabled);

function trimmed(value: string | undefined): string {
  return (value ?? "").trim();
}

/**
 * Whether this deployment summarises, and if not, which variable says so.
 *
 * An unrecognised provider is DISABLED rather than an error. The alternative
 * is a worker that refuses to start over a misspelling in an optional feature,
 * which trades a missing enhancement for a dead collector.
 */
export function readLlmSettings(env: LlmEnv = process.env): LlmSettings {
  const raw = trimmed(env.LLM_PROVIDER) || "none";

  if (!(LLM_PROVIDERS as readonly string[]).includes(raw)) {
    return {
      enabled: false,
      reason: `LLM_PROVIDER is "${raw}", which is not one of ${LLM_PROVIDERS.join(", ")}`,
    };
  }

  const provider = raw as LlmProvider;
  if (provider === "none") {
    return { enabled: false, reason: "LLM_PROVIDER is none" };
  }

  const model = trimmed(env.LLM_MODEL) || DEFAULT_MODELS[provider];

  if (provider === "anthropic") {
    const apiKey = trimmed(env.ANTHROPIC_API_KEY);
    if (!apiKey) return { enabled: false, reason: "ANTHROPIC_API_KEY is not set" };
    return { enabled: true, config: { provider, model, apiKey } };
  }

  if (provider === "openai-compatible") {
    const apiKey = trimmed(env.OPENAI_COMPATIBLE_API_KEY);
    const baseUrl = trimmed(env.OPENAI_COMPATIBLE_BASE_URL);
    if (!baseUrl) return { enabled: false, reason: "OPENAI_COMPATIBLE_BASE_URL is not set" };
    if (!apiKey) return { enabled: false, reason: "OPENAI_COMPATIBLE_API_KEY is not set" };
    return { enabled: true, config: { provider, model, apiKey, baseUrl } };
  }

  // ollama: local, and deliberately keyless. Requiring a key here would make
  // the one provider that costs nothing the hardest one to switch on.
  const baseUrl = trimmed(env.OLLAMA_BASE_URL) || DEFAULT_OLLAMA_BASE_URL;
  return { enabled: true, config: { provider, model, baseUrl } };
}

/**
 * Whether a provider spends the owner's money.
 *
 * Ollama runs on the operator's own machine, so it is capped for consistency
 * rather than for cost. The distinction is recorded because the cap's log line
 * says different things about a local model and a metered one.
 */
export function isPaidProvider(provider: LlmConfig["provider"]): boolean {
  return provider !== "ollama";
}
