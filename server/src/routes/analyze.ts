import Anthropic from "@anthropic-ai/sdk";
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../env";
import { origin } from "../env";
import { ApiError, err } from "../errors";
import { buildRequest, callClaude } from "../lib/anthropic";
import { nowSec, ulid } from "../lib/ids";
import { approxChecks, balance, hold, refund, settle } from "../lib/ledger";
import { logEvent } from "../lib/log";
import { creditsFor, estimate, MIN_BALANCE_FAST, MIN_BALANCE_FULL, rawCostMicro } from "../lib/pricing";
import { PROMPT } from "../lib/prompt";
import { bearerUser } from "../middleware/auth";
import { rateLimit } from "../middleware/ratelimit";

const Body = z.object({
  text: z.string().min(1).max(100_000),
  mode: z.enum(["fix", "rephrase"]),
  fast: z.boolean().optional().default(false),
  labels: z.array(z.string().min(1).max(30)).max(5).optional(),
  explanation_language: z.enum(["auto", "en", "he"]).optional().default("auto"),
}).strict();

export const analyze = new Hono<AppEnv>();

analyze.post("/", bearerUser, async (c) => {
  const started = Date.now();
  const userId = c.get("userId")!;
  const parsed = Body.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) throw err.badRequest();
  const { text, mode, fast, explanation_language } = parsed.data;
  const labels = parsed.data.labels?.length ? parsed.data.labels : (PROMPT.default_labels as string[]);
  if (!text.trim()) throw err.badRequest("There's no text to check.");
  if (text.length > PROMPT.limits.max_chars) {
    throw new ApiError(413, "text_too_long", `Text is ${text.length.toLocaleString("en-US")} characters; the limit is ${PROMPT.limits.max_chars.toLocaleString("en-US")}.`);
  }

  await rateLimit(c.env.DB, `analyze_min:${userId}`, 10, 60);
  await rateLimit(c.env.DB, `analyze_day:${userId}`, 500, 86400);

  const today = new Date().toISOString().slice(0, 10);
  const cap = Number(c.env.MAX_DAILY_RAW_COST_USD || "0") * 1_000_000;
  if (cap > 0) {
    const d = await c.env.DB.prepare("SELECT raw_cost_micro FROM daily_usage WHERE day = ?").bind(today).first<{ raw_cost_micro: number }>();
    if ((d?.raw_cost_micro ?? 0) >= cap) throw new ApiError(503, "service_paused", "Polish is paused for maintenance. Try again later.");
  }

  const model = fast ? c.env.FAST_MODEL : c.env.DEFAULT_MODEL;
  const rid = ulid();
  c.set("rid", rid);
  const buyUrl = `${origin(c.env)}/account#buy`;
  const held = await hold(c.env.DB, userId, rid, estimate(text.length, mode, model), fast ? MIN_BALANCE_FAST : MIN_BALANCE_FULL, buyUrl);

  const log = (status: number, extra: Record<string, string | number | null> = {}) =>
    logEvent({ rid, uid: userId, route: "analyze", status, mode, fast, ms: Date.now() - started, ...extra });

  let reply;
  try {
    reply = await callClaude(c.env, buildRequest(text, mode, model, labels, explanation_language));
  } catch (e) {
    await refund(c.env.DB, userId, rid, held);
    const status = e instanceof Anthropic.APIError ? (e as any).status : undefined;
    log(502, { err_code: status ? `upstream_${status}` : "upstream_network" });
    if (status === 429) throw new ApiError(429, "rate_limited", "Polish is busy right now. Try again in a few seconds.", { retry_after: 5 });
    throw new ApiError(502, "upstream_error", "The AI service didn't respond. Try again.");
  }

  // Anthropic bills every completed call, including refusals and truncated replies.
  const charged = creditsFor(reply.usage, reply.model);
  const raw = rawCostMicro(reply.usage, reply.model);
  await settle(c.env.DB, userId, rid, held, charged, {
    model: reply.model, input_tokens: reply.usage.input_tokens, output_tokens: reply.usage.output_tokens,
    raw_cost_micro: raw, mode: fast ? `${mode}_fast` : mode,
  });
  await c.env.DB.prepare(
    `INSERT INTO daily_usage (day, requests, raw_cost_micro) VALUES (?, 1, ?)
     ON CONFLICT(day) DO UPDATE SET requests = requests + 1, raw_cost_micro = raw_cost_micro + excluded.raw_cost_micro`,
  ).bind(today, raw).run();
  log(200, { model: reply.model, in: reply.usage.input_tokens, out: reply.usage.output_tokens, credits: charged, stop: reply.stop_reason });

  if (reply.stop_reason === "refusal") throw new ApiError(422, "refusal", "Claude declined to process this text.");
  if (reply.stop_reason === "max_tokens") throw new ApiError(422, "too_long", "The response was cut off. Select a shorter piece of text.");
  let result: unknown;
  try {
    result = JSON.parse(reply.text ?? "");
  } catch {
    throw new ApiError(502, "bad_response", "Unexpected response. Try again.");
  }
  const bal = await balance(c.env.DB, userId);
  return c.json({
    result,
    model: reply.model,
    usage: {
      input_tokens: reply.usage.input_tokens, output_tokens: reply.usage.output_tokens,
      credits_charged: charged, balance_credits: bal, approx_checks_left: await approxChecks(c.env.DB, userId, bal),
    },
  });
});
