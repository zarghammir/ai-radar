import type { LlmConfig } from "./config";

/**
 * One text completion, from whichever provider the operator configured.
 *
 * The three providers are behind one interface so that everything above this
 * file — the prompt, the cap, the retry rule, the story selection — is written
 * once and tested without a network. `complete` is the only place that knows
 * an HTTP shape.
 */
export interface Completion {
  text: string;
  /**
   * What the provider says it charged. NULLABLE, because ollama does not
   * report usage and a zero would be a lie recorded in the cost ledger —
   * "nothing was spent" and "nobody told us" are different facts, and
   * llm_usage is the one table where confusing them is expensive.
   */
  inputTokens: number | null;
  outputTokens: number | null;
}

export interface LlmClient {
  provider: string;
  model: string;
  complete(prompt: string, maxTokens: number): Promise<Completion>;
}

/** Injected in tests; production passes nothing and gets the global. */
export type FetchLike = typeof globalThis.fetch;

/**
 * How long one summary may take before the pass gives up on it.
 *
 * A pass fetches seventeen feeds and scores every open story. An LLM that
 * hangs must not hold that up: the schedule is every thirty minutes and a
 * stuck call would still be holding the single-writer lock when the next one
 * arrives. Twenty seconds is far above a normal completion and far below the
 * fifteen-minute job timeout in ingest.yml.
 */
export const REQUEST_TIMEOUT_MS = 20_000;

function timeoutSignal(): AbortSignal {
  return AbortSignal.timeout(REQUEST_TIMEOUT_MS);
}

async function readError(response: Response): Promise<string> {
  const body = await response.text().catch(() => "");
  const tail = body.slice(0, 200).replace(/\s+/g, " ").trim();
  return `HTTP ${response.status}${tail ? `: ${tail}` : ""}`;
}

/**
 * The client for a configuration.
 *
 * NO KEY IS EVER RETURNED, LOGGED OR PLACED ON THE RESULT. It is closed over
 * by `complete` and never leaves this module — docs/cost-protection.md rule 1.
 */
export function createLlmClient(config: LlmConfig, fetchImpl?: FetchLike): LlmClient {
  const doFetch: FetchLike = fetchImpl ?? globalThis.fetch;

  if (config.provider === "anthropic") {
    return {
      provider: config.provider,
      model: config.model,
      async complete(prompt, maxTokens) {
        const response = await doFetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-api-key": config.apiKey ?? "",
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: config.model,
            max_tokens: maxTokens,
            messages: [{ role: "user", content: prompt }],
          }),
          signal: timeoutSignal(),
        });
        if (!response.ok) throw new Error(await readError(response));
        const data = (await response.json()) as {
          content?: { type?: string; text?: string }[];
          usage?: { input_tokens?: number; output_tokens?: number };
        };
        const text = (data.content ?? [])
          .filter((block) => block?.type === "text")
          .map((block) => block.text ?? "")
          .join("");
        return {
          text,
          inputTokens: data.usage?.input_tokens ?? null,
          outputTokens: data.usage?.output_tokens ?? null,
        };
      },
    };
  }

  if (config.provider === "openai-compatible") {
    return {
      provider: config.provider,
      model: config.model,
      async complete(prompt, maxTokens) {
        const base = (config.baseUrl ?? "").replace(/\/+$/, "");
        const response = await doFetch(`${base}/chat/completions`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${config.apiKey ?? ""}`,
          },
          body: JSON.stringify({
            model: config.model,
            max_tokens: maxTokens,
            messages: [{ role: "user", content: prompt }],
          }),
          signal: timeoutSignal(),
        });
        if (!response.ok) throw new Error(await readError(response));
        const data = (await response.json()) as {
          choices?: { message?: { content?: string } }[];
          usage?: { prompt_tokens?: number; completion_tokens?: number };
        };
        return {
          text: data.choices?.[0]?.message?.content ?? "",
          inputTokens: data.usage?.prompt_tokens ?? null,
          outputTokens: data.usage?.completion_tokens ?? null,
        };
      },
    };
  }

  return {
    provider: config.provider,
    model: config.model,
    async complete(prompt, maxTokens) {
      const base = (config.baseUrl ?? "").replace(/\/+$/, "");
      const response = await doFetch(`${base}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: config.model,
          stream: false,
          options: { num_predict: maxTokens },
          messages: [{ role: "user", content: prompt }],
        }),
        signal: timeoutSignal(),
      });
      if (!response.ok) throw new Error(await readError(response));
      const data = (await response.json()) as {
        message?: { content?: string };
        prompt_eval_count?: number;
        eval_count?: number;
      };
      return {
        text: data.message?.content ?? "",
        inputTokens: data.prompt_eval_count ?? null,
        outputTokens: data.eval_count ?? null,
      };
    },
  };
}
