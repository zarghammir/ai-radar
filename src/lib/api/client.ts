import { fixtureBrief } from "@/lib/api/fixtures";
import type { BriefLengthParam, BriefResponse, StoryCard } from "@/lib/api/types";

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
