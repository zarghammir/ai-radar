import { FIXTURE_STORIES } from "@/lib/api/fixtures";
import type { Preferences, TopicSummary } from "@/lib/api/types";

/**
 * The reader's own state while the app runs on fixtures.
 *
 * It lives here rather than spreading through the client so that what is
 * pretend stays visible in one file: when NEXT_PUBLIC_USE_FIXTURES is off,
 * nothing in this module is reached. Every function is a NO-OP SHAPE on the
 * server, where there is no localStorage, and every read is wrapped — a
 * browser in private mode throws on access rather than returning null.
 *
 * Unreadable storage answers "I do not know", and the answer is never written
 * back over whatever is there. Writes only ever persist a value the caller
 * built from a read that succeeded.
 */
const MARKS_KEY = "ai-radar-fixture-marks";
const READ_KEY = "ai-radar-fixture-read";
const PREFERENCES_KEY = "ai-radar-fixture-preferences";

function readJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private mode refuses storage. The change still applies for this session.
  }
}

export interface SavedMarks {
  note: string | null;
  tags: string[];
  savedAt: string;
}

export function localMarks(): Record<string, SavedMarks> {
  const raw = readJson<unknown>(MARKS_KEY, {});
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, SavedMarks> = {};
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== "object") continue;
    const mark = value as Partial<SavedMarks>;
    out[id] = {
      note: typeof mark.note === "string" ? mark.note : null,
      tags: Array.isArray(mark.tags) ? mark.tags.filter((t) => typeof t === "string") : [],
      savedAt: typeof mark.savedAt === "string" ? mark.savedAt : new Date().toISOString(),
    };
  }
  return out;
}

export function writeLocalMarks(id: number, marks: SavedMarks | null): void {
  const all = localMarks();
  if (marks === null) delete all[String(id)];
  else all[String(id)] = marks;
  writeJson(MARKS_KEY, all);
}

export function localReadIds(): Set<number> {
  const raw = readJson<unknown>(READ_KEY, []);
  return new Set(Array.isArray(raw) ? raw.filter((n): n is number => typeof n === "number") : []);
}

export function writeLocalRead(id: number, read: boolean): void {
  const ids = localReadIds();
  if (read) ids.add(id);
  else ids.delete(id);
  writeJson(READ_KEY, [...ids]);
}

/** Mirrors DEFAULTS in src/api/reader.ts, which is what a fresh row holds. */
export const FIXTURE_PREFERENCE_DEFAULTS: Preferences = {
  topicKeys: [],
  briefTime: "07:30",
  timezone: "UTC",
  briefLength: "10",
  notificationChannel: "none",
  email: null,
  theme: "system",
  onboardedAt: null,
  updatedAt: "1970-01-01T00:00:00.000Z",
};

export function localPreferences(): Preferences {
  const stored = readJson<Partial<Preferences>>(PREFERENCES_KEY, {});
  return { ...FIXTURE_PREFERENCE_DEFAULTS, ...stored };
}

export function patchLocalPreferences(patch: Partial<Preferences>): Preferences {
  const next: Preferences = {
    ...localPreferences(),
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  writeJson(PREFERENCES_KEY, next);
  return next;
}

/**
 * The topics the fixture stories actually carry, counted the way /api/topics
 * counts them. Derived rather than listed, so a topic added to a fixture story
 * appears in Settings without a second edit — the two cannot drift.
 */
export function fixtureTopics(): TopicSummary[] {
  const counts = new Map<string, TopicSummary>();
  for (const story of FIXTURE_STORIES) {
    for (const topic of story.topics) {
      const existing = counts.get(topic.key);
      if (existing) existing.storyCount += 1;
      else counts.set(topic.key, { ...topic, storyCount: 1 });
    }
  }
  return [...counts.values()].sort(
    (a, b) => b.storyCount - a.storyCount || a.name.localeCompare(b.name),
  );
}
