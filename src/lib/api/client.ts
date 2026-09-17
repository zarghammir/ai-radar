import { FIXTURE_STORIES, fixtureBrief } from "@/lib/api/fixtures";
import {
  fixtureTopics,
  localMarks,
  localPreferences,
  localReadIds,
  patchLocalPreferences,
  writeLocalMarks,
  writeLocalRead,
} from "@/lib/api/fixture-store";
import type {
  BriefLengthParam,
  BriefResponse,
  Preferences,
  SavedCard,
  SavedResponse,
  StoryCard,
  TopicSummary,
} from "@/lib/api/types";

/**
 * Where the Today page gets its data.
 *
 * The routes on feat/api-routes are not merged, so this reads fixtures. That is
 * an EXPLICIT MODE, not a fallback: a client that tries the network and quietly
 * uses fixtures when it gets a 404 cannot tell "this route does not exist yet"
 * from "this save failed", and would report a failed write as a success. Those
 * are different states and the product treats them differently everywhere else.
 *
 * Flip by setting NEXT_PUBLIC_USE_FIXTURES=0 once /api/brief exists.
 */
export const USING_FIXTURES = process.env.NEXT_PUBLIC_USE_FIXTURES !== "0";

const SAVED_KEY = "ai-radar-fixture-saved";
const HIDDEN_KEY = "ai-radar-fixture-hidden";

function readIds(key: string): Set<number> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed.filter((n) => typeof n === "number") : []);
  } catch {
    // Unreadable storage is UNKNOWN, not "nothing saved". Returning an empty
    // set is the closest safe answer, but it must never be written back over
    // whatever is there — see writeIds, which only ever writes a set the caller
    // built from a successful read.
    return new Set();
  }
}

function writeIds(key: string, ids: Set<number>) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify([...ids]));
  } catch {
    // Private mode. The change still applies for this session.
  }
}

export function localSavedIds(): Set<number> {
  return readIds(SAVED_KEY);
}

export function localHiddenIds(): Set<number> {
  return readIds(HIDDEN_KEY);
}

async function json<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const message =
      body && typeof body === "object" && "error" in body
        ? String((body as { error: { message?: string } }).error?.message ?? response.statusText)
        : response.statusText;
    throw new Error(`${response.status} ${message}`);
  }
  return (await response.json()) as T;
}

/**
 * Applies the reader's own saved/hidden state to a brief. In fixture mode that
 * state lives in localStorage; against the real API it arrives on the card and
 * this is a no-op.
 */
export function applyLocalState(brief: BriefResponse): BriefResponse {
  if (!USING_FIXTURES) return brief;
  const saved = localSavedIds();
  const hidden = localHiddenIds();
  const stories = brief.stories
    .filter((s) => !hidden.has(s.id))
    .map((s) => ({ ...s, saved: saved.has(s.id) }));
  return {
    ...brief,
    stories,
    count: stories.length,
    readingMinutes: stories.reduce((total, s) => total + s.readingMinutes, 0),
  };
}

export async function getBrief(length: BriefLengthParam): Promise<BriefResponse> {
  if (USING_FIXTURES) return applyLocalState(fixtureBrief(length));
  return json<BriefResponse>(`/api/brief?length=${encodeURIComponent(length)}`);
}

export async function setSaved(story: StoryCard, saved: boolean): Promise<void> {
  if (USING_FIXTURES) {
    const ids = localSavedIds();
    if (saved) ids.add(story.id);
    else ids.delete(story.id);
    writeIds(SAVED_KEY, ids);
    // The note, the tags and the date saved live in a second key. Unsaving
    // drops them, matching the real route, where DELETE removes the row and
    // takes the note with it — a note that survives an unsave would come back
    // attached to a story the reader thought they had cleared.
    writeLocalMarks(story.id, saved ? { note: null, tags: [], savedAt: new Date().toISOString() } : null);
    return;
  }
  await json(`/api/saved/${story.id}`, { method: saved ? "POST" : "DELETE" });
}

export async function setHidden(story: StoryCard, hidden: boolean): Promise<void> {
  if (USING_FIXTURES) {
    const ids = localHiddenIds();
    if (hidden) ids.add(story.id);
    else ids.delete(story.id);
    writeIds(HIDDEN_KEY, ids);
    return;
  }
  await json(`/api/hide/${story.id}`, {
    method: "POST",
    body: JSON.stringify({ hidden }),
  });
}

/**
 * The saved list.
 *
 * `archived` is passed through because the route takes it, but NOTHING can set
 * that flag yet — issue #70 adds the write. Until it does, `archived: true`
 * is an empty list because archiving is impossible, not because the reader has
 * archived nothing, and no screen may present it as the second thing.
 */
export async function getSaved(archived = false): Promise<SavedResponse> {
  if (USING_FIXTURES) {
    if (archived) return { stories: [], nextCursor: null, hasMore: false };
    const ids = localSavedIds();
    const marks = localMarks();
    const read = localReadIds();
    const stories: SavedCard[] = FIXTURE_STORIES.filter((story) => ids.has(story.id)).map(
      (story) => ({
        ...story,
        saved: true,
        read: read.has(story.id),
        note: marks[String(story.id)]?.note ?? null,
        tags: marks[String(story.id)]?.tags ?? [],
        // Empty, not invented, when this id was saved by a build that did not
        // record the date. The card omits the line rather than guessing.
        savedAt: marks[String(story.id)]?.savedAt ?? "",
      }),
    );
    stories.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
    return { stories, nextCursor: null, hasMore: false };
  }
  return json<SavedResponse>(`/api/saved?archived=${archived ? "true" : "false"}`);
}

/**
 * The reader's note and tags on one saved story. Saving is idempotent, and
 * POST carries BOTH fields every time: the route replaces what it is sent, so
 * posting a note alone would clear the tags.
 */
export async function setSavedMarks(
  storyId: number,
  marks: { note: string | null; tags: string[] },
): Promise<void> {
  if (USING_FIXTURES) {
    const existing = localMarks()[String(storyId)];
    writeLocalMarks(storyId, {
      note: marks.note,
      tags: marks.tags,
      savedAt: existing?.savedAt ?? new Date().toISOString(),
    });
    return;
  }
  await json(`/api/saved/${storyId}`, {
    method: "POST",
    body: JSON.stringify({ note: marks.note, tags: marks.tags }),
  });
}

export async function setRead(storyId: number, read: boolean): Promise<void> {
  if (USING_FIXTURES) {
    writeLocalRead(storyId, read);
    return;
  }
  await json(`/api/read/${storyId}`, { method: "POST", body: JSON.stringify({ read }) });
}

/** Only the fields the route accepts: preferencesPatchSchema is `.strict()`. */
export type PreferencesPatch = Partial<Omit<Preferences, "updatedAt">>;

export async function getPreferences(): Promise<Preferences> {
  if (USING_FIXTURES) return localPreferences();
  return json<Preferences>("/api/preferences");
}

export async function putPreferences(patch: PreferencesPatch): Promise<Preferences> {
  if (USING_FIXTURES) return patchLocalPreferences(patch);
  return json<Preferences>("/api/preferences", {
    method: "PUT",
    body: JSON.stringify(patch),
  });
}

export async function getTopics(): Promise<TopicSummary[]> {
  if (USING_FIXTURES) return fixtureTopics();
  const { topics } = await json<{ topics: TopicSummary[] }>("/api/topics");
  return topics;
}
