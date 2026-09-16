/**
 * The one response shape every route uses.
 *
 * Errors carry a machine-readable `code` and a human `message`. Clients branch
 * on the code; the message is for a person reading a log or a toast, and is
 * free to change.
 */
export const ERROR_STATUS = {
  VALIDATION_ERROR: 400,
  NOT_FOUND: 404,
  METHOD_NOT_ALLOWED: 405,
  INTERNAL: 500,
} as const;

export type ErrorCode = keyof typeof ERROR_STATUS;

export class ApiError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface ErrorBody {
  error: { code: ErrorCode; message: string };
}

export function errorBody(code: ErrorCode, message: string): ErrorBody {
  return { error: { code, message } };
}

/** Read models change whenever the worker runs, so nothing here is cacheable. */
const NO_STORE = { "cache-control": "no-store", "content-type": "application/json; charset=utf-8" };

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: NO_STORE });
}

export function errorResponse(code: ErrorCode, message: string): Response {
  return json(errorBody(code, message), ERROR_STATUS[code]);
}

/**
 * Wraps a handler so every failure leaves by the same door.
 *
 * An unexpected error returns a generic message on purpose: a database error
 * text can carry column names, a connection string fragment or a row's
 * contents, and none of that belongs in an HTTP body. The real reason is
 * logged for the operator instead.
 */
export async function handle(run: () => Promise<Response>): Promise<Response> {
  try {
    return await run();
  } catch (e) {
    if (e instanceof ApiError) return errorResponse(e.code, e.message);
    console.error("[api] unhandled error:", e);
    return errorResponse("INTERNAL", "Something went wrong handling this request.");
  }
}

/**
 * An optional JSON body.
 *
 * Several routes take a body only to override a default, so an empty one is
 * normal rather than an error. Malformed JSON still is.
 */
export async function readOptionalJson(request: Request): Promise<unknown> {
  const raw = await request.text();
  if (raw.trim() === "") return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new ApiError("VALIDATION_ERROR", "body must be JSON");
  }
}
