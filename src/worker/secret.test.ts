import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readInternalSecret, secretMatches } from "./secret";

/**
 * The placeholder is read out of .env.example rather than written here twice.
 * If someone changes the file's placeholder to something else, this test fails
 * instead of the guard quietly going blind to the value people actually copy.
 */
function placeholderFromEnvExample(): string {
  const text = readFileSync(new URL("../../.env.example", import.meta.url), "utf8");
  const match = /^INTERNAL_API_SECRET=(.*)$/m.exec(text);
  return match?.[1]?.trim() ?? "";
}

describe("readInternalSecret", () => {
  it("returns a secret that was actually set", () => {
    expect(readInternalSecret({ INTERNAL_API_SECRET: "9f2c" })).toBe("9f2c");
  });

  it("trims surrounding whitespace rather than treating it as part of the secret", () => {
    // A trailing newline from `echo ... >> .env` must not make a valid secret
    // fail to match the header the caller sends.
    expect(readInternalSecret({ INTERNAL_API_SECRET: " 9f2c\n" })).toBe("9f2c");
  });

  it("refuses to start when the variable is unset", () => {
    expect(() => readInternalSecret({})).toThrow(/INTERNAL_API_SECRET/);
  });

  it("refuses to start when the variable is empty or whitespace", () => {
    expect(() => readInternalSecret({ INTERNAL_API_SECRET: "   " })).toThrow(/INTERNAL_API_SECRET/);
  });

  it("refuses the placeholder that .env.example ships with", () => {
    const placeholder = placeholderFromEnvExample();
    // Floor: an empty capture would satisfy the throw below for the wrong
    // reason, because an empty secret is refused anyway.
    expect(placeholder.length).toBeGreaterThan(0);
    expect(() => readInternalSecret({ INTERNAL_API_SECRET: placeholder })).toThrow(/placeholder/i);
  });

  it("tells the operator how to generate a real one", () => {
    expect(() => readInternalSecret({})).toThrow(/openssl rand -hex 32/);
  });
});

describe("secretMatches", () => {
  const expected = "b7d1e4a09c";

  it("accepts the exact secret", () => {
    expect(secretMatches("b7d1e4a09c", expected)).toBe(true);
  });

  it("rejects a different secret of the same length", () => {
    expect(secretMatches("b7d1e4a09X", expected)).toBe(false);
  });

  it("rejects a secret of a different length without throwing", () => {
    // timingSafeEqual throws on unequal lengths; a guard that lets that escape
    // turns a wrong header into a 500 instead of a 401.
    expect(secretMatches("short", expected)).toBe(false);
    expect(secretMatches(expected + "extra", expected)).toBe(false);
  });

  it("rejects a missing header", () => {
    expect(secretMatches(null, expected)).toBe(false);
    expect(secretMatches("", expected)).toBe(false);
  });
});
