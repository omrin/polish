import { Hono } from "hono";
import { deleteCookie, getCookie } from "hono/cookie";
import { z } from "zod";
import type { AppEnv } from "../env";
import { err } from "../errors";
import { nowSec } from "../lib/ids";
import { signAccess } from "../lib/jwt";
import { revokeByToken, useSession, userSummary, WEB_COOKIE } from "../lib/sessions";
import { cookieUser } from "../middleware/auth";

export const authSession = new Hono<AppEnv>();

authSession.post("/refresh", async (c) => {
  const body = z.object({ refresh_token: z.string().max(200) }).safeParse(await c.req.json().catch(() => null));
  if (!body.success) throw err.badRequest();
  const s = await useSession(c.env.DB, body.data.refresh_token);
  if (!s || s.kind === "web") throw err.unauthorized("Your sign-in has expired. Sign in again.");
  const access = await signAccess(c.env.SESSION_SECRET, s.user_id, s.id);
  return c.json({ access_token: access, expires_in: 3600, ...(await userSummary(c.env.DB, s.user_id)) });
});

authSession.post("/logout", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { refresh_token?: string };
  if (body.refresh_token) await revokeByToken(c.env.DB, body.refresh_token);
  const cookie = getCookie(c, WEB_COOKIE);
  if (cookie) {
    await revokeByToken(c.env.DB, cookie);
    deleteCookie(c, WEB_COOKIE, { path: "/" });
  }
  return c.json({ ok: true });
});

authSession.get("/sessions", cookieUser, async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT id, kind, device_name, created_at, last_used_at FROM sessions
     WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ? ORDER BY last_used_at DESC`,
  ).bind(c.get("userId"), nowSec()).all();
  return c.json({ sessions: results.map((s: any) => ({ ...s, current: s.id === c.get("sessionId") })) });
});

authSession.delete("/sessions/:id", cookieUser, async (c) => {
  await c.env.DB.prepare("UPDATE sessions SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL")
    .bind(nowSec(), c.req.param("id"), c.get("userId")).run();
  return c.json({ ok: true });
});
