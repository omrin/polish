export interface Env {
  DB: D1Database;
  ASSETS?: Fetcher;
  // vars
  DOMAIN: string;
  DEFAULT_MODEL: string;
  FAST_MODEL: string;
  GOOGLE_CLIENT_ID: string;
  PADDLE_ENV: string;
  PADDLE_CLIENT_TOKEN: string;
  PADDLE_PRICE_SMALL: string;
  PADDLE_PRICE_PLUS: string;
  PADDLE_PRICE_PRO: string;
  EXTENSION_IDS: string;
  ADMIN_EMAILS: string;
  RESEND_FROM: string;
  MAX_DAILY_RAW_COST_USD: string;
  // secrets
  ANTHROPIC_API_KEY: string;
  SESSION_SECRET: string;
  CODE_PEPPER: string;
  RATE_SALT: string;
  RESEND_API_KEY: string;
  GOOGLE_CLIENT_SECRET: string;
  PADDLE_WEBHOOK_SECRET: string;
  // optional upstream overrides (tests / local dev)
  ANTHROPIC_BASE_URL?: string;
  RESEND_BASE_URL?: string;
  GOOGLE_AUTH_URL?: string;
  GOOGLE_TOKEN_URL?: string;
  GOOGLE_JWKS_URL?: string;
  DEV_INSECURE_COOKIES?: string; // "1" only for http://localhost dev
}

export type AppEnv = { Bindings: Env; Variables: { userId?: string; sessionId?: string; rid: string } };

export const list = (v: string | undefined) =>
  (v || "").split(",").map((s) => s.trim()).filter(Boolean);

export const origin = (env: Env) =>
  env.DOMAIN.startsWith("localhost") || env.DOMAIN.startsWith("127.0.0.1") ? `http://${env.DOMAIN}` : `https://${env.DOMAIN}`;
