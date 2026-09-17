import { getTopics, USING_FIXTURES } from "@/lib/api/client";
import type { TopicSummary } from "@/lib/api/types";

/**
 * SERVER ONLY. Nothing with "use client" may import this module — see the same
 * note on brief-length.ts. The dynamic import below keeps the database client
 * out of browser bundles; it is not a guard against being imported from one.
 *
 * The catalogue of subjects, read the way a SERVER component must.
 *
 * Against the real API it calls the same function the route calls. It does NOT
 * fetch /api/topics: a server component asking its own app for a relative URL
 * has no origin to resolve it against, so the request throws on every load —
 * and `loadTopics` below would catch it and report "the list of subjects could
 * not be read", every time, forever. The Interests panel would be permanently
 * and honestly broken, which is the worst kind: nothing looks wrong with it.
 *
 * A FIXTURE PATH CANNOT EXERCISE A RELATIVE FETCH. Every call that works in
 * fixture mode is untested against the mode it will actually run in, so each
 * one is worth checking rather than assuming. This is the third instance of
 * this defect in this screen family; the first two were in Today.
 */
async function readTopics(): Promise<TopicSummary[]> {
  if (USING_FIXTURES) return getTopics();
  const [{ getDb }, catalogue] = await Promise.all([
    import("@/db/client"),
    import("@/api/catalogue"),
  ]);
  return catalogue.listTopics(getDb(), new Date());
}

/**
 * `null` means the read FAILED, which is a different answer from an empty
 * list: no subjects yet is a fact about a young install, an unreadable
 * catalogue is a fact about the app. Settings and the welcome screen say
 * something different for each, and neither offers to change what the reader
 * follows while it cannot see what they follow.
 */
export async function loadTopics(): Promise<TopicSummary[] | null> {
  try {
    return await readTopics();
  } catch (error) {
    console.error("catalogue: could not read the topics", error);
    return null;
  }
}
