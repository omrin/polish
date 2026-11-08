import { describe, expect, it } from "vitest";
import { nowSec } from "../src/lib/ids";
import { STARTER_CREDITS } from "../src/lib/pricing";
import { accessToken, balanceOf, call, env, makeUser, paddleSign, webCookie } from "./helpers";

let n = 0;
function txn(userId: string, items = [{ price: { id: "pri_plus" }, quantity: 1 }]) {
  n++;
  return { event_id: `evt_${n}_${nowSec()}`, event_type: "transaction.completed",
    data: { id: `txn_${n}_${nowSec()}`, custom_data: { user_id: userId }, items, currency_code: "USD", details: { totals: { grand_total: "1000" } } } };
}
async function send(body: unknown, sig?: string) {
  const raw = JSON.stringify(body);
  return call("/webhooks/paddle", { method: "POST", body: raw, headers: { "paddle-signature": sig ?? (await paddleSign(raw)), "content-type": "application/json" } });
}

describe("Paddle webhook", () => {
  it("grants credits once per transaction", async () => {
    const u = await makeUser();
    const ev = txn(u.id);
    expect((await send(ev)).status).toBe(200);
    expect(await balanceOf(u.id)).toBe(STARTER_CREDITS + 1100);
    expect((await send(ev)).status).toBe(200); // replay of the same event
    expect(await send({ ...ev, event_id: ev.event_id + "_retry" })).toBeTruthy(); // new event id, same transaction
    expect(await balanceOf(u.id)).toBe(STARTER_CREDITS + 1100);
  });

  it("rejects bad signatures, tampering and stale timestamps", async () => {
    const u = await makeUser();
    const ev = txn(u.id);
    expect((await send(ev, "ts=1;h1=deadbeef")).status).toBe(401);
    const raw = JSON.stringify(ev);
    const sig = await paddleSign(raw);
    const tampered = raw.replace("pri_plus", "pri_pro");
    expect((await call("/webhooks/paddle", { method: "POST", body: tampered, headers: { "paddle-signature": sig } })).status).toBe(401);
    expect((await send(ev, await paddleSign(raw, undefined, nowSec() - 1000))).status).toBe(401);
    expect(await balanceOf(u.id)).toBe(STARTER_CREDITS);
  });

  it("only credits known price ids (never trusts the client)", async () => {
    const u = await makeUser();
    await send(txn(u.id, [{ price: { id: "pri_unknown" }, quantity: 99 }]));
    expect(await balanceOf(u.id)).toBe(STARTER_CREDITS);
    await send(txn(u.id, [{ price: { id: "pri_small" }, quantity: 2 }, { price: { id: "pri_pro" }, quantity: 1 }]));
    expect(await balanceOf(u.id)).toBe(STARTER_CREDITS + 1000 + 3000);
  });

  it("reverses credits on refund and blocks use until topped up", async () => {
    const u = await makeUser();
    const ev = txn(u.id);
    await send(ev);
    // spend most of it
    await env.DB.prepare("INSERT INTO ledger (id,user_id,kind,delta_credits,ref,created_at) VALUES ('spend1',?,'settle',-1000,'test:spend1',?)").bind(u.id, nowSec()).run();
    await send({ event_id: `adj_evt_${ev.data.id}`, event_type: "adjustment.updated",
      data: { id: `adj_${ev.data.id}`, action: "refund", status: "approved", transaction_id: ev.data.id } });
    expect(await balanceOf(u.id)).toBe(STARTER_CREDITS + 1100 - 1000 - 1100);
    const { access } = await accessToken(u.id);
    const r = await call("/v1/analyze", { method: "POST", token: access, json: { text: "hello", mode: "fix", fast: true } });
    expect(r.status).toBe(402);
  });
});

describe("account API", () => {
  it("/me shows balance, packs and purchase history", async () => {
    const u = await makeUser();
    await send(txn(u.id));
    const cookie = await webCookie(u.id);
    const me: any = await (await call("/v1/me", { cookie })).json();
    expect(me.balance_credits).toBe(STARTER_CREDITS + 1100);
    expect(me.packs.map((p: any) => p.price_id)).toEqual(["pri_small", "pri_plus", "pri_pro"]);
    const led: any = await (await call("/v1/ledger", { cookie })).json();
    expect(led.purchases[0]).toMatchObject({ kind: "purchase", credits: 1100, currency: "USD" });
  });

  it("/config is public and exposes no secrets", async () => {
    const j: any = await (await call("/v1/config")).json();
    expect(j).toEqual({ paddle_env: "sandbox", paddle_client_token: null, google_enabled: true });
  });

  it("deleting the account revokes sessions and anonymizes the email", async () => {
    const u = await makeUser();
    const { refresh } = await accessToken(u.id);
    const cookie = await webCookie(u.id);
    expect((await call("/v1/account/delete", { method: "POST", cookie })).status).toBe(200);
    expect((await call("/v1/auth/refresh", { method: "POST", json: { refresh_token: refresh } })).status).toBe(401);
    const row: any = await env.DB.prepare("SELECT email FROM users WHERE id = ?").bind(u.id).first();
    expect(row.email).toBe(`deleted+${u.id}@invalid`);
  });

  it("admin routes are limited to admin emails", async () => {
    const u = await makeUser();
    expect((await call("/admin/stats", { cookie: await webCookie(u.id) })).status).toBe(403);
    const a = await makeUser({ email: "admin@polish.test" });
    const ac = await webCookie(a.id);
    expect((await call("/admin/stats", { cookie: ac })).status).toBe(200);
    await call(`/admin/users/${u.id}/grant`, { method: "POST", cookie: ac, json: { credits: 25, note: "support" } });
    expect(await balanceOf(u.id)).toBe(STARTER_CREDITS + 25);
  });
});

describe("CORS and limits", () => {
  it("allows the website and allow-listed extensions, refuses other origins", async () => {
    const pre = (origin: string) => call("/v1/analyze", { method: "OPTIONS", headers: { origin, "access-control-request-method": "POST" } });
    expect((await pre("https://polish.test")).status).toBe(204);
    expect((await pre("chrome-extension://abcdefghijklmnopabcdefghijklmnop")).headers.get("access-control-allow-origin")).toBe("chrome-extension://abcdefghijklmnopabcdefghijklmnop");
    expect((await pre("https://evil.example")).status).toBe(403);
    expect((await call("/v1/me", { headers: { origin: "https://evil.example" } })).status).toBe(403);
  });

  it("rejects oversized bodies", async () => {
    const { access } = await accessToken((await makeUser()).id);
    const r = await call("/v1/analyze", { method: "POST", token: access, json: { text: "x".repeat(70_000), mode: "fix" } });
    expect(r.status).toBe(413);
  });

  it("unknown API paths are JSON 404s", async () => {
    expect((await call("/v1/nope")).status).toBe(404);
  });
});
