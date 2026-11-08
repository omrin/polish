import { describe, expect, it } from "vitest";
import { approxChecks, hold, refund, releaseStaleHolds, settle } from "../src/lib/ledger";
import { creditsFor, estimate, STARTER_CREDITS } from "../src/lib/pricing";
import { balanceOf, env, ledgerSum, makeUser } from "./helpers";

describe("pricing", () => {
  it("matches the planned price points", () => {
    expect(creditsFor({ input_tokens: 600, output_tokens: 500 }, "claude-opus-5-5")).toBe(4);
    expect(creditsFor({ input_tokens: 600, output_tokens: 1500 }, "claude-opus-5-5")).toBe(9);
    expect(creditsFor({ input_tokens: 4500, output_tokens: 9500 }, "claude-opus-5-5")).toBe(52);
    expect(creditsFor({ input_tokens: 600, output_tokens: 500 }, "claude-haiku-5-5")).toBe(1);
  });
  it("prices unknown models as the most expensive", () => {
    expect(creditsFor({ input_tokens: 600, output_tokens: 500 }, "claude-new-thing"))
      .toBe(creditsFor({ input_tokens: 600, output_tokens: 500 }, "claude-fable-5-1"));
  });
  it("estimates grow with text length and mode", () => {
    expect(estimate(2000, "fix", "claude-opus-5-5")).toBeGreaterThan(estimate(100, "fix", "claude-opus-5-5"));
    expect(estimate(2000, "rephrase", "claude-opus-5-5")).toBeGreaterThan(estimate(2000, "fix", "claude-opus-5-5"));
  });
});

describe("ledger", () => {
  it("grants starter credits once per normalized email", async () => {
    const a = await makeUser({ email: "Jane.Doe+polish@gmail.com" });
    expect(await balanceOf(a.id)).toBe(STARTER_CREDITS);
    const b = await makeUser({ email: "janedoe@googlemail.com" });
    expect(b.id).toBe(a.id);
    expect(await balanceOf(a.id)).toBe(STARTER_CREDITS);
  });

  it("gives no starter credits to disposable domains", async () => {
    const u = await makeUser({ email: "x@mailinator.com" });
    expect(await balanceOf(u.id)).toBe(0);
  });

  it("hold + settle + refund keep the ledger and balance in sync, idempotently", async () => {
    const u = await makeUser({ credits: 50 });
    const held = await hold(env.DB, u.id, "r1", 20, 5, "x");
    expect(held).toBe(20);
    expect(await balanceOf(u.id)).toBe(30);
    expect(await settle(env.DB, u.id, "r1", held, 4, {})).toBe(true);
    expect(await settle(env.DB, u.id, "r1", held, 4, {})).toBe(false); // duplicate ignored
    expect(await balanceOf(u.id)).toBe(46);
    const h2 = await hold(env.DB, u.id, "r2", 10, 5, "x");
    await refund(env.DB, u.id, "r2", h2);
    await refund(env.DB, u.id, "r2", h2);
    expect(await balanceOf(u.id)).toBe(46);
    expect(await ledgerSum(u.id)).toBe(46);
  });

  it("holds at most the balance and refuses below the minimum", async () => {
    const u = await makeUser({ credits: 7 });
    expect(await hold(env.DB, u.id, "a", 50, 5, "x")).toBe(7);
    await expect(hold(env.DB, u.id, "b", 4, 5, "https://buy")).rejects.toMatchObject({ status: 402, code: "insufficient_credits" });
  });

  it("never oversells under concurrency", async () => {
    const u = await makeUser({ credits: 100 });
    const results = await Promise.allSettled(Array.from({ length: 25 }, (_, i) => hold(env.DB, u.id, `c${i}`, 10, 10, "x")));
    expect(results.filter((r) => r.status === "fulfilled").length).toBe(10);
    expect(await balanceOf(u.id)).toBe(0);
    expect(await ledgerSum(u.id)).toBe(0);
  });

  it("refuses disabled accounts", async () => {
    const u = await makeUser({ credits: 50 });
    await env.DB.prepare("UPDATE users SET disabled_at = 1 WHERE id = ?").bind(u.id).run();
    await expect(hold(env.DB, u.id, "d", 5, 5, "x")).rejects.toMatchObject({ status: 403, code: "account_disabled" });
  });

  it("cron releases stale holds", async () => {
    const u = await makeUser({ credits: 50 });
    await hold(env.DB, u.id, "stale", 20, 5, "x");
    await env.DB.prepare("UPDATE ledger SET created_at = created_at - 600 WHERE ref = 'hold:stale'").run();
    expect(await releaseStaleHolds(env.DB, 300)).toBeGreaterThanOrEqual(1);
    expect(await balanceOf(u.id)).toBe(50);
  });

  it("estimates checks left from recent usage", async () => {
    const u = await makeUser({ credits: 100 });
    expect(await approxChecks(env.DB, u.id)).toBe(25); // default 4 credits per fix
    for (let i = 0; i < 5; i++) {
      const h = await hold(env.DB, u.id, `ap${i}`, 10, 1, "x");
      await settle(env.DB, u.id, `ap${i}`, h, 2, { mode: "fix" });
    }
    expect(await approxChecks(env.DB, u.id)).toBe(45); // 90 left / 2 per fix
  });
});
