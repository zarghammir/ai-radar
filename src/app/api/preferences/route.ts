import { getDb } from "@/db/client";
import { getPreferences } from "@/api/reader";
import { handle, json } from "@/api/http";

/**
 * READ-ONLY since #203. The write moved to /api/internal/preferences, behind
 * the secret, because this row is the instance's configuration — when the one
 * daily brief is cut — and for as long as it sat here anyone on the internet
 * could change it for everyone. The owner's ruling, 2026-10-05: "only I can
 * change them."
 *
 * The read stays public: Settings shows the reader the time their brief is
 * cut, and must be able to say so without a secret.
 */
export async function GET(): Promise<Response> {
  return handle(async () => json(await getPreferences(getDb())));
}
