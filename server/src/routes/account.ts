import { Hono } from "hono";
import { deleteCookie } from "hono/cookie";
import type { AppEnv } from "../env";
import { nowSec } from "../lib/ids";
import { packs } from "../lib/pricing";
import { userSummary, WEB_COOKIE } from "../lib/sessions";
import { anyUser, cookieUser } from "../middleware/auth";

export const account = new Hono<AppEnv>();

account.get("/me", anyUser, async (c) => {
  return c.json({
    ...(await userSummary(c.env.DB, c.get("userId")!)),
    fast_mode_credits: 1,
    packs: packs(c.env).map(({ id, usd, credits, label, price_id }) => ({ id, usd, credits, label, price_id })),
  });
});

account.get("/ledger", anyUser, async (c) => {
  const userId = c.get("userId")!;
  const { results: purchases } = await c.env.DB.prepare(
    `SELECT kind, delta_credits, created_at, meta_json FROM ledger
     WHERE user_id = ? AND kind IN ('purchase','reversal','admin_grant','starter') ORDER BY created_at DESC LIMIT 50`,
  ).bind(userId).all<any>();
  const { results: usage } = await c.env.DB.prepare(
    `SELECT date(created_at, 'unixepoch') AS day, COUNT(*) AS checks, SUM(credits_charged) AS credits FROM ledger
     WHERE user_id = ? AND kind = 'settle' AND created_at > ? GROUP BY day ORDER BY day DESC`,
  ).bind(userId, nowSec() - 30 * 86400).all();
  return c.json({
    purchases: purchases.map((p) => {
      const m = p.meta_json ? JSON.parse(p.meta_json) : {};
      return { kind: p.kind, credits: p.delta_credits, created_at: p.created_at, total: m.total ?? null, currency: m.currency ?? null };
    }),
    usage,
  });
});

account.get("/packs", (c) => c.json({ packs: packs(c.env) }));

account.get("/config", (c) => c.json({
  paddle_env: c.env.PADDLE_ENV === "production" ? "production" : "sandbox",
  paddle_client_token: c.env.PADDLE_CLIENT_TOKEN || null,
  google_enabled: !!c.env.GOOGLE_CLIENT_ID,
}));

account.post("/account/delete", cookieUser, async (c) => {
  const userId = c.get("userId")!;
  const now = nowSec();
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL").bind(now, userId),
    c.env.DB.prepare(
      "UPDATE users SET email = ?, email_norm = ?, google_sub = NULL, disabled_at = ?, disabled_reason = 'deleted' WHERE id = ?",
    ).bind(`deleted+${userId}@invalid`, `deleted+${userId}@invalid`, now, userId),
  ]);
  deleteCookie(c, WEB_COOKIE, { path: "/" });
  return c.json({ ok: true });
});
