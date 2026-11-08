import { b64url, b64urlDecode, hmacRaw, timingSafeEqual } from "./crypto";
import { nowSec } from "./ids";

const enc = new TextEncoder();
const HEADER = b64url(enc.encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));

export interface AccessClaims { sub: string; sid: string; exp: number; iat: number }

export async function signAccess(secret: string, sub: string, sid: string, ttl = 3600): Promise<string> {
  const iat = nowSec();
  const payload = b64url(enc.encode(JSON.stringify({ sub, sid, iat, exp: iat + ttl })));
  const sig = b64url(await hmacRaw(secret, `${HEADER}.${payload}`));
  return `${HEADER}.${payload}.${sig}`;
}

export async function verifyAccess(secret: string, token: string): Promise<AccessClaims | null> {
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== HEADER) return null; // pins alg=HS256; rejects alg=none
  const expected = b64url(await hmacRaw(secret, `${parts[0]}.${parts[1]}`));
  if (!timingSafeEqual(expected, parts[2])) return null;
  try {
    const claims = JSON.parse(new TextDecoder().decode(b64urlDecode(parts[1]))) as AccessClaims;
    if (typeof claims.exp !== "number" || claims.exp <= nowSec()) return null;
    if (!claims.sub || !claims.sid) return null;
    return claims;
  } catch {
    return null;
  }
}
