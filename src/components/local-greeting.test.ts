import { describe, expect, it } from "vitest";
import { FALLBACK_GREETING, greetingFor } from "./local-greeting";

describe("greetingFor", () => {
  /**
   * The defect, as a test: the page said "Good morning" at every hour. This
   * walks the whole day and asserts "Good morning" appears ONLY before noon —
   * the literal it replaced fails it at 12:00.
   */
  it("says good morning only in the morning", () => {
    for (let hour = 0; hour < 24; hour++) {
      const morning = hour >= 5 && hour < 12;
      expect(greetingFor(hour) === "Good morning", `at ${hour}:00`).toBe(morning);
    }
  });

  it("covers the afternoon, the evening and the small hours", () => {
    expect(greetingFor(12)).toBe("Good afternoon");
    expect(greetingFor(16)).toBe("Good afternoon");
    expect(greetingFor(17)).toBe("Good evening");
    expect(greetingFor(21)).toBe("Good evening");
    expect(greetingFor(22)).toBe(FALLBACK_GREETING);
    expect(greetingFor(3)).toBe(FALLBACK_GREETING);
    expect(greetingFor(5)).toBe("Good morning");
  });

  it("says hello when the hour is not a real hour", () => {
    for (const bad of [NaN, -1, 24, 7.5]) expect(greetingFor(bad)).toBe(FALLBACK_GREETING);
  });
});
