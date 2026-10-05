import { getDb } from "@/db/client";
import { preferencesPatchSchema, updatePreferences } from "@/api/reader";
import { ApiError, handle, json, readOptionalJson } from "@/api/http";
import { refuseUnlessInternal } from "@/api/internal-guard";

/**
 * The one way the instance's configuration changes — #203.
 *
 * Moved here from PUT /api/preferences, where it had no guard. `internal/`
 * means operator-only and secret-guarded; that is the rule in
 * src/api/internal-guard.ts, and this row — when the daily brief is cut, in
 * which zone — is operator state by that file's own definition: it changes
 * what the product does for every reader at once.
 *
 * What it does NOT take any more is topicKeys. A reader's topics are theirs,
 * kept on their device and sent with each request; the schema is strict, so a
 * body carrying them is refused rather than quietly dropped.
 *
 * From a shell, as the operator:
 *   curl -X PUT "$APP_URL/api/internal/preferences" \
 *     -H "x-internal-secret: $INTERNAL_API_SECRET" \
 *     -H "content-type: application/json" \
 *     -d '{"briefTime":"09:00","timezone":"America/Vancouver"}'
 */
export async function PUT(request: Request): Promise<Response> {
  const refused = refuseUnlessInternal(request, "PUT /api/internal/preferences");
  if (refused) return refused;

  return handle(async () => {
    const parsed = preferencesPatchSchema.safeParse(await readOptionalJson(request));
    if (!parsed.success) {
      // strict() above, so an unknown field is rejected rather than ignored:
      // a silently dropped field is a preference the operator believes they set.
      throw new ApiError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "invalid body");
    }
    return json(await updatePreferences(getDb(), parsed.data));
  });
}
