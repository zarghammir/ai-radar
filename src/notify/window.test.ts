import { describe, expect, it } from "vitest";
import { decideSend, localDay, localMinutes, parseBriefTime } from "./window";

const AT = (iso: string) => new Date(iso);

describe("parseBriefTime", () => {
  it("reads a HH:MM time", () => {
    expect(parseBriefTime("07:30")).toBe(450);
    expect(parseBriefTime("00:00")).toBe(0);
    expect(parseBriefTime("23:59")).toBe(1439);
  });

  // Null rather than a default. A malformed preference must never become a
  // delivery at an hour nobody chose — midnight least of all.
  it.each(["7:30", "0730", "24:00", "07:60", "", "morning"])("refuses %s", (value) => {
    expect(parseBriefTime(value)).toBeNull();
  });
});

describe("localDay and localMinutes", () => {
  it("are the reader's day and clock, not the server's", () => {
    // 23:30 UTC is already the next day in Auckland and still yesterday in
    // Los Angeles. A brief keyed on the server's date would send twice to one
    // and skip the other.
    const at = AT("2026-09-22T23:30:00Z");
    expect(localDay(at, "UTC")).toBe("2026-09-22");
    expect(localDay(at, "Pacific/Auckland")).toBe("2026-09-23");
    expect(localDay(at, "America/Los_Angeles")).toBe("2026-09-22");
    expect(localMinutes(at, "UTC")).toBe(23 * 60 + 30);
  });

  it("reads midnight as zero rather than 1440", () => {
    expect(localMinutes(AT("2026-09-22T00:00:00Z"), "UTC")).toBe(0);
  });
});

describe("decideSend", () => {
  const base = { timezone: "UTC", briefTime: "07:30", lastSentDay: null };

  it("does not send before the reader's brief time", () => {
    const d = decideSend({ ...base, now: AT("2026-09-22T06:00:00Z") });
    expect(d.send).toBe(false);
    if (!d.send) expect(d.reason).toContain("not yet");
  });

  it("sends on the first pass at or after it", () => {
    expect(decideSend({ ...base, now: AT("2026-09-22T07:30:00Z") }).send).toBe(true);
    // The collector lands about seven times a day, so "the first pass after"
    // can be hours late. That is the promise the UI makes, and it is this one.
    expect(decideSend({ ...base, now: AT("2026-09-22T11:05:00Z") }).send).toBe(true);
  });

  it("sends only once a day", () => {
    const d = decideSend({
      ...base,
      now: AT("2026-09-22T11:05:00Z"),
      lastSentDay: "2026-09-22",
    });
    expect(d.send).toBe(false);
    if (!d.send) expect(d.reason).toContain("already been sent");
  });

  it("sends again the next day", () => {
    expect(
      decideSend({ ...base, now: AT("2026-09-23T07:35:00Z"), lastSentDay: "2026-09-22" }).send,
    ).toBe(true);
  });

  // The decision is made in the reader's zone throughout. Keyed on UTC, a
  // reader in Auckland would be told at the wrong end of their day.
  it("uses the reader's zone for both the clock and the day", () => {
    const at = AT("2026-09-22T20:00:00Z"); // 08:00 on the 23rd in Auckland
    const d = decideSend({ ...base, timezone: "Pacific/Auckland", now: at });
    expect(d.send).toBe(true);
    expect(d.localDay).toBe("2026-09-23");
  });

  it("refuses rather than guessing when the preference is unreadable", () => {
    const badTime = decideSend({
      ...base,
      briefTime: "half seven",
      now: AT("2026-09-22T09:00:00Z"),
    });
    expect(badTime.send).toBe(false);

    const badZone = decideSend({
      ...base,
      timezone: "Mars/Olympus_Mons",
      now: AT("2026-09-22T09:00:00Z"),
    });
    expect(badZone.send).toBe(false);
    if (!badZone.send) expect(badZone.reason).toContain("Intl");
  });
});
