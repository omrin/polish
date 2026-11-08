import { defineConfig } from "vitest/config";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";

export default defineConfig(async () => {
  const migrations = await readD1Migrations("./migrations");
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.toml" },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            // Dummy secrets for tests only.
            ANTHROPIC_API_KEY: "test-anthropic-key",
            SESSION_SECRET: "test-session-secret-0123456789abcdef",
            CODE_PEPPER: "test-pepper",
            RATE_SALT: "test-salt",
            RESEND_API_KEY: "test-resend",
            GOOGLE_CLIENT_SECRET: "test-google-secret",
            PADDLE_WEBHOOK_SECRET: "test-paddle-secret",
            DOMAIN: "polish.test",
            GOOGLE_CLIENT_ID: "test-google-client",
            PADDLE_PRICE_SMALL: "pri_small",
            PADDLE_PRICE_PLUS: "pri_plus",
            PADDLE_PRICE_PRO: "pri_pro",
            EXTENSION_IDS: "abcdefghijklmnopabcdefghijklmnop",
            ADMIN_EMAILS: "admin@polish.test",
          },
        },
      }),
    ],
    test: { setupFiles: ["./test/setup.ts"] },
  };
});
