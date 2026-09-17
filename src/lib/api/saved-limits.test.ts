import { describe, expect, it } from "vitest";
import { saveBodySchema } from "@/api/reader";
import { NOTE_MAX, TAG_MAX_LENGTH, TAGS_MAX } from "@/lib/api/saved-limits";

/**
 * The limits the Saved screen enforces are a COPY of the route's. A copy that
 * drifts looser lets the reader type something the write then rejects, and one
 * that drifts tighter withdraws a capability with no explanation anywhere.
 *
 * So each is driven against the REAL schema at both sides of the boundary:
 * the largest allowed value must pass, and one more must fail. A test that only
 * checked the lower side would still pass if the client's number were half the
 * route's.
 */
describe("the Saved screen's limits match the route's", () => {
  it("allows a note of exactly NOTE_MAX and refuses one character more", () => {
    expect(saveBodySchema.safeParse({ note: "x".repeat(NOTE_MAX) }).success).toBe(true);
    expect(saveBodySchema.safeParse({ note: "x".repeat(NOTE_MAX + 1) }).success).toBe(false);
  });

  it("allows a tag of exactly TAG_MAX_LENGTH and refuses one character more", () => {
    expect(saveBodySchema.safeParse({ tags: ["x".repeat(TAG_MAX_LENGTH)] }).success).toBe(true);
    expect(saveBodySchema.safeParse({ tags: ["x".repeat(TAG_MAX_LENGTH + 1)] }).success).toBe(
      false,
    );
  });

  it("allows exactly TAGS_MAX tags and refuses one more", () => {
    const tags = (count: number) => Array.from({ length: count }, (_, i) => `tag-${i}`);
    expect(saveBodySchema.safeParse({ tags: tags(TAGS_MAX) }).success).toBe(true);
    expect(saveBodySchema.safeParse({ tags: tags(TAGS_MAX + 1) }).success).toBe(false);
  });

  it("refuses an empty tag, which is why the editor drops a blank one", () => {
    expect(saveBodySchema.safeParse({ tags: [""] }).success).toBe(false);
  });
});
