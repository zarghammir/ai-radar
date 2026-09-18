import { describe, expect, it } from "vitest";
import { BRIEF_LENGTHS as BUDGET_LENGTHS } from "./reading-budget";
import { BRIEF_LENGTHS as SCHEMA_LENGTHS } from "@/db/schema";

describe("the two BRIEF_LENGTHS lists", () => {
  /**
   * THE SAME LIST EXISTS TWICE, ON PURPOSE, AND NOTHING KEPT THEM EQUAL.
   *
   * `reading-budget.ts` defines its own copy deliberately: its docblock
   * explains it must stay free of database imports so the fixtures can use it
   * without pulling drizzle in. That reason is good and this test does not
   * argue with it — it makes the duplication safe instead of removing it.
   *
   * WHY IT MATTERS BEYOND TIDINESS, which is what made it worth a test rather
   * than a comment. #114 derives the e2e seeder's corpus floor from the SCHEMA
   * copy — the longest finite budget a reader can choose — while the budget the
   * product actually applies comes from the READING-BUDGET copy. Add "20" to
   * one and not the other and the floor guards a budget the app does not offer,
   * or the app offers one the corpus was never grown for. Either way the
   * failure lands in verify:today, which would blame the product.
   *
   * A derived constant is only as trustworthy as the list it derives from.
   */
  it("agree, because a floor derived from one guards a budget applied by the other", () => {
    expect([...BUDGET_LENGTHS]).toEqual([...SCHEMA_LENGTHS]);
  });

  /**
   * The floor in scripts/seed-e2e-stories.ts drops "all" and takes the maximum
   * of what remains. If every entry were non-numeric that would be Math.max()
   * of nothing — `-Infinity` — and the floor would pass on any corpus at all,
   * silently. This asserts the shape that calculation depends on.
   */
  it("contain at least one finite budget, which the seeder's floor is derived from", () => {
    const finite = SCHEMA_LENGTHS.filter((l) => l !== "all").map(Number);
    expect(finite.length).toBeGreaterThan(0);
    expect(finite.every((n) => Number.isFinite(n) && n > 0)).toBe(true);
  });
});
