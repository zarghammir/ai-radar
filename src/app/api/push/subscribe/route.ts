import { sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { pushSubscriptions } from "@/db/schema";
import { ApiError, handle, json } from "@/api/http";

/**
 * A browser asking to be told when the brief is ready.
 *
 * PUBLIC ON PURPOSE, because there are no accounts: the reader's browser has
 * no secret to present, and requiring one would mean nobody could ever
 * subscribe. What that costs is bounded rather than ignored — see the ceiling
 * below.
 *
 * It writes a row and sends nothing. No outbound request happens here, so a
 * visitor cannot make this instance talk to a push service by calling it.
 */

/**
 * The most browsers one self-hosted instance will remember.
 *
 * An unauthenticated write with no ceiling is an unbounded table, and a table
 * that only grows is a slow outage rather than an attack. Fifty is far above
 * what a personal instance needs and far below a problem; re-subscribing an
 * existing browser updates its row and never counts against this.
 */
export const MAX_SUBSCRIPTIONS = 50;

interface SubscribeBody {
  endpoint?: unknown;
  keys?: { p256dh?: unknown; auth?: unknown };
}

function readString(value: unknown, field: string, max: number): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ApiError("VALIDATION_ERROR", `${field} is required`);
  }
  const trimmed = value.trim();
  if (trimmed.length > max) throw new ApiError("VALIDATION_ERROR", `${field} is too long`);
  return trimmed;
}

export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    let body: SubscribeBody;
    try {
      body = (await request.json()) as SubscribeBody;
    } catch {
      throw new ApiError("VALIDATION_ERROR", "body must be JSON");
    }

    const endpoint = readString(body.endpoint, "endpoint", 2048);
    // https only: a push endpoint is always https, and refusing anything else
    // keeps this from being a way to record arbitrary URLs on the instance.
    if (!endpoint.startsWith("https://")) {
      throw new ApiError("VALIDATION_ERROR", "endpoint must be an https URL");
    }
    const p256dh = readString(body.keys?.p256dh, "keys.p256dh", 256);
    const auth = readString(body.keys?.auth, "keys.auth", 256);

    const db = getDb();
    const [{ count }] = await db.select({ count: sql<string>`count(*)` }).from(pushSubscriptions);

    // Counted before the upsert, and the upsert is what makes this correct for
    // a browser that is already here: an existing endpoint updates in place
    // and is not refused by a full table.
    const existing = await db
      .select({ id: pushSubscriptions.id })
      .from(pushSubscriptions)
      .where(sql`${pushSubscriptions.endpoint} = ${endpoint}`)
      .limit(1);

    if (existing.length === 0 && Number(count) >= MAX_SUBSCRIPTIONS) {
      // VALIDATION_ERROR because the shared error vocabulary has no "too
      // many" code, and inventing one here would put a fifth value in a union
      // every client branches on for the sake of one route. The message says
      // what actually happened.
      throw new ApiError(
        "VALIDATION_ERROR",
        `this instance already remembers ${MAX_SUBSCRIPTIONS} browsers, which is its limit`,
      );
    }

    await db
      .insert(pushSubscriptions)
      .values({ endpoint, p256dh, auth })
      .onConflictDoUpdate({
        target: pushSubscriptions.endpoint,
        // Re-subscribing is how a browser recovers from a rotated key, so the
        // keys are refreshed and the failure history is cleared with them.
        set: { p256dh, auth, lastError: null, failureCount: 0 },
      });

    return json({ subscribed: true });
  });
}
