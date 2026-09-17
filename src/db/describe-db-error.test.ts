import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { describeDbError } from "./client";

/**
 * The promise under test is not "the object dump is gone". It is: NO FRAGMENT
 * OF DATABASE_URL REACHES THE LOG.
 *
 * That distinction is the reason this file exists. The first version of
 * describeDbError was measured by grepping its output for `address:` and
 * `port:` — the property names of the dump it had just stopped printing. Those
 * are necessarily absent once a string is printed instead, whatever the string
 * says, so the measurement could only ever pass. A pattern taken from a
 * defect's old shape cannot see the same information in a new one.
 *
 * Every message below was CAPTURED from postgres.js against a real failure,
 * not invented, so the fixtures cannot drift into shapes the driver never
 * produces. Sources, all in node_modules/postgres/src:
 *   errors.js connection() builds `host + ':' + port` into the MESSAGE
 *   a PostgresError carries the server's own sentence, which names the role
 */
const URL_ =
  "postgres://UsrSecret9q7x:PwSecret9q7x@zz-host-9q7x.example.invalid:59999/DbSecret9q7x";
const FRAGMENTS = [
  "UsrSecret9q7x",
  "PwSecret9q7x",
  "zz-host-9q7x.example.invalid",
  "59999",
  "DbSecret9q7x",
];

/** Captured verbatim; see the note above. */
const CAPTURED = [
  {
    shape: "ENOTFOUND — a typo'd hostname, which is what a first press produces",
    message: "getaddrinfo ENOTFOUND zz-host-9q7x.example.invalid",
    code: "ENOTFOUND",
    keeps: "ENOTFOUND",
  },
  {
    shape: "CONNECT_TIMEOUT — host and port built into the message by errors.js",
    message: "write CONNECT_TIMEOUT zz-host-9q7x.example.invalid:59999",
    code: "CONNECT_TIMEOUT",
    keeps: "CONNECT_TIMEOUT",
  },
  {
    shape: "the server's own error, which names the role",
    message: 'role "UsrSecret9q7x" does not exist',
    code: "28000",
    keeps: "does not exist",
  },
];

describe("describeDbError", () => {
  let saved: string | undefined;
  beforeEach(() => {
    saved = process.env.DATABASE_URL;
    process.env.DATABASE_URL = URL_;
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = saved;
  });

  for (const { shape, message, code, keeps } of CAPTURED) {
    it(`redacts every credential fragment: ${shape}`, () => {
      const error = Object.assign(new Error(message), { code });

      // The fixture must actually CARRY something worth redacting, or a clean
      // result below would prove nothing. This is the control, in the same
      // file as the assertion it guards.
      expect(FRAGMENTS.some((f) => message.includes(f))).toBe(true);

      const out = describeDbError(error);
      for (const fragment of FRAGMENTS) expect(out).not.toContain(fragment);

      // The negative needs a positive beside it: a function returning "" would
      // satisfy every assertion above and be useless.
      expect(out).toContain(keeps);
      expect(out).toContain(`[${code}]`);
    });
  }

  it("reads the code off the error itself, not only off its cause", () => {
    // The earlier version only looked at `cause`, so connection errors — which
    // carry the code on the error — lost it exactly when it mattered most.
    const onError = Object.assign(new Error("boom"), { code: "ECONNREFUSED" });
    expect(describeDbError(onError)).toBe("boom [ECONNREFUSED]");

    const onCause = new Error("Failed query: select 1");
    (onCause as { cause?: unknown }).cause = { code: "ECONNREFUSED" };
    expect(describeDbError(onCause)).toBe("Failed query: select 1 [ECONNREFUSED]");
  });

  it("refuses to print anything when DATABASE_URL cannot be parsed", () => {
    // Its parts are unknown, so nothing can be checked against them. Printing
    // a message that might contain them is the one option not available.
    process.env.DATABASE_URL = "this is not a url";
    const out = describeDbError(new Error("connection to host secret.example.com failed"));
    expect(out).not.toContain("secret.example.com");
    expect(out).toContain("could not be parsed");
  });

  it("prints normally when no DATABASE_URL is configured", () => {
    // Nothing is set, so there is no credential to leak, and the message is
    // usually our own "DATABASE_URL is not set" — the most useful line there is.
    delete process.env.DATABASE_URL;
    expect(describeDbError(new Error("DATABASE_URL is not set"))).toBe("DATABASE_URL is not set");
  });

  it("leaves very short fragments alone rather than corrupting the sentence", () => {
    // A one- or two-character value would match inside ordinary words. A
    // credential that short is not what this defends, and mangling every
    // message to chase it costs more than it saves.
    process.env.DATABASE_URL = "postgres://a:b@c:1/d";
    expect(describeDbError(new Error("a cat sat on a mat"))).toBe("a cat sat on a mat");
  });

  it("handles a non-Error value without throwing", () => {
    expect(describeDbError("zz-host-9q7x.example.invalid refused")).toBe("[host] refused");
  });
});
