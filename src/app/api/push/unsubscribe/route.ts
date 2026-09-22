import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { pushSubscriptions } from "@/db/schema";
import { ApiError, handle, json } from "@/api/http";

/**
 * A browser saying it no longer wants the brief.
 *
 * Deleting by the endpoint the caller supplies is safe without a secret for
 * the same reason it is useless to an attacker: the endpoint IS the browser's
 * own address, and knowing someone else's means already being able to push to
 * them. The worst a caller can do with one they do not own is stop a
 * notification the owner can restore by pressing the button again.
 *
 * Returns the same shape whether or not a row existed. "Already gone" is the
 * outcome the caller wanted.
 */
export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    let body: { endpoint?: unknown };
    try {
      body = (await request.json()) as { endpoint?: unknown };
    } catch {
      throw new ApiError("VALIDATION_ERROR", "body must be JSON");
    }

    const endpoint = typeof body.endpoint === "string" ? body.endpoint.trim() : "";
    if (!endpoint) throw new ApiError("VALIDATION_ERROR", "endpoint is required");

    await getDb().delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint));
    return json({ subscribed: false });
  });
}
