import { describe, expect, it } from "vitest";
import { CONTENT_TYPES } from "@/db/schema";
import {
  BRIEF_VIEWS,
  VIEW_OF,
  VIEW_LABELS,
  parseView,
  parseViewOrThrow,
  typesForView,
} from "@/lib/api/views";

describe("the two positions", () => {
  it("gives every content type a side", () => {
    // A total Record, like CONTENT_TYPE_LABELS: a type added to the database
    // without a side here is a compile error rather than a story that belongs
    // to neither view and therefore appears in nothing.
    expect(CONTENT_TYPES.length).toBe(10);
    for (const type of CONTENT_TYPES) {
      expect(BRIEF_VIEWS, `${type} has no side`).toContain(VIEW_OF[type]);
    }
  });

  it("RETURNS DIFFERENT SETS — the property, not the instance", () => {
    // The acceptance the ticket asks for, stated as a property. "Everything
    // shows something" and "built shows something" are both true of a control
    // that does nothing at all; what makes it a control is that the two
    // positions disagree. This keeps holding after #71 widens what "all"
    // contains, which an assertion about one named story would not.
    const built = typesForView("built");
    const all = typesForView("all");
    expect(built).not.toEqual(all);
    expect(all.length).toBeGreaterThan(built.length);
    // And the floor beneath it: neither side is empty, because a filter that
    // excludes everything also "returns a different set".
    expect(built.length).toBeGreaterThan(0);
    expect(all.length).toBe(CONTENT_TYPES.length);
  });

  it("makes built a strict subset of everything, so widening only ever adds", () => {
    const all = typesForView("all");
    for (const type of typesForView("built")) expect(all).toContain(type);
  });

  it("keeps RESEARCH and PAPER on the same side", () => {
    // Splitting them would draw a boundary THE READER CANNOT SEE: both render
    // as a published piece of work somebody did, so one in and one out reads
    // as randomness rather than as a filter.
    expect(VIEW_OF.RESEARCH).toBe(VIEW_OF.PAPER);
    expect(VIEW_OF.RESEARCH).toBe("built");
  });

  it("has no third position, and the labels say what each one is", () => {
    // With the fetch-time AI gate in place, an "AI only" stop would return the
    // identical rows to "all" — two positions producing the same set is a lie
    // about what the control does.
    expect(BRIEF_VIEWS).toHaveLength(2);
    for (const view of BRIEF_VIEWS) {
      expect(VIEW_LABELS[view].label.trim()).toBeTruthy();
      expect(VIEW_LABELS[view].hint.trim()).toBeTruthy();
    }
  });

  it("treats an unrecognised view as no answer rather than as a filter", () => {
    // The value arrives from a URL and a cookie, both reader-writable. It must
    // not be able to filter Today to nothing.
    for (const bad of ["ai-only", "", "BUILT", "everything", undefined, null]) {
      expect(parseView(bad), `accepted ${JSON.stringify(bad)}`).toBeNull();
    }
    expect(parseView("built")).toBe("built");
    expect(parseView(["all"])).toBe("all");
  });
});

describe("an unrecognised view never widens", () => {
  it("is REFUSED by the route rather than falling back", () => {
    // The first version of the route did `parseView(raw) ?? "all"`, so a typo
    // returned everything stored — a value nobody asked for, opening the front
    // door. parseBriefLength throws on a bad length rather than guessing, and
    // this now matches it. #105 sets the same rule for its own axis.
    for (const bad of ["everything", "ai-only", "BUILT", "", "1"]) {
      expect(() => parseViewOrThrow(bad, "all"), `accepted ${JSON.stringify(bad)}`).toThrow();
    }
  });

  it("tells ABSENT apart from unrecognised, because they are different answers", () => {
    // No ?view= means the caller expressed no view, and the route answers what
    // it answered before this existed. Collapsing the two would make a typo
    // indistinguishable from silence — the absence-versus-failure shape, in a
    // query parameter.
    expect(parseViewOrThrow(null, "all")).toBe("all");
    expect(parseViewOrThrow(null, "built")).toBe("built");
    // And the positive beside it: a value it DOES know is honoured, so
    // "everything throws" cannot be why the negatives above pass.
    expect(parseViewOrThrow("built", "all")).toBe("built");
    expect(parseViewOrThrow("all", "built")).toBe("all");
  });

  it("narrows rather than widens wherever it cannot throw", () => {
    // The page cannot throw at a reader for a typo'd URL, so its parser answers
    // null and the caller falls back. What must never happen on either path is
    // an unknown value producing MORE than the reader asked for.
    expect(parseView("everything")).toBeNull();
    expect(parseView("ai-only")).toBeNull();
  });
});
