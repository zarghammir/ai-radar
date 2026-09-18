import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { describeError } from "./describe-error";

/**
 * describeError builds the string that is STORED in sources.lastError and
 * ingestRuns.error — and GET /api/sources serves lastError to anyone, with no
 * authentication (#99). So the promise here is not "the log is clean". It is:
 * NO FRAGMENT OF DATABASE_URL SURVIVES INTO THE STORED VALUE.
 *
 * Every message below was CAPTURED from a real failure driven through the same
 * call site (a db.transaction inside the per-source try), not invented:
 *
 *   getaddrinfo ENOTFOUND zz-host-9q7x.example.invalid   <- host
 *   role "UsrFake9q7x" does not exist                    <- user, the SERVER's own sentence
 *   write CONNECT_TIMEOUT 10.255.255.1:59999             <- host and port
 *
 * The middle one is why the remedy is value-based rather than a filter: it is
 * text Postgres wrote, not text this codebase or its driver formatted, and
 * there is no pattern that could have been written for it in advance.
 */
const URL_ = "postgres://UsrFake9q7x:PwFake9q7x@zz-host-9q7x.example.invalid:59999/DbFake9q7x";
const FRAGMENTS = [
  "UsrFake9q7x",
  "PwFake9q7x",
  "zz-host-9q7x.example.invalid",
  "59999",
  "DbFake9q7x",
];

const CAPTURED = [
  {
    shape: "ENOTFOUND — a typo'd or wrong-region hostname",
    message: "getaddrinfo ENOTFOUND zz-host-9q7x.example.invalid",
    keeps: "ENOTFOUND",
  },
  {
    shape: "the Postgres server's own sentence, which names the role",
    message: 'role "UsrFake9q7x" does not exist',
    keeps: "does not exist",
  },
  {
    shape: "CONNECT_TIMEOUT — a suspended compute, host and port in the message",
    message: "write CONNECT_TIMEOUT zz-host-9q7x.example.invalid:59999",
    keeps: "CONNECT_TIMEOUT",
  },
];

describe("describeError", () => {
  let saved: string | undefined;
  beforeEach(() => {
    saved = process.env.DATABASE_URL;
    process.env.DATABASE_URL = URL_;
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = saved;
  });

  for (const { shape, message, keeps } of CAPTURED) {
    it(`stores no credential fragment: ${shape}`, () => {
      // The fixture must carry something worth redacting, or a clean result
      // below proves nothing. The control lives beside the assertion it guards.
      expect(FRAGMENTS.some((f) => message.includes(f))).toBe(true);

      const stored = describeError(new Error(message));
      for (const fragment of FRAGMENTS) expect(stored).not.toContain(fragment);

      // The positive beside the negatives. An operator still learns what broke:
      // a function returning "" would satisfy every assertion above.
      expect(stored).toContain(keeps);
    });
  }

  it("keeps the failing statement and the database's own words, which is the whole point of the cause chain", () => {
    // describeError exists so an operator is not left with "the statement that
    // failed and no idea why". Redaction must not cost that: the host is not
    // information to someone who owns the database, but the SQL and the
    // constraint name are.
    const cause = new Error('duplicate key value violates unique constraint "raw_items_url_key"');
    const wrapper = new Error(
      'Failed query: insert into "raw_items" ... on conflict do nothing at zz-host-9q7x.example.invalid',
    );
    (wrapper as { cause?: unknown }).cause = cause;

    const stored = describeError(wrapper);
    expect(stored).not.toContain("zz-host-9q7x.example.invalid");
    expect(stored).toContain("Failed query:");
    expect(stored).toContain("raw_items_url_key");
    expect(stored).toContain("duplicate key value");
  });

  it("walks the cause chain and redacts a fragment that only appears deeper in it", () => {
    // The fragment is on the CAUSE, not the top message — the arrangement
    // postgres.js actually produces for a query that failed on a dead socket.
    const cause = new Error("write CONNECT_TIMEOUT zz-host-9q7x.example.invalid:59999");
    const wrapper = new Error("Failed query: select 1");
    (wrapper as { cause?: unknown }).cause = cause;

    const stored = describeError(wrapper);
    expect(stored).not.toContain("zz-host-9q7x.example.invalid");
    expect(stored).not.toContain("59999");
    expect(stored).toContain("Failed query: select 1");
    expect(stored).toContain("CONNECT_TIMEOUT");
  });

  it("prints normally when no DATABASE_URL is configured", () => {
    delete process.env.DATABASE_URL;
    expect(describeError(new Error("HTTP 403 from the publisher"))).toBe(
      "HTTP 403 from the publisher",
    );
  });

  it("leaves an ordinary source failure untouched", () => {
    // Most stored errors are not database errors at all. A feed that 403s must
    // still read as a feed that 403s — this is the case that would notice a
    // redaction so aggressive it mangled unrelated diagnostics.
    const stored = describeError(new Error("HTTP 403 fetching https://example.com/feed.xml"));
    expect(stored).toBe("HTTP 403 fetching https://example.com/feed.xml");
  });
});
