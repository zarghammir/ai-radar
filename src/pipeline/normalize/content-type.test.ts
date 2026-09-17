import { describe, expect, it } from "vitest";
import { CONTENT_TYPES, type ContentType } from "@/db/schema";
import { SOURCE_SEEDS } from "@/db/seed-data";
import {
  CLASSIFIABLE,
  NOT_CLASSIFIABLE,
  REJECTED_KEYWORDS,
  classifyContentType,
  contentFamily,
} from "./content-type";

/**
 * Every title in this file is a real one, taken from a live ingest of all 18
 * seeded sources (516 items). Invented headlines would be written to match the
 * rules, which is the one thing a classification test must not do.
 */

describe("classifyContentType: the newly reachable types", () => {
  /**
   * Each case carries the item that must classify and the item that must NOT.
   * The negatives are not hypothetical near-misses — every one of them was a
   * false positive produced by an earlier draft of these rules, measured
   * against the corpus. They are the evidence that the rejected keywords in
   * REJECTED_KEYWORDS stay rejected.
   */
  const cases: Array<{
    type: ContentType;
    must: [string, ContentType];
    mustNot: Array<[string, ContentType, string]>;
  }> = [
    {
      type: "MODEL",
      must: ["Introducing Gemini 3.7 Flash", "RESEARCH"],
      mustNot: [
        [
          "Legora reviewed 41 documents in minutes with GPT-6 Astra",
          "NEWS",
          "a customer story that names a model is not a model launch",
        ],
        [
          "Daybreak for Frontline Defenders: $1B to protect essential services",
          "NEWS",
          "$1B is money, not a parameter count",
        ],
        [
          "Anthropic merges Claude chat and Cowork in one interface",
          "NEWS",
          "a family name with no version number is a mention",
        ],
      ],
    },
    {
      type: "REGULATION",
      must: ["Washington Won't Be Regulating AI Anytime Soon", "NEWS"],
      mustNot: [
        [
          "Conformal Policy Learning with Distribution-Free Safety Guarantees",
          "RESEARCH",
          "reinforcement-learning policy, not governance",
        ],
      ],
    },
    {
      type: "BUSINESS",
      must: ["NVIDIA to Acquire Hugging Face", "NEWS"],
      mustNot: [
        [
          "What's at stake in AI's trillion-dollar gamble",
          "NEWS",
          "the idiom, not an equity stake",
        ],
        [
          "Piloting the world's first double-blind AI evaluations",
          "RESEARCH",
          "'valuation' is a substring of 'evaluations'",
        ],
        [
          "Co-Scientist: A multi-agent AI partner to accelerate research",
          "RESEARCH",
          "the companion sense of partner",
        ],
        [
          "Proactive cyber defense for governments and enterprises",
          "RESEARCH",
          "'enterprise' is a product category, not a deal",
        ],
      ],
    },
    {
      type: "TOOL",
      must: ["Introducing the Agents API", "NEWS"],
      mustNot: [
        [
          "ScarfBench: Benchmarking AI Agents for Enterprise Java Framework Migration",
          "RELEASE",
          "naming a framework without announcing one is not a tool launch",
        ],
      ],
    },
  ];

  for (const c of cases) {
    it(`classifies ${c.type}`, () => {
      const [title, declared] = c.must;
      expect(classifyContentType(title, declared)).toBe(c.type);
    });

    it(`does not classify ${c.type} on a near miss`, () => {
      expect(c.mustNot.length).toBeGreaterThan(0);
      for (const [title, declared, why] of c.mustNot) {
        expect(classifyContentType(title, declared), `${why}: ${title}`).not.toBe(c.type);
      }
    });
  }

  it("covers every classifiable type", () => {
    expect([...CLASSIFIABLE].sort()).toEqual(cases.map((c) => c.type).sort());
  });
});

/**
 * Real titles spanning the corpus: launches, customer stories, papers, forum
 * posts, funding, policy and marketing. Used to exercise the family invariant
 * against text that actually arrives rather than text chosen to be safe.
 */
