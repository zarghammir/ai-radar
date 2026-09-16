import { db } from "@/db/client";
import { listSaved } from "@/api/reader";
import { parseLimit } from "@/api/params";
import { ApiError, handle, json } from "@/api/http";

export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const params = new URL(request.url).searchParams;
    const raw = params.get("archived");
    if (raw !== null && raw !== "true" && raw !== "false") {
      throw new ApiError("VALIDATION_ERROR", "archived must be true or false");
    }
    return json(await listSaved(db, raw === "true", parseLimit(params)));
  });
}
