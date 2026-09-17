import { describe, expect, it } from "vitest";
import { BRIEF_LENGTHS, NOTIFICATION_CHANNELS } from "@/db/schema";
import {
  BRIEF_LENGTH_LABELS,
  BRIEF_LENGTH_OPTIONS,
  NOTIFICATION_LABELS,
  NOTIFICATION_OPTIONS,
  OTHER_TOPIC_GROUP,
  TOPIC_GROUPS,
  asBriefLength,
  asNotificationChannel,
  formatBriefTime,
  groupTopics,
} from "@/lib/api/preferences";
import type { TopicSummary } from "@/lib/api/types";

describe("preference labels", () => {
  // The lists come from the DATABASE's own enums, so adding a value without a
  // label fails here rather than shipping a control with a blank row. The
  // length assertions are FLOORS: a Record derived from an empty list would
  // satisfy every loop below without checking anything.
  it("labels every brief length the database can store", () => {
    expect(BRIEF_LENGTHS.length).toBe(3);
    for (const value of BRIEF_LENGTHS) {
      expect(BRIEF_LENGTH_LABELS[value]?.label.trim(), `no label for ${value}`).toBeTruthy();
      expect(BRIEF_LENGTH_LABELS[value]?.hint.trim(), `no hint for ${value}`).toBeTruthy();
    }
  });

  it("labels every notification channel the database can store", () => {
    expect(NOTIFICATION_CHANNELS.length).toBe(3);
    for (const value of NOTIFICATION_CHANNELS) {
      expect(NOTIFICATION_LABELS[value]?.label.trim(), `no label for ${value}`).toBeTruthy();
      expect(NOTIFICATION_LABELS[value]?.hint.trim(), `no hint for ${value}`).toBeTruthy();
    }
  });

  it("offers exactly the stored values as options, in the database's order", () => {
    expect(BRIEF_LENGTH_OPTIONS.map((o) => o.value)).toEqual([...BRIEF_LENGTHS]);
    expect(NOTIFICATION_OPTIONS.map((o) => o.value)).toEqual([...NOTIFICATION_CHANNELS]);
  });

  it("asks for no address at all, and the route REFUSES one", async () => {
    // #94 removed the email field: it stored an address for a feature that
    // does not exist (#72), and on a shared instance that is one person's
    // personal data served to the next person who opens Settings.
    //
    // Asserting the label no longer mentions an address would only prove the
    // UI stopped asking. This drives the REAL schema, which is .strict(), so a
    // client that still sends one is rejected rather than silently ignored —
    // the difference between the field being gone and being hidden.
    for (const option of NOTIFICATION_OPTIONS) {
      expect(option, `${option.value} still declares an address flag`).not.toHaveProperty(
        "needsEmail",
      );
    }
    const { preferencesPatchSchema } = await import("@/api/reader");
    expect(preferencesPatchSchema.safeParse({ email: "reader@example.com" }).success).toBe(false);
    // The positive beside the negative: the schema still accepts what it should.
    expect(preferencesPatchSchema.safeParse({ briefTime: "07:30" }).success).toBe(true);
  });
});

describe("narrowing a stored value", () => {
  it("accepts what the database can hold and says it recognised it", () => {
    for (const value of BRIEF_LENGTHS) {
      expect(asBriefLength(value)).toEqual({ length: value, recognised: true });
    }
    for (const value of NOTIFICATION_CHANNELS) {
      expect(asNotificationChannel(value)).toEqual({ channel: value, recognised: true });
    }
  });

  it("REPORTS an unknown value rather than silently becoming the default", () => {
    // The columns are plain text and only the write path validates them, so a
    // build that has never heard of a value can read one. Falling back is
    // fine; falling back without saying so leaves a screen showing "Ten
    // minutes" while the database says something else.
    expect(asBriefLength("30")).toEqual({ length: "10", recognised: false });
    expect(asBriefLength("")).toEqual({ length: "10", recognised: false });
    expect(asNotificationChannel("sms")).toEqual({ channel: "none", recognised: false });
  });
});

describe("formatBriefTime", () => {
  it("renders a stored time as a clock reading", () => {
    const formatted = formatBriefTime("07:30");
    expect(formatted).not.toBe("07:30");
    expect(formatted).toMatch(/7/);
    expect(formatted).toMatch(/30/);
  });

  it("hands back anything it cannot read, rather than Invalid Date", () => {
    for (const bad of ["", "7:30", "25:00", "07:60", "half past", "07:30:00"]) {
      expect(formatBriefTime(bad), `mangled ${JSON.stringify(bad)}`).toBe(bad);
    }
  });
});

function topic(key: string, group: string, storyCount = 1): TopicSummary {
  return { key, name: key, group, storyCount };
}

describe("grouping topics for display", () => {
  const catalogue = [
    topic("openai", "company"),
    topic("funding", "domain"),
    topic("agents", "field"),
    // A group this build has never heard of. The database column is plain
    // text, so one can arrive from an older or newer build.
    topic("hardware-supply", "sector"),
  ];

  it("shows every topic it is given, including one in a group it cannot name", () => {
    const groups = groupTopics(catalogue);
    const shown = groups.flatMap((g) => g.topics.map((t) => t.key));
    // The floor and the point of the test in one line: nothing is dropped.
    expect(shown.length).toBe(catalogue.length);
    expect(new Set(shown)).toEqual(new Set(catalogue.map((t) => t.key)));
  });

  it("puts the unrecognised group in the visible catch-all bucket", () => {
    const groups = groupTopics(catalogue);
    const other = groups.find((g) => g.key === OTHER_TOPIC_GROUP.key);
    expect(other?.topics.map((t) => t.key)).toEqual(["hardware-supply"]);
  });

  it("keeps the known groups in their reading order", () => {
    const groups = groupTopics(catalogue);
    expect(groups.slice(0, TOPIC_GROUPS.length).map((g) => g.key)).toEqual(
      TOPIC_GROUPS.map((g) => g.key),
    );
  });

  it("omits a bucket with nothing in it", () => {
    const groups = groupTopics([topic("openai", "company")]);
    expect(groups.map((g) => g.key)).toEqual(["company"]);
  });

  it("returns nothing at all for an empty catalogue", () => {
    expect(groupTopics([])).toEqual([]);
  });
});
