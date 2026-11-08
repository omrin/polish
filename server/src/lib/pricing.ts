import type { Env } from "../env";

/** Anthropic list prices in micro-USD per token. Unknown models are priced as the most expensive. */
export const PRICES: Record<string, { in: number; out: number }> = {
  "claude-fable-5-1": { in: 10, out: 50 },
  "claude-mythos-5-1": { in: 10, out: 50 },
  "claude-opus-5-5": { in: 4, out: 20 },
  "claude-opus-5": { in: 5, out: 25 },
  "claude-opus-4-8": { in: 5, out: 25 },
  "claude-sonnet-5-5": { in: 2, out: 10 },
  "claude-sonnet-5": { in: 2, out: 10 },
  "claude-haiku-5-5": { in: 0.1, out: 0.5 },
};
const WORST = PRICES["claude-fable-5-1"];

export const MARKUP = 2.5;
export const CREDIT_MICRO = 10_000; // 1 credit = $0.01
export const STARTER_CREDITS = 75;
export const DEFAULT_FIX_CREDITS = 4;
export const MIN_BALANCE_FULL = 5;
export const MIN_BALANCE_FAST = 1;

export const priceFor = (model: string) => PRICES[model] ?? WORST;

export function rawCostMicro(usage: { input_tokens: number; output_tokens: number }, model: string): number {
  const p = priceFor(model);
  return Math.ceil(usage.input_tokens * p.in + usage.output_tokens * p.out);
}

export function creditsFor(usage: { input_tokens: number; output_tokens: number }, model: string): number {
  return Math.max(1, Math.ceil((rawCostMicro(usage, model) * MARKUP) / CREDIT_MICRO));
}

/** Upper-ish estimate used for the pre-call hold. Output includes up to ~1k thinking tokens at effort low. */
export function estimate(chars: number, mode: "fix" | "rephrase", model: string): number {
  const textTokens = Math.ceil(chars / 2);
  const estIn = textTokens + 600;
  const estOut = (mode === "rephrase" ? 4 : 1) * textTokens + 800 + 1000;
  return creditsFor({ input_tokens: estIn, output_tokens: estOut }, model);
}

export interface Pack { id: string; usd: number; credits: number; price_id: string; label: string }

export function packs(env: Env): Pack[] {
  return [
    { id: "small", usd: 5, credits: 500, price_id: env.PADDLE_PRICE_SMALL, label: "500 credits" },
    { id: "plus", usd: 10, credits: 1100, price_id: env.PADDLE_PRICE_PLUS, label: "1,100 credits (+10%)" },
    { id: "pro", usd: 25, credits: 3000, price_id: env.PADDLE_PRICE_PRO, label: "3,000 credits (+20%)" },
  ];
}
