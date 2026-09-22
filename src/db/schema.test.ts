import { describe, expect, it } from "vitest";
import { getTableColumns, is } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import * as schema from "./schema";
import { CONTENT_TYPES, VERIFICATION_LEVELS, rawItems, stories } from "./schema";

/**
 * The product promise is that "how sure are we" and "what kind of thing is it"
 * are answered independently. These tests fail if the two are ever merged,
 * renamed into one column, or allowed to share vocabulary.
 */
/**
 * The table count is floored here because docs/architecture.md states it, and a
 * number in a document rots silently: nothing fails when a table is added, the
 * sentence simply becomes wrong and stays wrong. Adding a table is fine — update
 * both. What this refuses is the count drifting with nobody noticing.
 *
 * Note what this does NOT do: it cannot read the document. Bump the literal
 * below and leave the prose alone and it rots exactly as before, with a green
 * suite over it. A pin on the code is not a pin on the prose that cites it.
 */
describe("the schema's shape is what the architecture document says", () => {
  it("has the number of tables docs/architecture.md claims", () => {
    const tables = Object.values(schema).filter((v) => is(v, PgTable));
    expect(tables).toHaveLength(12);
  });
});

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
    // Floors first: an emptied vocabulary would satisfy the overlap check and
    // the enum comparison above, because both compare against the same
    // constant. Adding a value is fine; removing one should be deliberate
    // enough to update this line.
    expect(CONTENT_TYPES.length).toBeGreaterThanOrEqual(10);
    expect(VERIFICATION_LEVELS.length).toBeGreaterThanOrEqual(4);
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
