import { db } from "@/db/client";
import { hideBodySchema, markHidden, parseStoryId } from "@/api/reader";
import { ApiError, handle, json, readOptionalJson } from "@/api/http";

export async function POST(
  request: Request,
  ctx: RouteContext<"/api/hide/[storyId]">,
): Promise<Response> {
  return handle(async () => {
    const { storyId } = await ctx.params;
    const parsed = hideBodySchema.safeParse(await readOptionalJson(request));
    if (!parsed.success)
      throw new ApiError("VALIDATION_ERROR", "body must be { hidden?: boolean }");
    // Hiding does not mark read, so this leaves readAt alone.
    return json(await markHidden(db, parseStoryId(storyId), parsed.data.hidden ?? true));
  });
}
