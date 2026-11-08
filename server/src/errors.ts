import type { Context } from "hono";

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public extra: Record<string, unknown> = {}) {
    super(message);
  }
}

export const err = {
  badRequest: (m = "The request is not valid.") => new ApiError(400, "bad_request", m),
  unauthorized: (m = "Sign in to continue.") => new ApiError(401, "unauthorized", m),
  forbidden: (m = "Not allowed.") => new ApiError(403, "forbidden", m),
  notFound: (m = "Not found.") => new ApiError(404, "not_found", m),
  rateLimited: (retryAfter: number) =>
    new ApiError(429, "rate_limited", "Too many requests. Try again in a moment.", { retry_after: retryAfter }),
};

export function onError(e: Error, c: Context) {
  if (e instanceof ApiError) {
    const headers: Record<string, string> = {};
    if (typeof e.extra.retry_after === "number") headers["Retry-After"] = String(e.extra.retry_after);
    return c.json({ error: { code: e.code, message: e.message, ...e.extra } }, e.status as any, headers);
  }
  console.log(JSON.stringify({ level: "error", rid: c.get("rid"), route: c.req.path, error: String(e?.message || e).slice(0, 300) }));
  return c.json({ error: { code: "internal", message: "Something went wrong on our side." } }, 500);
}
