import { getDb } from "@/db/client";
import { getPreferences, preferencesPatchSchema, updatePreferences } from "@/api/reader";
import { ApiError, handle, json, readOptionalJson } from "@/api/http";

export async function GET(): Promise<Response> {
  return handle(async () => json(await getPreferences(getDb())));
}

export async function PUT(request: Request): Promise<Response> {
  return handle(async () => {
    const parsed = preferencesPatchSchema.safeParse(await readOptionalJson(request));
    if (!parsed.success) {
      // strict() above, so an unknown field is rejected rather than ignored:
      // a silently dropped field is a preference the reader believes they set.
      throw new ApiError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "invalid body");
    }
    return json(await updatePreferences(getDb(), parsed.data));
  });
}
