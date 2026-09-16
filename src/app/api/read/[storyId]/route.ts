import { db } from "@/db/client";
import { markRead, parseStoryId, readBodySchema } from "@/api/reader";
import { ApiError, handle, json, readOptionalJson } from "@/api/http";

export async function POST(
  request: Request,
  ctx: RouteContext<"/api/read/[storyId]">,
): Promise<Response> {
  return handle(async () => {
    const { storyId } = await ctx.params;
    const parsed = readBodySchema.safeParse(await readOptionalJson(request));
    if (!parsed.success) throw new ApiError("VALIDATION_ERROR", "body must be { read?: boolean }");
    // Reading does not hide, so this leaves hidden alone.
    return json(await markRead(db, parseStoryId(storyId), parsed.data.read ?? true, new Date()));
  });
}
