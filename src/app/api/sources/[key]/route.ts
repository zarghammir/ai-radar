import { z } from "zod";
import { getDb } from "@/db/client";
import { setSourceEnabled } from "@/api/catalogue";
import { ApiError, handle, json } from "@/api/http";

const bodySchema = z.object({ enabled: z.boolean() });

export async function PUT(
  request: Request,
  ctx: RouteContext<"/api/sources/[key]">,
): Promise<Response> {
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
