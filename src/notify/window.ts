/**
 * Whether now is the moment to send today's brief.
 *
 * Pure, and separated from everything that sends, because this is where the
 * product decision lives and it is the part worth testing exhaustively.
 *
 * THE HONEST MEANING OF "07:30". The collector does not run every thirty
 * minutes; GitHub de-prioritises scheduled workflows and it lands about seven
 * times a day (#139). So the brief cannot arrive AT the chosen time and this
 * module does not pretend it can: the rule is THE FIRST PASS AT OR AFTER the
 * chosen time, once per local day. The Settings copy says the same sentence,
 * because a promise in the UI that the scheduler cannot keep is the defect,
 * not the delay.
 */

export type SendDecision =
  { send: true; localDay: string } | { send: false; localDay: string; reason: string };

/** The calendar day in a zone, as YYYY-MM-DD. en-CA formats in that order. */
export function localDay(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

/** Minutes since local midnight, in a zone. */
export function localMinutes(at: Date, timeZone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
    })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  // Midnight formats as hour 24 in some locales.
  return (Number(parts.hour) % 24) * 60 + Number(parts.minute);
}

/**
 * "07:30" as minutes since midnight, or null if it is not a time.
 *
 * Null rather than a default: the caller decides what an unreadable
 * preference means, and here it means "do not send", never "send at midnight".
 * A malformed value must not become a delivery at an hour nobody chose.
 */
export function parseBriefTime(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

export interface SendWindowInput {
  now: Date;
  briefTime: string;
  timezone: string;
  /** The local day of the most recent recorded delivery, or null for never. */
  lastSentDay: string | null;
}

/**
 * The decision, with the reason travelling with a "no".
 *
 * "Not yet" and "already sent" are different states and the worker logs them
 * differently; a bare false would make a brief that never arrives look
 * identical to one that arrived at seven.
 */
export function decideSend({
  now,
  briefTime,
  timezone,
  lastSentDay,
}: SendWindowInput): SendDecision {
  let day: string;
  let minutesNow: number;
  try {
    day = localDay(now, timezone);
    minutesNow = localMinutes(now, timezone);
  } catch {
    // An unknown zone string reaches Intl as a throw. The stored value is
    // free text, so this is reachable from the database rather than only
    // from a bug.
    return { send: false, localDay: "", reason: `timezone "${timezone}" is not one Intl knows` };
  }

  const target = parseBriefTime(briefTime);
  if (target === null) {
    return { send: false, localDay: day, reason: `brief time "${briefTime}" is not a HH:MM time` };
  }

  if (lastSentDay === day) {
    return { send: false, localDay: day, reason: "today's brief has already been sent" };
  }

  if (minutesNow < target) {
    return { send: false, localDay: day, reason: `not yet ${briefTime} where the reader is` };
  }

  return { send: true, localDay: day };
}
