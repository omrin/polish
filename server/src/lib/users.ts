import { isDisposable, normalizeEmail } from "./emailnorm";
import { nowSec, ulid } from "./ids";
import { post } from "./ledger";
import { STARTER_CREDITS } from "./pricing";
import { rateLimit } from "../middleware/ratelimit";

/** Find or create a user by email (and optionally link a Google subject). New, non-disposable users get starter credits once. */
export async function upsertUser(db: D1Database, email: string, opts: { googleSub?: string; ipKey?: string } = {}): Promise<{ id: string; created: boolean }> {
  const norm = normalizeEmail(email);
  let u = opts.googleSub
    ? await db.prepare("SELECT id FROM users WHERE google_sub = ?").bind(opts.googleSub).first<{ id: string }>()
    : null;
  if (!u) u = await db.prepare("SELECT id FROM users WHERE email_norm = ?").bind(norm).first<{ id: string }>();
  if (u) {
    if (opts.googleSub) await db.prepare("UPDATE users SET google_sub = COALESCE(google_sub, ?) WHERE id = ?").bind(opts.googleSub, u.id).run();
    return { id: u.id, created: false };
  }
  if (opts.ipKey) await rateLimit(db, `signup:${opts.ipKey}`, 5, 86400);
  const id = ulid();
  await db.prepare(
    "INSERT INTO users (id, email, email_norm, google_sub, created_at) VALUES (?,?,?,?,?) ON CONFLICT(email_norm) DO NOTHING",
  ).bind(id, email.trim(), norm, opts.googleSub ?? null, nowSec()).run();
  const row = await db.prepare("SELECT id FROM users WHERE email_norm = ?").bind(norm).first<{ id: string }>();
  const userId = row!.id;
  if (userId === id && !isDisposable(norm)) {
    if (await post(db, "starter", userId, STARTER_CREDITS, `starter:${norm}`)) {
      await db.prepare("UPDATE users SET starter_granted_at = ? WHERE id = ?").bind(nowSec(), userId).run();
    }
  }
  return { id: userId, created: userId === id };
}
