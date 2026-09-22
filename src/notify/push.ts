import { authorizationHeader, type VapidKeys } from "./vapid";

/** Injected in tests; production passes nothing and gets the global. */
export type FetchLike = typeof globalThis.fetch;

/**
 * What one push attempt turned into.
 *
 * `gone` is separated from `failed` because they need opposite handling: a
 * subscription the push service has retired must be DELETED, and one that
 * failed for any other reason must be KEPT. Collapsing them either leaks dead
 * rows forever or throws away a working reader over one bad night.
 */
export type PushOutcome =
  { kind: "delivered" } | { kind: "gone"; detail: string } | { kind: "failed"; detail: string };

/** A slow push service must not hold up a pass that has already done its work. */
export const PUSH_TIMEOUT_MS = 10_000;

/** How long the push service should hold the message for a device that is off. */
export const PUSH_TTL_SECONDS = 6 * 60 * 60;

/**
 * Wake one browser.
 *
 * NO BODY IS SENT. The service worker fetches the brief when it receives this,
 * which keeps the payload encryption of RFC 8291 out of the codebase and makes
 * the notification's text current when it is READ rather than when it was
 * queued. See vapid.ts for the trade.
 */
export async function sendPush(
  keys: VapidKeys,
  endpoint: string,
  now: Date,
  fetchImpl?: FetchLike,
): Promise<PushOutcome> {
  const doFetch: FetchLike = fetchImpl ?? globalThis.fetch;

  let authorization: string;
  try {
    authorization = authorizationHeader(keys, endpoint, now);
  } catch (error) {
    // A malformed key pair is a configuration fault, not a dead subscription.
    return { kind: "failed", detail: error instanceof Error ? error.message : String(error) };
  }

  let response: Response;
  try {
    response = await doFetch(endpoint, {
      method: "POST",
      headers: {
        authorization,
        ttl: String(PUSH_TTL_SECONDS),
        "content-length": "0",
        urgency: "normal",
      },
      signal: AbortSignal.timeout(PUSH_TIMEOUT_MS),
    });
  } catch (error) {
    return { kind: "failed", detail: error instanceof Error ? error.message : String(error) };
  }

  if (response.status === 404 || response.status === 410) {
    return { kind: "gone", detail: `push service returned ${response.status}` };
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    const tail = body.slice(0, 160).replace(/\s+/g, " ").trim();
    return { kind: "failed", detail: `HTTP ${response.status}${tail ? `: ${tail}` : ""}` };
  }

  return { kind: "delivered" };
}
