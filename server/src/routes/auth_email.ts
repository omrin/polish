import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../env";
import { ApiError, err } from "../errors";
import { hmacHex, randomInt, timingSafeEqual } from "../lib/crypto";
import { isEmail, normalizeEmail } from "../lib/emailnorm";
import { nowSec, ulid } from "../lib/ids";
import { sendCode } from "../lib/resend";
import { cookieHeader, createSession, issueClientTokens, userSummary } from "../lib/sessions";
import { upsertUser } from "../lib/users";
import { ipKey, rateLimit } from "../middleware/ratelimit";

const CODE_TTL = 600;
const MAX_ATTEMPTS = 5;

const Start = z.object({ email: z.string().max(254) });
const Verify = z.object({
  email: z.string().max(254),
  code: z.string().regex(/^\d{6}$/),
  client: z.enum(["web", "desktop", "extension"]).default("web"),
  device_name: z.string().max(80).optional(),
});

export const authEmail = new Hono<AppEnv>();

authEmail.post("/start", async (c) => {
  const body = Start.safeParse(await c.req.json().catch(() => null));
  if (!body.success || !isEmail(body.data.email)) throw err.badRequest("Enter a valid email address.");
  const email = body.data.email.trim();
  const norm = normalizeEmail(email);
  const ip = await ipKey(c.env.RATE_SALT, c.req.header("cf-connecting-ip"));
  await rateLimit(c.env.DB, `email_ip:${ip}`, 10, 3600);
  await rateLimit(c.env.DB, `email_addr:${norm}`, 3, 3600);
  await rateLimit(c.env.DB, `email_burst:${norm}`, 1, 60);

  const code = String(randomInt(1_000_000)).padStart(6, "0");
  const now = nowSec();
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE login_codes SET consumed_at = ? WHERE email_norm = ? AND consumed_at IS NULL").bind(now, norm),
    c.env.DB.prepare("INSERT INTO login_codes (id, email_norm, email, code_hash, expires_at, created_at) VALUES (?,?,?,?,?,?)")
      .bind(ulid(), norm, email, await hmacHex(c.env.CODE_PEPPER, `${norm}:${code}`), now + CODE_TTL, now),
  ]);
  await sendCode(c.env, email, code);
  return c.json({ ok: true });
});

authEmail.post("/verify", async (c) => {
  const body = Verify.safeParse(await c.req.json().catch(() => null));
  if (!body.success || !isEmail(body.data.email)) throw err.badRequest("Enter the 6-digit code from the email.");
  const { email, code, client, device_name } = body.data;
  const norm = normalizeEmail(email);
  const now = nowSec();
  const row = await c.env.DB.prepare(
    "SELECT id, code_hash, attempts, expires_at, email FROM login_codes WHERE email_norm = ? AND consumed_at IS NULL ORDER BY created_at DESC LIMIT 1",
  ).bind(norm).first<{ id: string; code_hash: string; attempts: number; expires_at: number; email: string }>();
  const invalid = new ApiError(401, "invalid_code", "That code isn't right. Check the email or ask for a new code.");
  if (!row || row.expires_at < now) throw new ApiError(401, "invalid_code", "That code has expired. Ask for a new one.");
  if (row.attempts >= MAX_ATTEMPTS) {
    await c.env.DB.prepare("UPDATE login_codes SET consumed_at = ? WHERE id = ?").bind(now, row.id).run();
    throw new ApiError(401, "invalid_code", "Too many wrong tries. Ask for a new code.");
  }
  const ok = timingSafeEqual(await hmacHex(c.env.CODE_PEPPER, `${norm}:${code}`), row.code_hash);
  if (!ok) {
    await c.env.DB.prepare("UPDATE login_codes SET attempts = attempts + 1 WHERE id = ?").bind(row.id).run();
    throw invalid;
  }
  const consumed = await c.env.DB.prepare("UPDATE login_codes SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL").bind(now, row.id).run();
  if (consumed.meta.changes !== 1) throw invalid;

  const ip = await ipKey(c.env.RATE_SALT, c.req.header("cf-connecting-ip"));
  const user = await upsertUser(c.env.DB, row.email, { ipKey: ip });
  if (client === "web") {
    const s = await createSession(c.env.DB, user.id, "web");
    c.header("Set-Cookie", cookieHeader(c.env, s.token));
    return c.json(await userSummary(c.env.DB, user.id));
  }
  return c.json(await issueClientTokens(c.env, user.id, client, device_name));
});
