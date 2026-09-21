import { z } from "zod";
import type { LlmClient } from "./client";

/**
 * Turning one clustered story into the three fields the card already has.
 *
 * `stories.summary`, `stories.why_it_matters` and `stories.key_points` have
 * been in the schema since the beginning with nothing writing them. This is
 * what writes them.
 *
 * THE MODEL IS NEVER TRUSTED. Everything it returns goes through the schema
 * below, and anything that does not fit is a failed attempt rather than a
 * short summary or an empty string written to the database. "The LLM returned
 * rubbish" and "this story has no summary" must not produce the same row.
 */

/** Hard ceiling on one completion. The output half of the bill cannot exceed this. */
export const MAX_OUTPUT_TOKENS = 400;

/** Items whose excerpts go into the prompt. Beyond this adds cost, not signal. */
export const MAX_ITEMS_IN_PROMPT = 5;
/** Characters of any one excerpt. Keeps a pathological feed from setting the bill. */
export const MAX_EXCERPT_CHARS = 600;

export const MAX_SUMMARY_CHARS = 700;
export const MAX_WHY_CHARS = 400;
export const MAX_KEY_POINT_CHARS = 200;
export const MAX_KEY_POINTS = 3;

export interface StoryForSummary {
  id: number;
  title: string;
  items: { title: string; excerpt: string | null; sourceName: string }[];
}

export interface StorySummary {
  summary: string;
  whyItMatters: string;
  keyPoints: string[];
}

/**
 * The shape a usable answer has.
 *
 * Every field is required and non-empty. An optional field here would let a
 * model that answered with `{}` be recorded as a success, which is the
 * vacuous-instrument shape: a check nothing can fail.
 */
const responseSchema = z.object({
  summary: z.string().trim().min(1).max(MAX_SUMMARY_CHARS),
  whyItMatters: z.string().trim().min(1).max(MAX_WHY_CHARS),
  keyPoints: z.array(z.string().trim().min(1).max(MAX_KEY_POINT_CHARS)).min(1).max(MAX_KEY_POINTS),
});

function clip(text: string, limit: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= limit ? flat : `${flat.slice(0, limit - 1)}…`;
}

/**
 * The prompt for one story.
 *
 * Built from stored items only — titles and excerpts this app already
 * collected. NOTHING IS FETCHED to build a prompt: an article body would mean
 * the summariser making its own requests to publishers, on a schedule, which
 * is a second cost and a second failure surface hiding inside the first.
 */
export function buildPrompt(story: StoryForSummary): string {
  const items = story.items.slice(0, MAX_ITEMS_IN_PROMPT).map((item, index) => {
    const excerpt = item.excerpt ? clip(item.excerpt, MAX_EXCERPT_CHARS) : "(no excerpt)";
    return `${index + 1}. [${item.sourceName}] ${clip(item.title, 300)}\n   ${excerpt}`;
  });

  return [
    "You are summarising one AI news story for a daily brief read by a technical but busy reader.",
    "",
    `STORY HEADLINE: ${clip(story.title, 300)}`,
    "",
    "REPORTS:",
    items.join("\n"),
    "",
    "Write a neutral summary of what actually happened, using only the reports above.",
    "Do not speculate, do not add facts that are not present, and do not use marketing language.",
    "If the reports disagree, say so rather than picking one.",
    "",
    "Reply with JSON only, no code fence, in exactly this shape:",
    '{"summary": "2-3 sentences", "whyItMatters": "1-2 sentences", "keyPoints": ["…", "…", "…"]}',
  ].join("\n");
}

/**
 * The first JSON object in a reply, or null.
 *
 * Models wrap JSON in prose and code fences even when told not to, and that is
 * a formatting habit rather than a wrong answer — recovering from it is not
 * the same as accepting rubbish, because whatever is recovered still has to
 * satisfy the schema. Scans for the outermost balanced braces so a nested
 * object does not truncate the match the way a non-greedy regex would.
 */
export function extractJson(text: string): string | null {
  const start = text.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const char = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{") depth++;
    else if (char === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/** A reply that did not survive the schema. Carries why, for the run log. */
export class UnusableSummaryError extends Error {}

export function parseSummary(text: string): StorySummary {
  const json = extractJson(text);
  if (json === null) {
    throw new UnusableSummaryError("reply contained no JSON object");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new UnusableSummaryError("reply was not valid JSON");
  }

  const result = responseSchema.safeParse(parsed);
  if (!result.success) {
    const first = result.error.issues[0];
    const path = first?.path.join(".") || "(root)";
    throw new UnusableSummaryError(`reply did not fit the expected shape at ${path}`);
  }

  return {
    summary: result.data.summary,
    whyItMatters: result.data.whyItMatters,
    keyPoints: result.data.keyPoints,
  };
}

export interface SummarizeOutcome {
  summary: StorySummary;
  inputTokens: number | null;
  outputTokens: number | null;
}

/** One story, one call. Throws on a provider error or an unusable reply. */
export async function summarizeStory(
  client: LlmClient,
  story: StoryForSummary,
): Promise<SummarizeOutcome> {
  const completion = await client.complete(buildPrompt(story), MAX_OUTPUT_TOKENS);
  return {
    summary: parseSummary(completion.text),
    inputTokens: completion.inputTokens,
    outputTokens: completion.outputTokens,
  };
}
