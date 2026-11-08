import type { Env } from "../env";
import { b64urlDecode } from "./crypto";
import { nowSec } from "./ids";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const ISSUERS = new Set(["accounts.google.com", "https://accounts.google.com"]);

let jwksCache: { at: number; keys: JsonWebKey[] } | null = null;

export function authUrl(env: Env, redirectUri: string, state: string, challenge: string): string {
  const u = new URL(env.GOOGLE_AUTH_URL || AUTH_URL);
  u.search = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID, redirect_uri: redirectUri, response_type: "code", scope: "openid email",
    state, code_challenge: challenge, code_challenge_method: "S256", prompt: "select_account",
  }).toString();
  return u.toString();
}

export async function exchangeCode(env: Env, code: string, verifier: string, redirectUri: string): Promise<string> {
  const r = await globalThis.fetch(env.GOOGLE_TOKEN_URL || TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET,
      code_verifier: verifier, redirect_uri: redirectUri, grant_type: "authorization_code",
    }),
  });
  if (!r.ok) throw new Error(`google token ${r.status}`);
  const j = (await r.json()) as { id_token?: string };
  if (!j.id_token) throw new Error("no id_token");
  return j.id_token;
}

async function jwks(env: Env): Promise<JsonWebKey[]> {
  if (jwksCache && Date.now() - jwksCache.at < 3600_000) return jwksCache.keys;
  const r = await globalThis.fetch(env.GOOGLE_JWKS_URL || JWKS_URL);
  if (!r.ok) throw new Error(`jwks ${r.status}`);
  const keys = ((await r.json()) as { keys: JsonWebKey[] }).keys;
  jwksCache = { at: Date.now(), keys };
  return keys;
}

export const _resetJwksCache = () => { jwksCache = null; };

export interface GoogleIdentity { sub: string; email: string }

export async function verifyIdToken(env: Env, idToken: string): Promise<GoogleIdentity> {
  const [h, p, s] = idToken.split(".");
  if (!h || !p || !s) throw new Error("malformed id_token");
  const header = JSON.parse(new TextDecoder().decode(b64urlDecode(h)));
  if (header.alg !== "RS256") throw new Error("bad alg");
  const jwk = (await jwks(env)).find((k: any) => k.kid === header.kid);
  if (!jwk) throw new Error("unknown kid");
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64urlDecode(s), new TextEncoder().encode(`${h}.${p}`));
  if (!ok) throw new Error("bad signature");
  const c = JSON.parse(new TextDecoder().decode(b64urlDecode(p)));
  if (!ISSUERS.has(c.iss)) throw new Error("bad iss");
  if (c.aud !== env.GOOGLE_CLIENT_ID) throw new Error("bad aud");
  if (typeof c.exp !== "number" || c.exp < nowSec()) throw new Error("expired");
  if (c.email_verified !== true || !c.email) throw new Error("email not verified");
  return { sub: String(c.sub), email: String(c.email) };
}
