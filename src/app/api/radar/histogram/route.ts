import { getDb } from "@/db/client";
import { parseFilters } from "@/api/params";
import { radarHistogram, unknownKeys } from "@/api/radar";
import { ApiError, handle, json } from "@/api/http";

export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const now = new Date();
    const params = new URL(request.url).searchParams;
    // Defaults to 24h here rather than the list's 7d: 24 buckets is the chart.
    const filters = parseFilters(params, now, "24h");

    for (const kind of ["topic", "source"] as const) {
      const missing = await unknownKeys(getDb(), kind, filters[kind]);
      if (missing.length) {
        throw new ApiError("VALIDATION_ERROR", `unknown ${kind}: ${missing.join(", ")}`);
      }
    }

    return json(await radarHistogram(getDb(), filters, now));
  });
}