const CORPUS_TITLES = [
  "Introducing Gemini 3.7 Flash",
  "Introducing Gemma 4 12B: a unified, encoder-free multimodal model",
  "GPT-6 Astra: The next generation in intelligence for work",
  "Mistral raises 3B EUR to make sovereign, open-weight AI the technology frontier",
  "NVIDIA to Acquire Hugging Face",
  "OpenAI stuck fighting Musk antitrust suit after Apple finds a way out",
  "Banning Open Source AI Would Be A Mistake",
  "Introducing the Agents API",
  "Introducing Search Toolkit",
  "Training a 4B model to produce 81% faster query plans than Postgres",
  "When Should LLMs Abstain? Chain-of-Self-Questioning for Selective Risk Control",
  "Conformal Policy Learning with Distribution-Free Safety Guarantees",
  "Agentic Societies Need a Social Harness",
  "Det-LIME: Detector-Aware, Multi-Instance Local Interpretable Model-Agnostic Explanations",
  "The AI data center e-waste problem is huge - and getting bigger",
  "Helping older adults use AI in everyday life",
  "Securing the future of AI agents",
  "Hugging Face and Cerebras bring Gemma 4 to real-time voice AI",
  "What's at stake in AI's trillion-dollar gamble",
  "A brief history of AI executives calling for regulation",
];

describe("the content-family invariant", () => {
  /**
   * assignStory groups items by content family and reads the STORY's
   * recomputed type, so a classifier able to move an item across the PAPER
   * boundary would silently change which items cluster together. This test is
   * the guard for that, in both directions at once: a PAPER default is never
   * overruled, and a non-paper item never becomes a paper.
   *
   * Control run: adding PAPER to CLASSIFIABLE and giving it a rule that matches
   * any title reddens THIS test, named, and nothing else in the file.
   */
  it("never moves an item across a content family", () => {
    expect(CORPUS_TITLES.length).toBeGreaterThanOrEqual(15);
    expect(CONTENT_TYPES.length).toBeGreaterThanOrEqual(10);
    let checked = 0;
    for (const declared of CONTENT_TYPES) {
      for (const title of CORPUS_TITLES) {
        const got = classifyContentType(title, declared);
        expect(contentFamily(got), `${declared} + "${title}" -> ${got}`).toBe(
          contentFamily(declared),
        );
        checked++;
      }
    }
    expect(checked).toBe(CONTENT_TYPES.length * CORPUS_TITLES.length);
  });

  it("leaves an adapter-declared fact alone", () => {
    // arXiv declares PAPER and Hacker News declares DISCUSSION from the feed
    // itself. A title that would otherwise classify must not overrule either.
    expect(classifyContentType("Introducing Gemini 3.7 Flash", "PAPER")).toBe("PAPER");
    expect(classifyContentType("NVIDIA to Acquire Hugging Face", "DISCUSSION")).toBe("DISCUSSION");
  });
});

describe("content-type coverage", () => {
  /**
   * A rot check: adding a value to the enum fails this until someone decides
   * whether the new type can be inferred, is declared by a source, or is
   * documented as unreachable on purpose. #41 existed because five types were
   * carried by nothing and nothing said so.
   */
  it("accounts for every type in the enum", () => {
    const sourceDefaults = SOURCE_SEEDS.map((s) => s.defaultContentType);
    // The two adapters that declare a type per item; see src/sources/.
    const adapterDeclared: ContentType[] = ["PAPER", "DISCUSSION"];
    expect(sourceDefaults.length).toBe(SOURCE_SEEDS.length);
    expect(SOURCE_SEEDS.length).toBeGreaterThanOrEqual(18);

    const accounted = new Set<ContentType>([
      ...CLASSIFIABLE,
      ...NOT_CLASSIFIABLE,
      ...sourceDefaults,
      ...adapterDeclared,
    ]);
    expect([...CONTENT_TYPES].filter((t) => !accounted.has(t))).toEqual([]);
  });

  it("keeps the rejected keywords documented with a reason", () => {
    expect(REJECTED_KEYWORDS.length).toBeGreaterThanOrEqual(5);
    for (const r of REJECTED_KEYWORDS) expect(r.because.length).toBeGreaterThan(20);
  });
});
