import { getDb } from "@/db/client";
import { buildDetail } from "@/api/stories";
import { ApiError, handle, json } from "@/api/http";

export async function GET(
  _request: Request,
  ctx: RouteContext<"/api/stories/[slug]">,
): Promise<Response> {
  return handle(async () => {
    const { slug } = await ctx.params;
    const detail = await buildDetail(getDb(), slug);
    // A hidden story is still reachable here on purpose: hiding removes it
    // from lists, it does not delete it, so a shared link keeps working.
    if (!detail) throw new ApiError("NOT_FOUND", `no story with slug "${slug}"`);
    return json(detail);
  });
}
