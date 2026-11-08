import type { Context, Next } from "hono";
import { getCookie } from "hono/cookie";
import type { AppEnv } from "../env";
import { list } from "../env";
import { err } from "../errors";
import { verifyAccess } from "../lib/jwt";
import { useSession, WEB_COOKIE } from "../lib/sessions";

/** Desktop app / extension: `Authorization: Bearer <access JWT>`. */
export async function bearerUser(c: Context<AppEnv>, next: Next) {
  const h = c.req.header("authorization") || "";
  const tok = h.startsWith("Bearer ") ? h.slice(7) : "";
  const claims = tok ? await verifyAccess(c.env.SESSION_SECRET, tok) : null;
  if (!claims) throw err.unauthorized();
  c.set("userId", claims.sub);
  c.set("sessionId", claims.sid);
  await next();
}

/** Website: HttpOnly session cookie. State-changing requests must carry X-Requested-With (CSRF guard). */
export async function cookieUser(c: Context<AppEnv>, next: Next) {
  const tok = getCookie(c, WEB_COOKIE);
  const s = tok ? await useSession(c.env.DB, tok) : null;
  if (!s || s.kind !== "web") throw err.unauthorized();
  if (c.req.method !== "GET" && c.req.header("x-requested-with") !== "polish") throw err.forbidden("Missing request header.");
  c.set("userId", s.user_id);
  c.set("sessionId", s.id);
  await next();
}

/** Either a Bearer token or the web cookie. */
export async function anyUser(c: Context<AppEnv>, next: Next) {
  if ((c.req.header("authorization") || "").startsWith("Bearer ")) return bearerUser(c, next);
  return cookieUser(c, next);
}

export async function requireAdmin(c: Context<AppEnv>, next: Next) {
  const u = await c.env.DB.prepare("SELECT email_norm FROM users WHERE id = ?").bind(c.get("userId")).first<{ email_norm: string }>();
  if (!u || !list(c.env.ADMIN_EMAILS).map((s) => s.toLowerCase()).includes(u.email_norm)) throw err.forbidden();
  await next();
}
