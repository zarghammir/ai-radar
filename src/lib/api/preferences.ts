import { BRIEF_LENGTHS, NOTIFICATION_CHANNELS } from "@/db/schema";
import type {
  BriefLength,
  BriefLengthParam,
  NotificationChannel,
  TopicSummary,
} from "@/lib/api/types";

/**
 * Total Records, like CONTENT_TYPE_LABELS: adding a value to the database
 * without a label here is a compile error rather than a blank control.
 */
export const BRIEF_LENGTH_LABELS: Record<BriefLength, { label: string; hint: string }> = {
  "5": { label: "Five minutes", hint: "The shortest useful read. Top stories only." },
  "10": { label: "Ten minutes", hint: "The default. Enough to catch the day." },
  // "FULL BRIEF", NOT "EVERYTHING" (#147). Today carries two controls and both
  // said "Everything" while meaning different things: this one lifts the
  // READING-TIME budget, and the view filter widens WHICH KINDS of story are
  // in the feed at all. A reader choosing "Everything" here and still not
  // seeing the news has been told, by the app, that they asked for everything.
  // The word now belongs to one control.
  all: { label: "Full brief", hint: "No time limit. Every story that passed the bar." },
};

export const NOTIFICATION_LABELS: Record<NotificationChannel, { label: string; hint: string }> = {
  none: { label: "Nothing", hint: "Open the app when you want it. Nothing is sent to you." },
  push: {
    label: "A push notification",
    hint: "On this device, once the brief is ready. You install the app first.",
  },
  email: {
    // No "to the address below" any more: #94 removed the address field,
    // because storing one for a feature that does not exist (#72) collects
    // personal data for nothing. The address is asked for when there is
    // something to send, by whatever identity model that feature needs.
    label: "An email",
    hint: "One message when the brief is ready. You will be asked where to send it when sending exists.",
  },
};

/** Ordered options, derived from the Record so the two cannot disagree. */
export const BRIEF_LENGTH_OPTIONS = BRIEF_LENGTHS.map((value) => ({
  value,
  ...BRIEF_LENGTH_LABELS[value],
}));

export const NOTIFICATION_OPTIONS = NOTIFICATION_CHANNELS.map((value) => ({
  value,
  ...NOTIFICATION_LABELS[value],
}));

/**
 * Narrows the stored string to a length this build can render.
 *
 * The column is plain text, so the value can be one this build has never heard
 * of. Falling back silently would leave the reader looking at a control that
 * shows "Ten minutes" while the database says something else, so callers that
 * can say so are given the fact that a fallback happened.
 */
export function asBriefLength(value: string): { length: BriefLengthParam; recognised: boolean } {
  const known = (BRIEF_LENGTHS as readonly string[]).includes(value);
  return { length: known ? (value as BriefLengthParam) : "10", recognised: known };
}

export function asNotificationChannel(value: string): {
  channel: NotificationChannel;
  recognised: boolean;
} {
  const known = (NOTIFICATION_CHANNELS as readonly string[]).includes(value);
  return { channel: known ? (value as NotificationChannel) : "none", recognised: known };
}

/**
 * The reader's own zone, as the browser reports it. Used to offer a default at
 * first run; never written behind their back, because a wrong guess silently
 * stored is a brief arriving at the wrong hour with nothing on screen to
 * explain it.
 */
export function detectTimezone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

/**
 * "07:30" said the way a person reads a clock. Returns the input unchanged if
 * it is not a time this build understands — showing the raw stored value beats
 * showing "Invalid Date".
 *
 * There is no timezone parameter on purpose: briefTime is ALREADY expressed in
 * the reader's chosen zone, so handing it to a formatter with that zone would
 * move it twice. Screens show the zone as its own line beside this.
 */
export function formatBriefTime(time: string): string {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);
  if (!match) return time;
  const [, hours, minutes] = match;
  const date = new Date(Date.UTC(2000, 0, 1, Number(hours), Number(minutes)));
  try {
    return new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
      timeZone: "UTC",
    }).format(date);
  } catch {
    return time;
  }
}

/** The three buckets Settings groups interests into, in the order they read. */
export const TOPIC_GROUPS = [
  { key: "company", heading: "Companies and labs" },
  { key: "domain", heading: "Areas" },
  { key: "field", heading: "Fields of work" },
] as const;

/** Anything whose group this build does not recognise. Shown, never dropped. */
export const OTHER_TOPIC_GROUP = { key: "other", heading: "Everything else" } as const;

/**
 * Buckets the catalogue for display.
 *
 * A topic whose group this build does not recognise goes into "Everything
 * else" rather than being dropped: a subject that exists and is not shown is a
 * subject the reader cannot choose or unchoose, and they would have no way of
 * knowing it was there. Empty buckets are omitted — a heading over nothing
 * says less than no heading.
 */
export function groupTopics(topics: TopicSummary[]) {
  const known = new Set<string>(TOPIC_GROUPS.map((g) => g.key));
  return [...TOPIC_GROUPS, OTHER_TOPIC_GROUP]
    .map((group) => ({
      key: group.key as string,
      heading: group.heading as string,
      topics: topics.filter((t) =>
        group.key === OTHER_TOPIC_GROUP.key ? !known.has(t.group) : t.group === group.key,
      ),
    }))
    .filter((bucket) => bucket.topics.length > 0);
}
