import { env } from "cloudflare:test";
import { vi } from "vitest";
import { app } from "../src/index";
import { hmacHex } from "../src/lib/crypto";
import { nowSec, ulid } from "../src/lib/ids";
import { signAccess } from "../src/lib/jwt";
import { createSession } from "../src/lib/sessions";
import { upsertUser } from "../src/lib/users";

export { env };
export const fixtures = {
  en: (await import("../../desktop/tests/fixtures/response_en.json")).default,
  rephrase: (await import("../../desktop/tests/fixtures/response_rephrase.json")).default,
};
export const ORIG = "I has a apple and I wnat to eat it.";

export function call(path: string, init: RequestInit & { json?: unknown; token?: string; cookie?: string } = {}) {
  const headers = new Headers(init.headers);
  if (init.json !== undefined) { headers.set("content-type", "application/json"); init.body = JSON.stringify(init.json); }
  if (init.token) headers.set("authorization", `Bearer ${init.token}`);
  if (init.cookie) { headers.set("cookie", `ps=${init.cookie}`); headers.set("x-requested-with", "polish"); }
  return app.request(path, { ...init, headers }, env);
}

let counter = 0;
export async function makeUser(opts: { email?: string; credits?: number } = {}) {
  const email = opts.email ?? `user${++counter}-${ulid().slice(-6).toLowerCase()}@example.com`;
  const { id } = await upsertUser(env.DB, email);
  if (opts.credits !== undefined) {
    const bal = (await env.DB.prepare("SELECT balance_credits b FROM users WHERE id=?").bind(id).first<{ b: number }>())!.b;
    if (opts.credits - bal !== 0) {
      await env.DB.prepare("INSERT INTO ledger (id,user_id,kind,delta_credits,ref,created_at) VALUES (?,?,?,?,?,?)")
        .bind(ulid(), id, "admin_grant", opts.credits - bal, `test:${ulid()}`, nowSec()).run();
    }
  }
  return { id, email };
}

export async function accessToken(userId: string) {
  const s = await createSession(env.DB, userId, "desktop", "Test PC");
  return { access: await signAccess(env.SESSION_SECRET, userId, s.id), refresh: s.token };
}

export async function webCookie(userId: string) {
  return (await createSession(env.DB, userId, "web")).token;
}

export const balanceOf = async (id: string) =>
  (await env.DB.prepare("SELECT balance_credits b FROM users WHERE id=?").bind(id).first<{ b: number }>())!.b;

export const ledgerSum = async (id: string) =>
  (await env.DB.prepare("SELECT COALESCE(SUM(delta_credits),0) s FROM ledger WHERE user_id=?").bind(id).first<{ s: number }>())!.s;

type Handler = (url: URL, init: RequestInit) => Response | Promise<Response>;

/** Stub outbound fetch. Routes by URL substring; anything unmatched fails the test loudly. */
export function stubFetch(routes: Record<string, Handler>) {
  const calls: { url: string; body: any; headers: Headers }[] = [];
  const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input: any, init: any = {}) => {
    const req = input instanceof Request ? input : null;
    const url = new URL(req ? req.url : String(input));
    const rawBody = req ? await req.clone().text() : init.body;
    let body: any = rawBody;
    try { body = typeof rawBody === "string" ? JSON.parse(rawBody) : rawBody; } catch { /* form body */ }
    calls.push({ url: url.toString(), body, headers: new Headers(req ? req.headers : init.headers) });
    for (const [k, h] of Object.entries(routes)) if (url.toString().includes(k)) return h(url, { ...init, body: rawBody });
    throw new Error(`unexpected fetch ${url}`);
  });
  return { calls, restore: () => spy.mockRestore() };
}

export function anthropicReply(text: string, opts: { stop?: string; input?: number; output?: number; model?: string; status?: number } = {}) {
  return () => new Response(JSON.stringify(opts.status && opts.status >= 400
    ? { type: "error", error: { type: "api_error", message: "boom" } }
    : {
      id: "msg_1", type: "message", role: "assistant", model: opts.model ?? "claude-opus-5-5",
      content: [{ type: "text", text }], stop_reason: opts.stop ?? "end_turn",
      usage: { input_tokens: opts.input ?? 600, output_tokens: opts.output ?? 500 },
    }), { status: opts.status ?? 200, headers: { "content-type": "application/json" } });
}

export async function paddleSign(body: string, secret = env.PADDLE_WEBHOOK_SECRET, ts = nowSec()) {
  return `ts=${ts};h1=${await hmacHex(secret, `${ts}:${body}`)}`;
}
