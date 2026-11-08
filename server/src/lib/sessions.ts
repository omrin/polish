import type { Env } from "../env";
import { randomToken, sha256hex } from "./crypto";
import { nowSec, ulid } from "./ids";
import { signAccess } from "./jwt";
import { approxChecks, balance } from "./ledger";

export type ClientKind = "web" | "desktop" | "extension";
export const SESSION_TTL = 180 * 24 * 3600; // sliding
export const WEB_COOKIE = "ps";
export const WEB_COOKIE_MAX_AGE = 30 * 24 * 3600;

export async function createSession(db: D1Database, userId: string, kind: ClientKind, deviceName?: string) {
  const token = randomToken(32);
  const id = ulid();
  const now = nowSec();
  await db.prepare(
    `INSERT INTO sessions (id, user_id, token_hash, kind, device_name, created_at, last_used_at, expires_at)
     VALUES (?,?,?,?,?,?,?,?)`,
  ).bind(id, userId, await sha256hex(token), kind, (deviceName || "").slice(0, 80) || null, now, now, now + SESSION_TTL).run();
  return { id, token };
}

export interface SessionRow { id: string; user_id: string; kind: ClientKind; expires_at: number; revoked_at: number | null }

/** Look up an unexpired, unrevoked session by its raw token and slide its expiry. */
export async function useSession(db: D1Database, token: string): Promise<SessionRow | null> {
  if (!token || token.length > 200) return null;
  const s = await db.prepare(
    `SELECT s.id, s.user_id, s.kind, s.expires_at, s.revoked_at FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ? AND u.disabled_at IS NULL`,
  ).bind(await sha256hex(token), nowSec()).first<SessionRow>();
  if (!s) return null;
  const now = nowSec();
  await db.prepare("UPDATE sessions SET last_used_at = ?, expires_at = ? WHERE id = ?").bind(now, now + SESSION_TTL, s.id).run();
  await db.prepare("UPDATE users SET last_seen_at = ? WHERE id = ?").bind(now, s.user_id).run();
  return s;
}

export async function revokeByToken(db: D1Database, token: string) {
  await db.prepare("UPDATE sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL").bind(nowSec(), await sha256hex(token)).run();
}

export async function userSummary(db: D1Database, userId: string) {
  const u = await db.prepare("SELECT id, email, created_at FROM users WHERE id = ?").bind(userId).first<{ id: string; email: string; created_at: number }>();
  const bal = await balance(db, userId);
  return { user: u, balance_credits: bal, approx_checks_left: await approxChecks(db, userId, bal) };
}

/** Token bundle returned to the desktop app and extension. */
export async function issueClientTokens(env: Env, userId: string, kind: "desktop" | "extension", deviceName?: string) {
  const s = await createSession(env.DB, userId, kind, deviceName);
  const access = await signAccess(env.SESSION_SECRET, userId, s.id);
  return { refresh_token: s.token, access_token: access, expires_in: 3600, ...(await userSummary(env.DB, userId)) };
}

export function cookieHeader(env: Env, token: string, maxAge = WEB_COOKIE_MAX_AGE): string {
  const secure = env.DEV_INSECURE_COOKIES === "1" ? "" : "; Secure";
  return `${WEB_COOKIE}=${token}; HttpOnly${secure}; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}
