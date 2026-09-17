import { matchesAnyKeyword } from "./keywords";

/**
 * The words that make a title read as being about AI.
 *
 * It lived inside the Hacker News adapter while that adapter was its only
 * consumer. It has two now: the adapter, which uses it to decide what to
 * FETCH, and normalizeItem, which records whether each stored item matched it
 * so a reader can later choose between "AI only" and "everything" (#71).
 *
 * A vocabulary is not an adapter detail, and a second copy would drift — the
 * gate and the label would then disagree about the same title.
 */
export const DEFAULT_AI_KEYWORDS = [
  "ai",
  "a.i.",
  "llm",
  "gpt",
  "openai",
  "anthropic",
  "claude",
  "gemini",
  "deepmind",
  "mistral",
  "llama",
  "transformer",
  "diffusion",
  "machine learning",
  "deep learning",
  "neural",
  "agent",
  "agentic",
  "model",
  "inference",
  "nvidia",
  "gpu",
  "cuda",
  "hugging face",
  "huggingface",
  "reinforcement learning",
  "rag",
  "embedding",
  "copilot",
  "cursor",
  "xai",
  "grok",
  "benchmark",
  "multimodal",
  "text-to-video",
  "text-to-image",
  "speech",
  "whisper",
  "robotics",
  "humanoid",
];

/**
 * Whether a title uses AI vocabulary. A fact about the words, and nothing
 * more: it says what a title said, never whether the thing is true, good, or
 * worth reading. It must not become a second verification signal.
 */
export function matchedAiVocabulary(title: string, keywords: string[] = DEFAULT_AI_KEYWORDS): boolean {
  return matchesAnyKeyword(title, keywords);
}
