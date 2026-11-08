import { ApiError } from "../errors";
import { DEFAULT_FIX_CREDITS } from "./pricing";
import { nowSec, ulid } from "./ids";

export type Kind = "starter" | "purchase" | "hold" | "settle" | "refund" | "reversal" | "admin_grant";

export interface PostExtra {
  request_id?: string; model?: string; input_tokens?: number; output_tokens?: number;
  raw_cost_micro?: number; credits_charged?: number; mode?: string; meta?: unknown;
}

/** Insert a ledger row; the trigger applies it to the balance. Idempotent on `ref`. Returns true if inserted. */
export async function post(db: D1Database, kind: Kind, userId: string, delta: number, ref: string, x: PostExtra = {}): Promise<boolean> {
  const r = await db.prepare(
    `INSERT INTO ledger (id, user_id, kind, delta_credits, ref, request_id, model, input_tokens, output_tokens,
       raw_cost_micro, credits_charged, mode, meta_json, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(ref) DO NOTHING RETURNING id`,
  ).bind(ulid(), userId, kind, delta, ref, x.request_id ?? null, x.model ?? null, x.input_tokens ?? null,
    x.output_tokens ?? null, x.raw_cost_micro ?? null, x.credits_charged ?? null, x.mode ?? null,
    x.meta === undefined ? null : JSON.stringify(x.meta), nowSec()).first();
  // Note: meta.changes also counts the balance trigger's UPDATE, so RETURNING is the reliable signal.
  return r !== null;
}

/**
 * Reserve up to `estimate` credits in one atomic statement. Succeeds only when the balance is at least
 * `minRequired` and the account is active. Returns the amount held.
 */
export async function hold(db: D1Database, userId: string, rid: string, estimate: number, minRequired: number, buyUrl: string): Promise<number> {
  const r = await db.prepare(
    `INSERT INTO ledger (id, user_id, kind, delta_credits, ref, request_id, created_at)
     SELECT ?, id, 'hold', -MIN(?, balance_credits), ?, ?, ? FROM users
     WHERE id = ? AND disabled_at IS NULL AND balance_credits >= ?
     ON CONFLICT(ref) DO NOTHING RETURNING delta_credits`,
  ).bind(ulid(), estimate, `hold:${rid}`, rid, nowSec(), userId, minRequired).first<{ delta_credits: number }>();
  if (!r) {
    const u = await db.prepare("SELECT balance_credits, disabled_at FROM users WHERE id = ?").bind(userId).first<{ balance_credits: number; disabled_at: number | null }>();
    if (!u) throw new ApiError(401, "unauthorized", "Sign in to continue.");
    if (u.disabled_at) throw new ApiError(403, "account_disabled", "This account is disabled. Contact support.");
    throw new ApiError(402, "insufficient_credits", "You're out of credits.", { balance: u.balance_credits, needed: minRequired, buy_url: buyUrl });
  }
  return -r.delta_credits;
}

export async function settle(db: D1Database, userId: string, rid: string, held: number, charged: number, x: PostExtra) {
  return post(db, "settle", userId, held - charged, `settle:${rid}`, { ...x, request_id: rid, credits_charged: charged });
}

export async function refund(db: D1Database, userId: string, rid: string, held: number) {
  return post(db, "refund", userId, held, `refund:${rid}`, { request_id: rid });
}

export async function balance(db: D1Database, userId: string): Promise<number> {
  const r = await db.prepare("SELECT balance_credits FROM users WHERE id = ?").bind(userId).first<{ balance_credits: number }>();
  return r?.balance_credits ?? 0;
}

/** "≈ N checks left", based on the user's recent normal fixes (falls back to a typical cost). */
export async function approxChecks(db: D1Database, userId: string, bal?: number): Promise<number> {
  const b = bal ?? (await balance(db, userId));
  const r = await db.prepare(
    `SELECT COUNT(*) AS n, AVG(credits_charged) AS avg FROM (
       SELECT credits_charged FROM ledger WHERE user_id = ? AND kind = 'settle' AND mode = 'fix' AND credits_charged > 0
       ORDER BY created_at DESC LIMIT 20)`,
  ).bind(userId).first<{ n: number; avg: number | null }>();
  const avg = r && r.n >= 5 && r.avg ? r.avg : DEFAULT_FIX_CREDITS;
  return Math.max(0, Math.floor(b / avg));
}

/** Refund holds older than `olderThan` seconds that never settled (e.g. the Worker was killed mid-request). */
export async function releaseStaleHolds(db: D1Database, olderThan = 300): Promise<number> {
  const { results } = await db.prepare(
    `SELECT h.user_id, h.request_id, -h.delta_credits AS held FROM ledger h
     WHERE h.kind = 'hold' AND h.created_at < ?
       AND NOT EXISTS (SELECT 1 FROM ledger s WHERE s.request_id = h.request_id AND s.kind IN ('settle','refund'))`,
  ).bind(nowSec() - olderThan).all<{ user_id: string; request_id: string; held: number }>();
  let n = 0;
  for (const h of results) if (await refund(db, h.user_id, h.request_id, h.held)) n++;
  return n;
}
