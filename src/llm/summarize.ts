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
/**
 * The one-line summary's ceiling, and why it is 160 rather than the ~90 the
 * prompt asks for.
 *
 * The card gives this line about two lines of text on a phone, so 90 is the
 * length that LOOKS right and 160 is where it starts to defeat the point. The
 * schema takes the looser figure deliberately: a model that overshoots the
 * suggestion by twenty characters would otherwise void the whole response,
 * losing a perfectly good summary and whyItMatters to a line nobody had to
 * have. The prompt asks for the length; the schema only refuses the absurd.
 */
export const MAX_ONE_LINE_CHARS = 160;
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
  /**
   * One sentence for the line under the title on the card — #192.
   *
   * OPTIONAL, AND THAT IS NOT A WEAKENING OF THE SCHEMA BELOW. The rule the
   * other three fields enforce is that a model answering `{}` must not be
   * recorded as a success, and they still enforce it: a response missing any
   * of them fails whatever this field does. What optional buys is that a
   * provider which ignores a newly added instruction degrades to exactly
   * today's behaviour — a summary with no one-liner — instead of to NO
   * SUMMARIES AT ALL. Making it required would have put the 23% of the feed
   * that currently has a summary at the mercy of one new prompt line.
   *
   * `stories.one_line` being null is already a complete, rendered state: the
   * card shows the title alone and is finished. That is why absence here is
   * expressible, where an absent `summary` would not be.
   */
  oneLine?: string;
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
  oneLine: z.string().trim().min(1).max(MAX_ONE_LINE_CHARS).optional(),
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
    // The one-line summary is WRITTEN, not extracted. Asking for "the first
    // sentence of the summary" produces the thing #192 exists to avoid: "As
    // robotic hardware and learning methods advance, humanoids need tools to
    // perform tasks beyond their inhere…". The three constraints below — a
    // sentence, plain words, about 90 characters — are what make it a line
    // somebody can read under a headline rather than a cut-off paragraph.
    "Also write oneLine: ONE plain sentence of about 90 characters saying what happened,",
    "the way you would tell a colleague in passing. It goes under the headline on a card,",
    "so it must stand alone and must NOT be the first sentence of your summary.",
    'Good: "OpenAI shipped a cheaper model that nearly matches its best one."',
    "",
    "Reply with JSON only, no code fence, in exactly this shape:",
    '{"summary": "2-3 sentences", "whyItMatters": "1-2 sentences", "keyPoints": ["…", "…", "…"], "oneLine": "one sentence"}',
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
    // Field by field rather than a spread, like the three above: what the
    // model sent is validated data, not a shape to hand on wholesale.
    oneLine: result.data.oneLine,
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
