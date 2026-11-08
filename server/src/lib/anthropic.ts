import Anthropic from "@anthropic-ai/sdk";
import type { Env } from "../env";
import { buildSystemPrompt, buildUserMessage, PROMPT, type Mode } from "./prompt";

export const FALLBACK_BETA = "server-side-fallback-2026-07-01";

/** Same request shape as the desktop app's claude_client.build_request (kept in sync by tests). */
export function buildRequest(text: string, mode: Mode, model: string, labels: string[], explanationLanguage: string) {
  const req: Record<string, unknown> = {
    model,
    max_tokens: 16000,
    system: buildSystemPrompt(mode, labels, explanationLanguage),
    messages: [{ role: "user", content: buildUserMessage(text) }],
    output_config: { effort: "low", format: { type: "json_schema", schema: PROMPT.schema } },
  };
  if ((PROMPT.fallback_models as string[]).includes(model)) {
    req.betas = [FALLBACK_BETA];
    req.fallbacks = "default";
  }
  return req;
}

export function client(env: Env) {
  return new Anthropic({
    apiKey: env.ANTHROPIC_API_KEY,
    baseURL: env.ANTHROPIC_BASE_URL || undefined,
    timeout: PROMPT.limits.timeout_seconds * 1000,
    maxRetries: 1,
    // Route through globalThis.fetch so tests can stub the upstream.
    fetch: (...a: Parameters<typeof fetch>) => globalThis.fetch(...a),
  });
}

export interface ClaudeReply {
  model: string;
  stop_reason: string | null;
  usage: { input_tokens: number; output_tokens: number };
  text: string | null;
}

export async function callClaude(env: Env, req: Record<string, unknown>): Promise<ClaudeReply> {
  const c = client(env);
  const resp: any = req.betas ? await c.beta.messages.create(req as any) : await c.messages.create(req as any);
  const block = (resp.content || []).find((b: any) => b.type === "text");
  return {
    model: resp.model || (req.model as string),
    stop_reason: resp.stop_reason ?? null,
    usage: { input_tokens: resp.usage?.input_tokens ?? 0, output_tokens: resp.usage?.output_tokens ?? 0 },
    text: block ? block.text : null,
  };
}
