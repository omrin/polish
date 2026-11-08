import { afterEach, describe, expect, it } from "vitest";
import { scheduled } from "../src/index";
import { STARTER_CREDITS } from "../src/lib/pricing";
import { accessToken, anthropicReply, balanceOf, call, env, fixtures, ledgerSum, makeUser, ORIG, stubFetch } from "./helpers";

let stub: ReturnType<typeof stubFetch> | null = null;
afterEach(() => { stub?.restore(); stub = null; });
const analyze = (token: string, json: unknown) => call("/v1/analyze", { method: "POST", token, json });

describe("POST /v1/analyze", () => {
  it("returns the model's result and charges actual usage", async () => {
    const u = await makeUser();
    const { access } = await accessToken(u.id);
    stub = stubFetch({ "/v1/messages": anthropicReply(JSON.stringify(fixtures.en)) });
    const r = await analyze(access, { text: ORIG, mode: "fix" });
    expect(r.status).toBe(200);
    const j: any = await r.json();
    expect(j.result).toEqual(fixtures.en);
    expect(j.usage).toMatchObject({ credits_charged: 4, balance_credits: STARTER_CREDITS - 4, approx_checks_left: 17 });
    expect(await ledgerSum(u.id)).toBe(await balanceOf(u.id));

    const sent = stub.calls[0];
    expect(sent.headers.get("authorization")).toBe("Bearer test-anthropic-key");
    expect(sent.headers.get("anthropic-beta")).toContain("server-side-fallback-2026-07-01");
    expect(sent.body).toMatchObject({ model: "claude-opus-5-5", max_tokens: 16000, fallbacks: "default",
      output_config: { effort: "low", format: { type: "json_schema" } } });
    expect(sent.body.messages[0].content).toBe(`<text>\n${ORIG}\n</text>`);
    expect(sent.body.system).toContain("rephrasings: Return an empty array.");
    expect(sent.body).not.toHaveProperty("temperature");
  });

  it("rephrase sends the labels; fast mode uses Haiku without fallbacks and costs 1 credit", async () => {
    const u = await makeUser();
    const { access } = await accessToken(u.id);
    stub = stubFetch({ "/v1/messages": anthropicReply(JSON.stringify(fixtures.rephrase), { model: "claude-haiku-5-5" }) });
    const r: any = await (await analyze(access, { text: ORIG, mode: "rephrase", fast: true, labels: ["Formal", "Short"] })).json();
    expect(r.usage.credits_charged).toBe(1);
    expect(stub.calls[0].body.model).toBe("claude-haiku-5-5");
    expect(stub.calls[0].body).not.toHaveProperty("fallbacks");
    expect(stub.calls[0].body.system).toContain("exactly 2 alternatives");
  });

  it("ignores unknown fields like a client-chosen model", async () => {
    const { access } = await accessToken((await makeUser()).id);
    expect((await analyze(access, { text: ORIG, mode: "fix", model: "claude-fable-5-1" })).status).toBe(400);
  });

  it("413 over the length limit, without calling the API or charging", async () => {
    const u = await makeUser();
    const { access } = await accessToken(u.id);
    stub = stubFetch({});
    expect((await analyze(access, { text: "x".repeat(8001), mode: "fix" })).status).toBe(413);
    expect(stub.calls.length).toBe(0);
    expect(await balanceOf(u.id)).toBe(STARTER_CREDITS);
  });

  it("402 with a buy link when out of credits", async () => {
    const u = await makeUser({ credits: 2 });
    const { access } = await accessToken(u.id);
    stub = stubFetch({});
    const r = await analyze(access, { text: ORIG, mode: "fix" });
    expect(r.status).toBe(402);
    expect(((await r.json()) as any).error).toMatchObject({ code: "insufficient_credits", buy_url: "https://polish.test/account#buy" });
    // ...but fast mode still works with 1+ credit
    stub.restore();
    stub = stubFetch({ "/v1/messages": anthropicReply(JSON.stringify(fixtures.en), { model: "claude-haiku-5-5" }) });
    expect((await analyze(access, { text: ORIG, mode: "fix", fast: true })).status).toBe(200);
  });

  it("refunds in full when the API fails", async () => {
    const u = await makeUser();
    const { access } = await accessToken(u.id);
    stub = stubFetch({ "/v1/messages": anthropicReply("", { status: 500 }) });
    const r = await analyze(access, { text: ORIG, mode: "fix" });
    expect(r.status).toBe(502);
    expect(await balanceOf(u.id)).toBe(STARTER_CREDITS);
    expect(await ledgerSum(u.id)).toBe(STARTER_CREDITS);
  });

  it("maps upstream 429 to a retryable 429", async () => {
    const { access } = await accessToken((await makeUser()).id);
    stub = stubFetch({ "/v1/messages": anthropicReply("", { status: 429 }) });
    const r = await analyze(access, { text: ORIG, mode: "fix" });
    expect(r.status).toBe(429);
    expect(r.headers.get("retry-after")).toBe("5");
  });

  it("charges for refusals (Anthropic bills them) and returns 422", async () => {
    const u = await makeUser();
    const { access } = await accessToken(u.id);
    stub = stubFetch({ "/v1/messages": anthropicReply("", { stop: "refusal", input: 600, output: 50 }) });
    const r = await analyze(access, { text: ORIG, mode: "fix" });
    expect(r.status).toBe(422);
    expect(((await r.json()) as any).error.code).toBe("refusal");
    expect(await balanceOf(u.id)).toBe(STARTER_CREDITS - 1);
  });

  it("pauses the service at the daily cost cap", async () => {
    const { access } = await accessToken((await makeUser()).id);
    const today = new Date().toISOString().slice(0, 10);
    await env.DB.prepare("INSERT INTO daily_usage (day, requests, raw_cost_micro) VALUES (?, 1, ?) ON CONFLICT(day) DO UPDATE SET raw_cost_micro = excluded.raw_cost_micro")
      .bind(today, 51_000_000).run();
    stub = stubFetch({});
    expect((await analyze(access, { text: ORIG, mode: "fix" })).status).toBe(503);
    await env.DB.prepare("DELETE FROM daily_usage").run();
  });

  it("rate-limits to 10 checks a minute", async () => {
    const u = await makeUser({ credits: 1000 });
    const { access } = await accessToken(u.id);
    stub = stubFetch({ "/v1/messages": anthropicReply(JSON.stringify(fixtures.en)) });
    const codes = [];
    for (let i = 0; i < 11; i++) codes.push((await analyze(access, { text: ORIG, mode: "fix" })).status);
    expect(codes.slice(0, 10).every((c) => c === 200)).toBe(true);
    expect(codes[10]).toBe(429);
  });

  it("requires a valid access token", async () => {
    expect((await call("/v1/analyze", { method: "POST", json: { text: "x", mode: "fix" } })).status).toBe(401);
  });

  it("cron cleans up stale holds", async () => {
    const u = await makeUser();
    await env.DB.prepare("INSERT INTO ledger (id,user_id,kind,delta_credits,ref,request_id,created_at) VALUES ('h1',?, 'hold', -10, 'hold:zz', 'zz', 1)").bind(u.id).run();
    expect(await balanceOf(u.id)).toBe(STARTER_CREDITS - 10);
    await scheduled(env);
    expect(await balanceOf(u.id)).toBe(STARTER_CREDITS);
  });
});
