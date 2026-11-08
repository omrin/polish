import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { AppEnv, Env } from "./env";
import { list, origin } from "./env";
import { onError } from "./errors";
import { nowSec, ulid } from "./lib/ids";
import { releaseStaleHolds } from "./lib/ledger";
import { account } from "./routes/account";
import { admin } from "./routes/admin";
import { analyze } from "./routes/analyze";
import { authCode } from "./routes/auth_code";
import { authDevice } from "./routes/auth_device";
import { authEmail } from "./routes/auth_email";
import { authGoogle } from "./routes/auth_google";
import { authSession } from "./routes/auth_session";
import { paddle } from "./routes/paddle";

const app = new Hono<AppEnv>();

app.use("*", async (c, next) => {
  c.set("rid", ulid());
  await next();
});

// CORS: the website itself, and the allow-listed Chrome extensions. The desktop app sends no Origin.
app.use("/v1/*", async (c, next) => {
  const reqOrigin = c.req.header("origin");
  const allowed = new Set([origin(c.env), ...list(c.env.EXTENSION_IDS).map((id) => `chrome-extension://${id}`)]);
  const ok = !!reqOrigin && allowed.has(reqOrigin);
  if (c.req.method === "OPTIONS") {
    if (!ok) return c.body(null, 403);
    return c.body(null, 204, {
      "Access-Control-Allow-Origin": reqOrigin!,
      "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "authorization, content-type, x-requested-with",
      "Access-Control-Max-Age": "600",
      Vary: "Origin",
    });
  }
  if (reqOrigin && !ok) return c.json({ error: { code: "forbidden", message: "Origin not allowed." } }, 403);
  await next();
  if (ok) {
    c.res.headers.set("Access-Control-Allow-Origin", reqOrigin!);
    c.res.headers.append("Vary", "Origin");
  }
});

app.use("/v1/*", bodyLimit({ maxSize: 64 * 1024, onError: (c) => c.json({ error: { code: "bad_request", message: "Request too large." } }, 413) }));

app.route("/v1/auth/email", authEmail);
app.route("/v1/auth/device", authDevice);
app.route("/v1/auth/code", authCode);
app.route("/v1/auth", authSession);
app.route("/v1/analyze", analyze);
app.route("/v1", account);
app.route("/auth/google", authGoogle);
app.route("/webhooks/paddle", paddle);
app.route("/admin", admin);

app.notFound(async (c) => {
  if (c.req.path.startsWith("/v1/") || c.req.path.startsWith("/admin/")) {
    return c.json({ error: { code: "not_found", message: "Not found." } }, 404);
  }
  return c.env.ASSETS ? c.env.ASSETS.fetch(c.req.raw) : c.text("Not found", 404);
});
app.onError(onError);

export async function scheduled(env: Env) {
  const now = nowSec();
  await releaseStaleHolds(env.DB, 300);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM login_codes WHERE expires_at < ?").bind(now - 86400),
    env.DB.prepare("DELETE FROM device_codes WHERE expires_at < ?").bind(now - 86400),
    env.DB.prepare("DELETE FROM auth_codes WHERE expires_at < ?").bind(now - 86400),
    env.DB.prepare("DELETE FROM oauth_states WHERE expires_at < ?").bind(now),
    env.DB.prepare("DELETE FROM rate_limits WHERE window_start < ?").bind(now - 2 * 86400),
    env.DB.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(now - 30 * 86400),
  ]);
}

export { app };
export default {
  fetch: app.fetch,
  scheduled: (_e: ScheduledController, env: Env, ctx: ExecutionContext) => ctx.waitUntil(scheduled(env)),
} satisfies ExportedHandler<Env>;
