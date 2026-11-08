import { Hono } from "hono";
import type { AppEnv } from "../env";
import { origin } from "../env";
import { pkceChallenge, randomToken } from "../lib/crypto";
import { authUrl, exchangeCode, verifyIdToken } from "../lib/google_oidc";
import { nowSec } from "../lib/ids";
import { logEvent } from "../lib/log";
import { cookieHeader, createSession } from "../lib/sessions";
import { upsertUser } from "../lib/users";
import { ipKey } from "../middleware/ratelimit";

/** Only same-origin relative paths are allowed as a post-login destination. */
export function safeReturnTo(v: string | undefined | null): string {
  if (!v || !v.startsWith("/") || v.startsWith("//") || v.includes("\\")) return "/account";
  return v.slice(0, 500);
}

export const authGoogle = new Hono<AppEnv>();

authGoogle.get("/start", async (c) => {
  if (!c.env.GOOGLE_CLIENT_ID) return c.redirect("/signin?error=google_disabled");
  const state = randomToken(24);
  const verifier = randomToken(48);
  await c.env.DB.prepare("INSERT INTO oauth_states (state, code_verifier, return_to, expires_at) VALUES (?,?,?,?)")
    .bind(state, verifier, safeReturnTo(c.req.query("return_to")), nowSec() + 600).run();
  return c.redirect(authUrl(c.env, `${origin(c.env)}/auth/google/callback`, state, await pkceChallenge(verifier)));
});

authGoogle.get("/callback", async (c) => {
  const state = c.req.query("state") || "";
  const code = c.req.query("code") || "";
  const row = await c.env.DB.prepare("DELETE FROM oauth_states WHERE state = ? RETURNING code_verifier, return_to, expires_at")
    .bind(state).first<{ code_verifier: string; return_to: string; expires_at: number }>();
  if (!row || row.expires_at < nowSec() || !code) return c.redirect("/signin?error=google_failed");
  try {
    const idToken = await exchangeCode(c.env, code, row.code_verifier, `${origin(c.env)}/auth/google/callback`);
    const who = await verifyIdToken(c.env, idToken);
    const ip = await ipKey(c.env.RATE_SALT, c.req.header("cf-connecting-ip"));
    const user = await upsertUser(c.env.DB, who.email, { googleSub: who.sub, ipKey: ip });
    const s = await createSession(c.env.DB, user.id, "web");
    c.header("Set-Cookie", cookieHeader(c.env, s.token));
    return c.redirect(safeReturnTo(row.return_to));
  } catch (e) {
    logEvent({ route: "auth_google_callback", status: 302, err_code: String((e as Error).message).slice(0, 60) });
    return c.redirect("/signin?error=google_failed");
  }
});
