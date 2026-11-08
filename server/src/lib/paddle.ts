import { hmacHex, timingSafeEqual } from "./crypto";
import { nowSec } from "./ids";

/** Verify a Paddle Billing `Paddle-Signature: ts=..;h1=..` header against the raw request body. */
export async function verifySignature(rawBody: string, header: string | undefined, secret: string, maxSkew = 300): Promise<boolean> {
  if (!header || !secret) return false;
  const parts = Object.fromEntries(header.split(";").map((kv) => kv.split("=", 2) as [string, string]));
  const ts = Number(parts.ts);
  const h1 = parts.h1;
  if (!ts || !h1 || Math.abs(nowSec() - ts) > maxSkew) return false;
  return timingSafeEqual(await hmacHex(secret, `${ts}:${rawBody}`), h1);
}
