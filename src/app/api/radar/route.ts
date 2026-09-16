import { db } from "@/db/client";
import { parseCursor, parseFilters, parseLimit, parseSort } from "@/api/params";
import { radarPage, unknownKeys } from "@/api/radar";
import { ApiError, handle, json } from "@/api/http";

export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const now = new Date();
    const params = new URL(request.url).searchParams;
    const filters = parseFilters(params, now, "7d");
    const sort = parseSort(params);
    const limit = parseLimit(params);
    const cursor = parseCursor(params);

    for (const kind of ["topic", "source"] as const) {
      const missing = await unknownKeys(db, kind, filters[kind]);
      if (missing.length) {
        throw new ApiError("VALIDATION_ERROR", `unknown ${kind}: ${missing.join(", ")}`);
      }
    }

    const page = await radarPage(db, filters, sort, limit, cursor, now);
    return json({
      ...page,
      appliedFilters: {
        type: filters.type,
        topic: filters.topic,
        source: filters.source,
        verification: filters.verification,
        since: filters.sinceRaw,
        sort,
      },
    });
  });
}
