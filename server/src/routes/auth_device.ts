import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../env";
import { origin } from "../env";
import { ApiError, err } from "../errors";
import { randomInt, randomToken, sha256hex } from "../lib/crypto";
import { nowSec } from "../lib/ids";
import { issueClientTokens } from "../lib/sessions";
import { cookieUser } from "../middleware/auth";
import { ipKey, rateLimit } from "../middleware/ratelimit";

const ALPHABET = "BCDFGHJKLMNPQRSTVWXZ23456789";
const TTL = 600;
const INTERVAL = 3;

function userCode(): string {
  let s = "";
  for (let i = 0; i < 8; i++) s += ALPHABET[randomInt(ALPHABET.length)];
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}
const normCode = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/^(.{4})(.{4})$/, "$1-$2");

export const authDevice = new Hono<AppEnv>();

authDevice.post("/start", async (c) => {
  const body = z.object({ client: z.literal("desktop").default("desktop"), device_name: z.string().max(80).optional() })
    .safeParse(await c.req.json().catch(() => ({})));
  if (!body.success) throw err.badRequest();
  await rateLimit(c.env.DB, `device:${await ipKey(c.env.RATE_SALT, c.req.header("cf-connecting-ip"))}`, 5, 600);
  const deviceCode = randomToken(32);
  const code = userCode();
  const now = nowSec();
  await c.env.DB.prepare(
    "INSERT INTO device_codes (device_code_hash, user_code, client, device_name, expires_at, created_at) VALUES (?,?,?,?,?,?)",
  ).bind(await sha256hex(deviceCode), code, "desktop", body.data.device_name ?? null, now + TTL, now).run();
  return c.json({
    device_code: deviceCode, user_code: code, interval: INTERVAL, expires_in: TTL,
    verification_url: `${origin(c.env)}/connect?code=${code}`,
  });
});

authDevice.get("/info", cookieUser, async (c) => {
  const code = normCode(c.req.query("user_code") || "");
  const d = await c.env.DB.prepare(
    "SELECT client, device_name, approved_at, denied_at, consumed_at, expires_at FROM device_codes WHERE user_code = ?",
  ).bind(code).first<any>();
  if (!d || d.expires_at < nowSec()) throw err.notFound("This code has expired. Start sign-in again from the app.");
  const status = d.consumed_at || d.approved_at ? "approved" : d.denied_at ? "denied" : "pending";
  return c.json({ user_code: code, client: d.client, device_name: d.device_name, status });
});

authDevice.post("/approve", cookieUser, async (c) => {
  const body = z.object({ user_code: z.string().max(20), deny: z.boolean().optional() }).safeParse(await c.req.json().catch(() => null));
  if (!body.success) throw err.badRequest();
  const code = normCode(body.data.user_code);
  const now = nowSec();
  const sql = body.data.deny
    ? "UPDATE device_codes SET denied_at = ? WHERE user_code = ? AND expires_at > ? AND approved_at IS NULL AND denied_at IS NULL"
    : "UPDATE device_codes SET user_id = ?2, approved_at = ?1 WHERE user_code = ?3 AND expires_at > ?1 AND approved_at IS NULL AND denied_at IS NULL";
  const r = body.data.deny
    ? await c.env.DB.prepare(sql).bind(now, code, now).run()
    : await c.env.DB.prepare(sql).bind(now, c.get("userId"), code).run();
  if (r.meta.changes !== 1) throw err.notFound("This code has expired or was already used.");
  return c.json({ ok: true });
});

authDevice.post("/token", async (c) => {
  const body = z.object({ device_code: z.string().max(100) }).safeParse(await c.req.json().catch(() => null));
  if (!body.success) throw err.badRequest();
  const hash = await sha256hex(body.data.device_code);
  const now = nowSec();
  const d = await c.env.DB.prepare("SELECT * FROM device_codes WHERE device_code_hash = ?").bind(hash).first<any>();
  if (!d || d.consumed_at) throw new ApiError(410, "expired", "This sign-in request has expired. Try again.");
  if (d.expires_at < now) throw new ApiError(410, "expired", "This sign-in request has expired. Try again.");
  if (d.denied_at) throw new ApiError(403, "denied", "Sign-in was declined in the browser.");
  if (d.last_poll_at && now - d.last_poll_at < INTERVAL - 1) {
    throw new ApiError(429, "slow_down", "Polling too fast.", { retry_after: INTERVAL });
  }
  await c.env.DB.prepare("UPDATE device_codes SET last_poll_at = ? WHERE device_code_hash = ?").bind(now, hash).run();
  if (!d.approved_at) throw new ApiError(428, "authorization_pending", "Waiting for approval in the browser.");
  const used = await c.env.DB.prepare("UPDATE device_codes SET consumed_at = ? WHERE device_code_hash = ? AND consumed_at IS NULL").bind(now, hash).run();
  if (used.meta.changes !== 1) throw new ApiError(410, "expired", "This sign-in request was already used.");
  return c.json(await issueClientTokens(c.env, d.user_id, "desktop", d.device_name ?? undefined));
});
