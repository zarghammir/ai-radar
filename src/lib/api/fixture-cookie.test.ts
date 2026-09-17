import { describe, expect, it } from "vitest";
import { BRIEF_LENGTH_COOKIE, briefLengthCookieString } from "@/lib/api/fixture-store";

/**
 * The condition that came with the ruling on #75, asserted rather than
 * promised in a comment: the cookie carries A PREFERENCE, NEVER AN IDENTIFIER.
 *
 * It matters because the obvious implementation is the wrong one. Serialising
 * the preferences row into a cookie would work, and would put the reader's
 * EMAIL ADDRESS on their device in a cookie — in an app whose whole pitch is
 * that nothing about them goes anywhere.
 */
describe("the one cookie a fixture build sets", () => {
  it("carries the length, and says so in its name", () => {
    const cookie = briefLengthCookieString("5");
    expect(cookie.startsWith(`${BRIEF_LENGTH_COOKIE}=5;`)).toBe(true);
  });

  it("carries NOTHING that could identify the reader", () => {
    // Asserted on the DECODED value, not on the cookie string. Searching the
    // raw string for "reader@example.com" cannot see a leak, because
    // encodeURIComponent turns it into "reader%40example.com" — the control
    // for this test (serialising the whole preferences row into the cookie)
    // sailed straight past the first version for exactly that reason.
    //
    // So rather than list what must not be in it, this asserts what IS: the
    // whole decoded value is the length and nothing else. Any widening of what
    // the cookie carries has to come through this line.
    const cookie = briefLengthCookieString("10");
    const value = decodeURIComponent(cookie.slice(cookie.indexOf("=") + 1, cookie.indexOf(";")));
    expect(value).toBe("10");

    // And the belt beside the braces, on the decoded form this time.
    for (const secret of [
      "reader@example.com",
      "America/Toronto",
      "07:30",
      "agents",
      "2026-09-01T00:00:00.000Z",
    ]) {
      expect(decodeURIComponent(cookie), `cookie leaked ${secret}`).not.toContain(secret);
    }
    // The floor: an empty cookie string would satisfy every "not.toContain"
    // above while proving nothing at all.
    expect(cookie.length).toBeGreaterThan(BRIEF_LENGTH_COOKIE.length + 10);
  });

  it("holds exactly one name=value pair, the rest being attributes", () => {
    const parts = briefLengthCookieString("all").split(";");
    const pairs = parts.filter(
      (p) => p.includes("=") && !/^\s*(path|max-age|samesite|expires|domain)=/i.test(p.trim()),
    );
    expect(pairs).toEqual([`${BRIEF_LENGTH_COOKIE}=all`]);
  });

  it("escapes its value, so a length cannot smuggle in another attribute", () => {
    // The value comes from a stored preference, and a stored preference is a
    // plain text column. Something that could close the pair and append
    // `; domain=…` would be a cookie this app did not mean to set.
    const cookie = briefLengthCookieString("5; domain=example.com");
    expect(cookie.split(";")[0]).toBe(`${BRIEF_LENGTH_COOKIE}=5%3B%20domain%3Dexample.com`);
    expect(cookie.toLowerCase()).not.toContain("domain=example.com");
  });

  it("is scoped to this site and lasts a year", () => {
    const cookie = briefLengthCookieString("10").toLowerCase();
    expect(cookie).toContain("path=/");
    expect(cookie).toContain("samesite=lax");
    expect(cookie).toContain(`max-age=${60 * 60 * 24 * 365}`);
  });
});
