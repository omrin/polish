import { err } from "../errors";
import { sha256hex } from "../lib/crypto";
import { nowSec } from "../lib/ids";

/** Fixed-window counter in D1. Throws 429 when `limit` is exceeded within `windowSec`. */
export async function rateLimit(db: D1Database, key: string, limit: number, windowSec: number): Promise<void> {
  const now = nowSec();
  const start = now - (now % windowSec);
  const r = await db.prepare(
    `INSERT INTO rate_limits (key, window_start, count) VALUES (?, ?, 1)
     ON CONFLICT(key, window_start) DO UPDATE SET count = count + 1 RETURNING count`,
  ).bind(key, start).first<{ count: number }>();
  if ((r?.count ?? 0) > limit) throw err.rateLimited(start + windowSec - now);
}

/** Rate-limit key for an IP that never stores the IP itself (salted daily hash). */
export async function ipKey(salt: string, ip: string | undefined): Promise<string> {
  const day = new Date().toISOString().slice(0, 10);
  return (await sha256hex(`${salt}:${day}:${ip || "unknown"}`)).slice(0, 32);
}
