// End-to-end, account mode: the real extension in Chromium talks to the real Polish server (wrangler dev,
// local D1). Only the upstreams are mocked: Anthropic (/v1/messages) and Resend (/emails).
const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");
const { spawn, execFileSync } = require("node:child_process");
const { chromium } = require("playwright");
const mock = require("./mock-api");

const EXT = path.resolve(__dirname, "../..");
const SERVER = path.resolve(__dirname, "../../../server");
const PORT = 8799;
const BASE = `http://127.0.0.1:${PORT}`;
const CORRECTED = "I have an apple and I want to eat it.";
let ctx, sw, api, page, wrangler, persist;

const env = () => {
  const e = { ...process.env };
  for (const k of ["HTTPS_PROXY", "HTTP_PROXY", "https_proxy", "http_proxy", "ALL_PROXY"]) delete e[k];
  return e;
};
function wr(args) {
  return execFileSync("npx", ["wrangler", ...args], { cwd: SERVER, env: env(), stdio: "pipe" }).toString();
}
async function waitFor(url, ms = 60000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { const r = await fetch(url); if (r.ok) return; } catch (e) { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`server did not start: ${url}`);
}
async function signInByEmail(email) {
  const post = (p, body) => fetch(BASE + p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());
  await post("/v1/auth/email/start", { email });
  const mail = api.emails[api.emails.length - 1];
  const code = /(\d{6})/.exec(mail.subject)[1];
  return post("/v1/auth/email/verify", { email, code, client: "extension", device_name: "Chrome (test)" });
}
async function setStorage(s) {
  await sw.evaluate(async (s) => { await chrome.storage.local.clear(); await chrome.storage.local.set(s); }, s);
}
const card = () => page.locator("wa-card-host .card");

test.before(async () => {
  api = await mock.start();
  persist = fs.mkdtempSync(path.join(os.tmpdir(), "polish-d1-"));
  fs.writeFileSync(path.join(SERVER, ".dev.vars"), [
    "ANTHROPIC_API_KEY=dev-key", "SESSION_SECRET=dev-session-secret-0123456789", "CODE_PEPPER=p", "RATE_SALT=s",
    "RESEND_API_KEY=r", "GOOGLE_CLIENT_SECRET=g", "PADDLE_WEBHOOK_SECRET=w",
    `ANTHROPIC_BASE_URL=http://127.0.0.1:${api.port}`, `RESEND_BASE_URL=http://127.0.0.1:${api.port}`,
    `DOMAIN=127.0.0.1:${PORT}`, "DEV_INSECURE_COOKIES=1",
  ].join("\n"));
  wr(["d1", "migrations", "apply", "polish-db", "--local", "--persist-to", persist]);
  wrangler = spawn("npx", ["wrangler", "dev", "--port", String(PORT), "--ip", "127.0.0.1", "--persist-to", persist, "--test-scheduled"],
    { cwd: SERVER, env: env(), stdio: "ignore" });
  await waitFor(`${BASE}/v1/config`);

  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), "wa-e2e-acct-"));
  ctx = await chromium.launchPersistentContext(userDir, {
    channel: "chromium", headless: true,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });
  [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent("serviceworker");
  for (const p of ctx.pages()) if (p.url().startsWith("chrome-extension://")) await p.close();
});

test.after(async () => {
  await ctx?.close();
  api?.server.close();
  wrangler?.kill();
  try { fs.unlinkSync(path.join(SERVER, ".dev.vars")); } catch (e) { /* ignore */ }
});

test.beforeEach(async () => {
  api.requests.length = 0;
  if (page) await page.close();
  page = await ctx.newPage();
  await page.goto(`http://127.0.0.1:${api.port}/page.html`);
});

test("signed-in account: fix through the Polish server, balance shown, no API key in the extension", async () => {
  const t = await signInByEmail("e2e-user@example.com");
  assert.equal(t.balance_credits, 75);
  await setStorage({ authMode: "account", serverBaseUrl: BASE, refreshToken: t.refresh_token, accessToken: t.access_token, accessTokenExp: Math.floor(Date.now() / 1000) + 3600 });
  await page.click("#ta");
  await page.locator("wa-button-host button.f").click();
  await card().getByText("Fixes (3)").waitFor();
  assert.equal(await card().locator(".hdr .m").textContent(), "≈ 17 checks left");
  await page.screenshot({ path: path.join(os.tmpdir(), "wa-e2e-account.png") });
  await card().locator('[data-act="apply"]').click();
  assert.equal(await page.inputValue("#ta"), CORRECTED);
  // The upstream call came from the server (operator key), not from the extension.
  assert.equal(api.requests.length, 1);
  assert.equal(api.requests[0].headers["authorization"], "Bearer dev-key");
  assert.equal(api.requests[0].body.model, "claude-opus-5-5");
  const stored = await sw.evaluate(() => chrome.storage.local.get(["balanceCredits", "apiKey"]));
  assert.equal(stored.balanceCredits, 71);
  assert.ok(!stored.apiKey);
});

test("expired access token is refreshed automatically", async () => {
  const t = await signInByEmail("e2e-refresh@example.com");
  await setStorage({ authMode: "account", serverBaseUrl: BASE, refreshToken: t.refresh_token, accessToken: "stale", accessTokenExp: 0 });
  await page.click("#ta");
  await page.locator("wa-button-host button.f").click();
  await card().getByText("Fixes (3)").waitFor();
});

test("out of credits shows a Buy credits button", async () => {
  const t = await signInByEmail("e2e-broke@example.com");
  execFileSync("npx", ["wrangler", "d1", "execute", "polish-db", "--local", "--persist-to", persist, "--command",
    `INSERT INTO ledger (id,user_id,kind,delta_credits,ref,created_at) VALUES ('drain','${t.user.id}','admin_grant',-75,'test:drain',1)`],
    { cwd: SERVER, env: env(), stdio: "pipe" });
  await setStorage({ authMode: "account", serverBaseUrl: BASE, refreshToken: t.refresh_token, accessToken: t.access_token, accessTokenExp: Math.floor(Date.now() / 1000) + 3600 });
  await page.click("#ta");
  await page.locator("wa-button-host button.f").click();
  await card().getByText("You're out of credits.").waitFor();
  assert.equal(await card().locator('[data-act="buy"]').count(), 1);
  await page.screenshot({ path: path.join(os.tmpdir(), "wa-e2e-nocredits.png") });
  assert.equal(api.requests.length, 0);
});

test("signed out shows a Sign in button", async () => {
  await setStorage({ authMode: "account", serverBaseUrl: BASE });
  await page.click("#ta");
  await page.locator("wa-button-host button.f").click();
  await card().getByText("Sign in to Polish to continue.").waitFor();
  assert.equal(await card().locator('[data-act="signin"]').count(), 1);
});

test("revoked sign-in is detected", async () => {
  const t = await signInByEmail("e2e-revoked@example.com");
  await fetch(BASE + "/v1/auth/logout", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ refresh_token: t.refresh_token }) });
  await setStorage({ authMode: "account", serverBaseUrl: BASE, refreshToken: t.refresh_token, accessToken: "x", accessTokenExp: 0 });
  await page.click("#ta");
  await page.locator("wa-button-host button.f").click();
  await card().getByText("Your sign-in has expired. Sign in again.").waitFor();
});
