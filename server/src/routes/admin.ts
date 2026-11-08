import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../env";
import { err } from "../errors";
import { normalizeEmail } from "../lib/emailnorm";
import { nowSec, ulid } from "../lib/ids";
import { post } from "../lib/ledger";
import { cookieUser, requireAdmin } from "../middleware/auth";

export const admin = new Hono<AppEnv>();
admin.use("*", cookieUser, requireAdmin);

admin.get("/users", async (c) => {
  const q = c.req.query("email");
  if (!q) throw err.badRequest("Pass ?email=");
  const u = await c.env.DB.prepare("SELECT id, email, balance_credits, created_at, last_seen_at, disabled_at, disabled_reason FROM users WHERE email_norm = ?")
    .bind(normalizeEmail(q)).first();
  return c.json({ user: u ?? null });
});

admin.post("/users/:id/grant", async (c) => {
  const b = z.object({ credits: z.number().int().min(-100000).max(100000), note: z.string().max(200).optional() }).safeParse(await c.req.json().catch(() => null));
  if (!b.success) throw err.badRequest();
  await post(c.env.DB, "admin_grant", c.req.param("id"), b.data.credits, `admin:${ulid()}`, { meta: { note: b.data.note ?? null, by: c.get("userId") } });
  return c.json({ ok: true });
});

admin.post("/users/:id/disable", async (c) => {
  await c.env.DB.prepare("UPDATE users SET disabled_at = ?, disabled_reason = 'admin' WHERE id = ?").bind(nowSec(), c.req.param("id")).run();
  return c.json({ ok: true });
});

admin.post("/users/:id/enable", async (c) => {
  await c.env.DB.prepare("UPDATE users SET disabled_at = NULL, disabled_reason = NULL WHERE id = ?").bind(c.req.param("id")).run();
  return c.json({ ok: true });
});

admin.get("/stats", async (c) => {
  const { results } = await c.env.DB.prepare("SELECT * FROM daily_usage ORDER BY day DESC LIMIT 30").all();
  const users = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM users").first<{ n: number }>();
  return c.json({ users: users?.n ?? 0, days: results });
});
