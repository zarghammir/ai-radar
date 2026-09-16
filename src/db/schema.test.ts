import { describe, expect, it } from "vitest";
import { getTableColumns } from "drizzle-orm";
import { CONTENT_TYPES, VERIFICATION_LEVELS, rawItems, stories } from "./schema";

/**
 * The product promise is that "how sure are we" and "what kind of thing is it"
 * are answered independently. These tests fail if the two are ever merged,
 * renamed into one column, or allowed to share vocabulary.
 */
describe("verification level and content type stay separate", () => {
  it("stories carry both as distinct columns", () => {
    const cols = getTableColumns(stories);
    expect(Object.keys(cols)).toContain("contentType");
    expect(Object.keys(cols)).toContain("verification");
    expect(cols.contentType.name).toBe("content_type");
    expect(cols.verification.name).toBe("verification");
  });

  it("each column is constrained to its own vocabulary", () => {
    const cols = getTableColumns(stories);
    expect(cols.contentType.enumValues).toEqual([...CONTENT_TYPES]);
    expect(cols.verification.enumValues).toEqual([...VERIFICATION_LEVELS]);
  });

  it("the two vocabularies share no value", () => {
    const levels = VERIFICATION_LEVELS as readonly string[];
    expect(CONTENT_TYPES.filter((c) => levels.includes(c))).toEqual([]);
  });

  it("keeps first_seen_at on stories even though ranking no longer reads it", () => {
    // Ruled 2026-09-16: age since first sighting is not a ranking input in v1,
    // but the column stays because the story page timeline is built from it.
    // Dropping RankInput.firstSeenAt is not permission to drop the column.
    const cols = getTableColumns(stories);
    expect(Object.keys(cols)).toContain("firstSeenAt");
    expect(cols.firstSeenAt.name).toBe("first_seen_at");
  });

  it("raw items carry a content type but no verification of their own", () => {
    // Verification is derived for a story from the set of sources behind it,
    // so a single item must never carry a level that could be read as settled.
    const cols = Object.keys(getTableColumns(rawItems));
    expect(cols).toContain("contentType");
    expect(cols).not.toContain("verification");
  });
});
