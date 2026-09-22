import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CONTENT_TYPES, type ContentType } from "@/db/schema";
import { SOURCE_SEEDS } from "@/db/seed-data";
import {
  CLASSIFIABLE,
  announcesItsOwnLaunch,
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
    // THE FLOOR, DERIVED FROM THE FAILURE RATHER THAN FROM THE COUNT (#90).
    //
    // It used to be `SOURCE_SEEDS.length >= N`, where N was the catalogue size
    // on the day it was written. That tracked the quantity it guarded, so
    // every source added or removed moved it — twice in two days — and a
    // tripwire that fires on ordinary work teaches people to adjust it without
    // reading it. It was already stale again: the value said 17 and the
    // catalogue is 18.
    //
    // WHAT THIS TEST ACTUALLY NEEDS is that the catalogue's contribution to
    // `accounted` is load-bearing. If every type carried by `sourceDefaults`
    // were also in CLASSIFIABLE, NOT_CLASSIFIABLE or adapterDeclared, the
    // assertion below would pass IDENTICALLY with an empty catalogue, and this
    // would be a coverage test that says nothing about coverage.
    //
    // Measured 2026-09-18 at e709f3e: NEWS, RESEARCH and RELEASE are accounted
    // for ONLY by source defaults — carried by 11, 4 and 2 sources.
    //
    // Note what this DOES NOT need to assert: that an emptied catalogue fails.
    // It already does, on the coverage assertion itself, because those three
    // types would go unaccounted. A size floor was never what caught that.
    //
    // Ordinary catalogue work cannot trip this. Adding or removing a source
    // moves nothing unless it removes the LAST carrier of a type nothing else
    // accounts for — which is precisely the moment someone should stop.
    const otherwiseAccounted = new Set<ContentType>([
      ...CLASSIFIABLE,
      ...NOT_CLASSIFIABLE,
      ...adapterDeclared,
    ]);
    const onlyFromCatalogue = [...new Set(sourceDefaults)].filter(
      (t) => !otherwiseAccounted.has(t),
    );
    expect(onlyFromCatalogue.length).toBeGreaterThan(0);

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

describe("a title that announces its own launch", () => {
  /**
   * #79. Show HN items arrive typed RELEASE by their source default, and
   * RELEASE is not a declared fact, so every one of them runs through the
   * rules above. Six branches can type a title and five of them reach a Show
   * HN launch without the prefix mattering — so the words that describe what
   * somebody BUILT get read as the kind of thing the item IS.
   *
   * Each case below is one of those branches, named for it, with the type it
   * would have been given.
   */
  const branches: Array<{ branch: string; bare: string; wouldHaveBeen: ContentType }> = [
    {
      branch: "MODEL 2 — parameter count beside a model noun",
      bare: "I fine-tuned a 7B model for SQL generation",
      wouldHaveBeen: "MODEL",
    },
    {
      branch: "MODEL 3 — a launch verb beside a model noun",
      bare: "Introducing a small language model that runs offline",
      wouldHaveBeen: "MODEL",
    },
    {
      branch: "MODEL 1 — a model family beside a launch verb",
      bare: "Announcing Gemma 4 fine-tuning on a laptop",
      wouldHaveBeen: "MODEL",
    },
    {
      branch: "TOOL — a launch verb beside a tool word",
      bare: "Launching an open-source SDK",
      wouldHaveBeen: "TOOL",
    },
    {
      branch: "REGULATION — a single phrase",
      bare: "an EU AI Act compliance checker",
      wouldHaveBeen: "REGULATION",
    },
    {
      branch: "BUSINESS — a single phrase",
      bare: "I raised a seed round for my side project",
      wouldHaveBeen: "BUSINESS",
    },
  ];

  for (const c of branches) {
    it(`keeps a launch as RELEASE: ${c.branch}`, () => {
      // Two assertions over the SAME words, differing only by the prefix, so
      // the prefix is isolated as the cause.
      //
      // The first is not decoration: it proves the branch this case is named
      // for is live and would have typed these words. Without it the second
      // assertion would keep passing if the rule stopped firing for some
      // unrelated reason, and would then be guarding nothing.
      expect(classifyContentType(c.bare, "NEWS")).toBe(c.wouldHaveBeen);
      expect(classifyContentType(`Show HN: ${c.bare}`, "RELEASE")).toBe("RELEASE");
    });
  }

  it("returns whatever was declared, not RELEASE specifically", () => {
    // The guard reads the TITLE, so it applies whatever the source said. This
    // is why the case above cannot assert the would-have-been against the
    // prefixed title: the guard answers NEWS there, not MODEL. An earlier
    // version of this file asserted exactly that and CI caught it.
    expect(classifyContentType("Show HN: I fine-tuned a 7B model", "NEWS")).toBe("NEWS");
  });

  it("covers every branch that can type a title", () => {
    // A floor on the list above: RULES has four entries and MODEL has three
    // internal branches, so six is the number to keep it at.
    expect(branches.length).toBe(6);
    expect(new Set(branches.map((b) => b.wouldHaveBeen))).toEqual(
      new Set(["MODEL", "TOOL", "REGULATION", "BUSINESS"]),
    );
  });

  it("is anchored: a headline that merely mentions Show HN is classified normally", () => {
    // Otherwise any article about the list inherits the exemption.
    expect(announcesItsOwnLaunch("A guide to Show HN: what gets upvoted")).toBe(false);
    expect(classifyContentType("What Show HN taught us about the EU AI Act", "NEWS")).toBe(
      "REGULATION",
    );
  });

  it("returns the declared type rather than a literal, so provenance stays default", () => {
    // `adapter` is the one provenance the backfill never revisits. Writing it
    // here would freeze every Show HN row against future fixes to these rules
    // — which is why the adapter-declares-RELEASE version of this fix was
    // rejected in #80.
    // Declared NEWS rather than RELEASE deliberately. With RELEASE the literal
    // and the declared value coincide, so this assertion could not tell them
    // apart — a control returning a literal "RELEASE" left it green while the
    // test's name claimed it guarded exactly that.
    expect(
      decideContentType(undefined, "Show HN: an EU AI Act compliance checker", "NEWS"),
    ).toEqual({ type: "NEWS", source: "default" });
  });

  it("cannot change the classification of anything that is not a launch", () => {
    // The precision floor, structural rather than measured: the guard is the
    // only new path, it is anchored, and no title in the corpus trips it — so
    // #57's measured 90% MODEL precision is untouched by construction.
    expect(CORPUS_TITLES.length).toBeGreaterThanOrEqual(15);
    expect(CORPUS_TITLES.filter(announcesItsOwnLaunch)).toEqual([]);
  });
});

/**
 * #76: the release-shaped headline whose name is not on the family list.
 *
 * Every title here is REAL — each one is recorded in #76, in the measured-and-
 * reverted note in content-type.ts, or was read out of the stored corpus by
 * scripts/measure-model-recall.ts. None is invented to make a rule look good,
 * which matters more than usual here: the rule this covers was designed
 * against a list of known false positives, so a fabricated case would be
 * marking its own homework.
 */
describe("#76: a versioned name that leads the title", () => {
  it.each([
    ["TimesFM-3: A zero-shot foundation model for multivariate forecasting", "hyphen + colon"],
    [
      "Aurora 1.5: Extending open foundation models for weather and Earth-system applications",
      "space + decimal version, plural noun",
    ],
  ])("types %s as MODEL (%s)", (title) => {
    expect(classifyContentType(title, "NEWS")).toBe("MODEL");
  });

  /**
   * THE FIVE THE REVERTED RULE GOT WRONG.
   *
   * This is the control that makes the new rule believable rather than
   * hopeful, and it is worth stating what it proves: each of these is
   * excluded by a DIFFERENT clause of the conjunction. If one clause did all
   * the work, the other two would be decoration and this block would pass for
   * a much looser rule.
   */
  it.each([
    ["State of Open Models: Summer 2026", "a date, not a version — nothing leads"],
    ["Training Text-to-Image Models 3.6x Faster", "an incidental figure, and no leading name"],
    ["Import AI 454", "newsletter numbering, and no model noun"],
    ["Datasette 1.0a39", "software: no model noun and no colon"],
    ["Apple releases iOS 27", "software: the name does not lead"],
  ])("leaves %s alone (%s)", (title) => {
    expect(classifyContentType(title, "NEWS")).not.toBe("MODEL");
  });

  /**
   * A DISCLOSED GAP, ASSERTED SO IT CANNOT CLOSE BY ACCIDENT.
   *
   * "We're launching Lyria 3.5" is the third miss #76 records and it stays
   * missed on purpose: the only rule that reaches it is "launch verb +
   * versioned name", which is the shape already measured as keeping software
   * releases. Catching Lyria means swallowing "Apple releases iOS 27".
   *
   * Asserted rather than left to a comment because if someone later widens
   * the rule far enough to catch this, THIS TEST GOING RED is how they find
   * out they have re-opened the precision hole — and the line above, which
   * must stay green, is what it costs.
   */
  it("still misses a launch verb with no model noun, which is the disclosed trade", () => {
    expect(classifyContentType("We're launching Lyria 3.5", "NEWS")).not.toBe("MODEL");
  });

  /**
   * The shape the corpus says is the REAL remaining gap: a model name with no
   * version at all. Found by judging a deterministic sample of 60 still-
   * untyped items. No regex over a title can separate these from any other
   * product announcement — that needs a maintained list or a summariser.
   */
  it.each([
    "Magistral",
    "Introducing Shieldstral.",
    "SensorFM: Towards a general intelligence and interface for wearable health data",
  ])("documents the versionless miss: %s", (title) => {
    expect(classifyContentType(title, "NEWS")).not.toBe("MODEL");
  });
});
