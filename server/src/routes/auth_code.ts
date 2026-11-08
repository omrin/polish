import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../env";
import { list } from "../env";
import { ApiError, err } from "../errors";
import { pkceChallenge, randomToken, sha256hex, timingSafeEqual } from "../lib/crypto";
import { nowSec } from "../lib/ids";
import { issueClientTokens } from "../lib/sessions";
import { cookieUser } from "../middleware/auth";

const REDIRECT = /^https:\/\/([a-p]{32})\.chromiumapp\.org\/cb$/;
const TTL = 300;

export function allowedRedirect(env: { EXTENSION_IDS: string }, uri: string): boolean {
  const m = REDIRECT.exec(uri);
  return !!m && list(env.EXTENSION_IDS).includes(m[1]);
}

export const authCode = new Hono<AppEnv>();

// The website's /connect page calls this after the signed-in user clicks Approve.
authCode.post("/approve", cookieUser, async (c) => {
  const body = z.object({
    redirect_uri: z.string().max(200),
    code_challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    state: z.string().max(200),
    device_name: z.string().max(80).optional(),
  }).safeParse(await c.req.json().catch(() => null));
  if (!body.success) throw err.badRequest();
  if (!allowedRedirect(c.env, body.data.redirect_uri)) throw err.forbidden("This extension isn't allowed to sign in.");
  const code = randomToken(32);
  await c.env.DB.prepare(
    "INSERT INTO auth_codes (code_hash, user_id, redirect_uri, code_challenge, device_name, expires_at) VALUES (?,?,?,?,?,?)",
  ).bind(await sha256hex(code), c.get("userId"), body.data.redirect_uri, body.data.code_challenge,
    body.data.device_name ?? "Chrome", nowSec() + TTL).run();
  const u = new URL(body.data.redirect_uri);
  u.searchParams.set("code", code);
  u.searchParams.set("state", body.data.state);
  return c.json({ redirect: u.toString() });
});

// The extension exchanges the code (plus its PKCE verifier) for tokens.
authCode.post("/exchange", async (c) => {
  const body = z.object({
    code: z.string().max(100),
    code_verifier: z.string().min(43).max(128),
    redirect_uri: z.string().max(200),
  }).safeParse(await c.req.json().catch(() => null));
  if (!body.success) throw err.badRequest();
  const hash = await sha256hex(body.data.code);
  const row = await c.env.DB.prepare("SELECT * FROM auth_codes WHERE code_hash = ?").bind(hash).first<any>();
  const bad = new ApiError(400, "invalid_grant", "Sign-in failed. Try again.");
  if (!row || row.consumed_at || row.expires_at < nowSec() || row.redirect_uri !== body.data.redirect_uri) throw bad;
  if (!timingSafeEqual(await pkceChallenge(body.data.code_verifier), row.code_challenge)) throw bad;
  const used = await c.env.DB.prepare("UPDATE auth_codes SET consumed_at = ? WHERE code_hash = ? AND consumed_at IS NULL").bind(nowSec(), hash).run();
  if (used.meta.changes !== 1) throw bad;
  return c.json(await issueClientTokens(c.env, row.user_id, "extension", row.device_name ?? "Chrome"));
});
