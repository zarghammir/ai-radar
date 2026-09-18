import { z } from "zod";
import { getDb } from "@/db/client";
import { setSourceEnabled } from "@/api/catalogue";
import { ApiError, handle, json } from "@/api/http";
import { refuseUnlessInternal } from "@/api/internal-guard";

const bodySchema = z.object({ enabled: z.boolean() });

/**
 * Switch a source on or off. OPERATOR-ONLY: it changes what the product
 * collects, so it lives under internal/ and carries the same secret guard as
 * the ingest trigger. See src/api/internal-guard.ts for the rule.
 *
 * MOVED HERE FROM /api/sources/[key] (#103), where it had no guard of any
 * kind. Anyone who could reach the port could disable every source by key, and
 * the keys are in src/db/seed-data.ts in a public repository. It failed
 * silently too: the worker keeps running and keeps exiting 0, because a pass
 * over zero enabled sources is not a failure.
 *
 * Nothing in this repository called the old path, measured 2026-09-17 at
 * 6aca5c5 — `/api/sources`, `listSources` and `SourceSummary` were grepped
 * across src, and settings/page.tsx and lib/api/client.ts were read directly.
 * Dated because an absence is a claim about a tree at a moment, not a property. So this is a
 * move rather than a removal of capability and no UI changed. That search
 * cannot see a caller OUTSIDE this repository hitting the deployed URL; if one
 * exists it now needs the x-internal-secret header.
 */
export async function PUT(
  request: Request,
  ctx: RouteContext<"/api/internal/sources/[key]">,
): Promise<Response> {
  // Before anything is parsed or read, so an unauthorised caller costs nothing
  // and leaves no trace.
  const refusal = refuseUnlessInternal(request, "/api/internal/sources/[key]");
  if (refusal) return refusal;

  return handle(async () => {
    // Next 16: params is a promise and has to be awaited.
    const { key } = await ctx.params;

    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      throw new ApiError("VALIDATION_ERROR", "body must be JSON");
    }
    const parsed = bodySchema.safeParse(raw);
    if (!parsed.success) {
      throw new ApiError("VALIDATION_ERROR", "body must be { enabled: boolean }");
    }

    const updated = await setSourceEnabled(getDb(), key, parsed.data.enabled, new Date());
    if (!updated) throw new ApiError("NOT_FOUND", `no source with key "${key}"`);
    return json(updated);
  });
}
