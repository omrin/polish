import { Hono } from "hono";
import type { AppEnv } from "../env";
import { nowSec } from "../lib/ids";
import { post } from "../lib/ledger";
import { logEvent } from "../lib/log";
import { verifySignature } from "../lib/paddle";
import { packs } from "../lib/pricing";

export const paddle = new Hono<AppEnv>();

paddle.post("/", async (c) => {
  const raw = await c.req.text(); // verify the raw bytes before parsing
  if (!(await verifySignature(raw, c.req.header("paddle-signature"), c.env.PADDLE_WEBHOOK_SECRET))) {
    return c.json({ error: { code: "bad_signature", message: "Invalid signature." } }, 401);
  }
  const ev = JSON.parse(raw) as { event_id: string; event_type: string; data: any };
  const fresh = await c.env.DB.prepare("INSERT INTO paddle_events (event_id, type, received_at) VALUES (?,?,?) ON CONFLICT DO NOTHING")
    .bind(ev.event_id, ev.event_type, nowSec()).run();
  if (fresh.meta.changes !== 1) return c.json({ ok: true, duplicate: true });

  if (ev.event_type === "transaction.completed") {
    const d = ev.data;
    const userId = d?.custom_data?.user_id;
    const user = userId ? await c.env.DB.prepare("SELECT id FROM users WHERE id = ?").bind(userId).first() : null;
    if (!user) {
      logEvent({ route: "paddle", event: ev.event_type, status: 200, err_code: "unknown_user" });
      return c.json({ ok: true });
    }
    const byPrice = new Map(packs(c.env).filter((p) => p.price_id).map((p) => [p.price_id, p]));
    let credits = 0;
    const priceIds: string[] = [];
    for (const item of d.items || []) {
      const p = byPrice.get(item?.price?.id);
      if (p) { credits += p.credits * Math.max(1, Number(item.quantity) || 1); priceIds.push(p.price_id); }
    }
    if (credits > 0) {
      await post(c.env.DB, "purchase", userId, credits, `paddle:${d.id}`, {
        meta: { txn: d.id, total: d?.details?.totals?.grand_total ?? null, currency: d?.currency_code ?? null, prices: priceIds },
      });
    } else {
      logEvent({ route: "paddle", event: ev.event_type, status: 200, err_code: "unknown_price" });
    }
  } else if (ev.event_type === "adjustment.updated" || ev.event_type === "adjustment.created") {
    const a = ev.data;
    if ((a?.action === "refund" || a?.action === "chargeback") && a?.status === "approved") {
      const purchase = await c.env.DB.prepare("SELECT user_id, delta_credits FROM ledger WHERE ref = ?")
        .bind(`paddle:${a.transaction_id}`).first<{ user_id: string; delta_credits: number }>();
      if (purchase) {
        await post(c.env.DB, "reversal", purchase.user_id, -purchase.delta_credits, `paddle_adj:${a.id}`, { meta: { action: a.action, txn: a.transaction_id } });
        if (a.action === "chargeback") {
          await c.env.DB.prepare("UPDATE users SET disabled_at = ?, disabled_reason = 'chargeback' WHERE id = ?").bind(nowSec(), purchase.user_id).run();
        }
      }
    }
  }
  logEvent({ route: "paddle", event: ev.event_type, status: 200 });
  return c.json({ ok: true });
});
