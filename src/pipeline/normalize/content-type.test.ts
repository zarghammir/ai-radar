import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CONTENT_TYPES, type ContentType } from "@/db/schema";
import { SOURCE_SEEDS } from "@/db/seed-data";
import {
  CLASSIFIABLE,
  decideContentType,
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
   * Control run, measured on the whole suite with a database rather than on
   * this file alone. Adding PAPER to CLASSIFIABLE with a rule matching any
   * title, INJECTED AS THE SECOND RULE — immediately after MODEL and before
   * REGULATION — reddens this test and eleven others across three files.
   *
   * The position has to be stated. The same description with the rule appended
   * last reddens 9 and with it placed first reddens 16: those are three
   * different controls, not a range. Narrowing the injected rule to a single
   * corpus title ("Abstain") isolates it to two — this test and "covers every
   * classifiable type", which correctly notices the CLASSIFIABLE change.
   *
   * The earlier version of this comment claimed "nothing else in the file",
   * which was measured by running only this directory. A control measured on a
   * subset of the suite understates its blast radius, and a false description
   * of a load-bearing control is how the next person talks themselves into
   * deleting it.
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
    // The corpus floor: without it, an emptied catalogue would satisfy the
    // coverage assertion below with nothing in it.
    //
    // 18 -> 17 on 2026-09-17, when import-ai was dropped (#38). It mirrors the
    // catalogue size, so every removal moves it again, and the next person will
    // lower it by one because that is what the last two did. #90 carries the
    // fix: pick a floor from the FAILURE it catches — an emptied catalogue —
    // rather than from today's measurement. Left tracking here because it is
    // this test's guard to retune, not something to redesign in passing.
    //
    // There is a SECOND floor on this same quantity at
    // src/db/seed-data.test.ts:16, and it did NOT have to move, because 15
    // leaves headroom under the catalogue instead of matching it. That is the
    // shape #90 should copy — this one is the outlier, not that one.
    expect(SOURCE_SEEDS.length).toBeGreaterThanOrEqual(17);

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

describe("decideContentType records why, it does not leave it to be inferred", () => {
  /**
   * The backfill used to recover provenance with `stored !== sourceDefault`,
   * which was true only while nothing but an adapter could move a type. The
   * classifier moves types, so a second run filed this tool's own output as an
   * adapter's declaration and refused to re-apply a changed rule to it. These
   * three cases are the whole reason the column exists.
   */
  it("marks an adapter's declaration as adapter", () => {
    expect(decideContentType("PAPER", "Introducing Gemini 3.7 Flash", "RESEARCH")).toEqual({
      type: "PAPER",
      source: "adapter",
    });
  });

  it("marks its own inference as classifier, even though it differs from the default", () => {
    // This is the case the old inference got wrong: the value differs from the
    // source default and no adapter was involved.
    expect(decideContentType(undefined, "Introducing Gemini 3.7 Flash", "RESEARCH")).toEqual({
      type: "MODEL",
      source: "classifier",
    });
  });

  it("marks an untouched default as default", () => {
    expect(
      decideContentType(undefined, "Helping older adults use AI in everyday life", "NEWS"),
    ).toEqual({ type: "NEWS", source: "default" });
  });

  it("never reports classifier when the type equals the source default", () => {
    // Otherwise the backfill would rewrite rows it did not change, and the
    // provenance would drift towards "classifier" for the whole corpus.
    for (const title of CORPUS_TITLES) {
      const d = decideContentType(undefined, title, "NEWS");
      expect(d.source === "classifier", `${title} -> ${d.type}/${d.source}`).toBe(
        d.type !== "NEWS",
      );
    }
  });
});

describe("the premise the provenance migration rests on", () => {
  /**
   * Migration 0002 decides provenance for pre-existing rows with two facts and
   * no titles: a stored PAPER or DISCUSSION can only have come from an adapter,
   * and anything else differing from its source default can only have come from
   * the classifier.
   *
   * That holds only while adapters declare nothing but those two types. If a
   * third adapter declaration appears, the migration silently records it as
   * `classifier` and the backfill becomes free to overwrite an adapter's fact.
   * The migration is historical and cannot be re-run, so this test is the only
   * thing standing between that change and a wrong column.
   *
   * It reads the adapter sources rather than importing them, because the type
   * is a literal inside a mapping function and there is no value to inspect
   * without performing a fetch.
   */
  it("no adapter declares a content type outside PAPER and DISCUSSION", () => {
    const dir = fileURLToPath(new URL("../../sources", import.meta.url));
    const files = readdirSync(dir, { recursive: true, encoding: "utf8" })
      .filter((f) => f.endsWith("adapter.ts"))
      .map((f) => join(dir, f));
    // A floor: a glob that silently matched nothing would pass this vacuously.
    expect(files.length).toBeGreaterThanOrEqual(2);

    // Every uppercase string literal on a line that assigns contentType. Not
    // `contentType: "X"` alone: Hacker News writes
    // `contentType: it.url ? undefined : "DISCUSSION"`, and a stricter pattern
    // found one declaration where there are two — which the floor below caught.
    const declared = files.flatMap((file) =>
      readFileSync(file, "utf8")
        .split("\n")
        .filter((line) => /\bcontentType\s*:/.test(line))
        .flatMap((line) => [...line.matchAll(/"([A-Z_]+)"/g)].map((m) => ({ file, type: m[1] }))),
    );
    expect(declared.length).toBeGreaterThanOrEqual(2);
    for (const d of declared) {
      expect(["PAPER", "DISCUSSION"], `${d.file} declares ${d.type}`).toContain(d.type);
    }
  });
});
