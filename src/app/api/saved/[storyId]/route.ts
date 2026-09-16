import { db } from "@/db/client";
import { parseStoryId, saveBodySchema, saveStory, unsaveStory } from "@/api/reader";
import { ApiError, handle, json, readOptionalJson } from "@/api/http";

export async function POST(
  request: Request,
  ctx: RouteContext<"/api/saved/[storyId]">,
): Promise<Response> {
  return handle(async () => {
    const { storyId } = await ctx.params;
    const parsed = saveBodySchema.safeParse(await readOptionalJson(request));
    if (!parsed.success) {
      throw new ApiError("VALIDATION_ERROR", "body must be { note?: string, tags?: string[] }");
    }
    return json(await saveStory(db, parseStoryId(storyId), parsed.data));
  });
}

export async function DELETE(
  _request: Request,
  ctx: RouteContext<"/api/saved/[storyId]">,
): Promise<Response> {
  return handle(async () => {
    const { storyId } = await ctx.params;
    return json(await unsaveStory(db, parseStoryId(storyId)));
  });
}
