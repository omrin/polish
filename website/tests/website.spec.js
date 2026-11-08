// Browser test of the website pages served by the Worker (wrangler dev, local D1, mocked Resend/Anthropic).
// Run: NODE_PATH=<playwright> node --test website/tests/website.spec.js
const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");
const crypto = require("node:crypto");
const { spawn, execFileSync } = require("node:child_process");
const { chromium } = require("playwright");
const mock = require("../../extension/tests/e2e/mock-api");

const SERVER = path.resolve(__dirname, "../../server");
const PORT = 8798;
const BASE = `http://127.0.0.1:${PORT}`;
const SHOTS = process.env.SHOTS_DIR || os.tmpdir();
let api, wrangler, browser, persist;

const env = () => { const e = { ...process.env }; for (const k of ["HTTPS_PROXY", "HTTP_PROXY", "https_proxy", "http_proxy"]) delete e[k]; return e; };
async function waitFor(url, ms = 60000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { try { if ((await fetch(url)).ok) return; } catch (e) { /* starting */ } await new Promise((r) => setTimeout(r, 500)); }
  throw new Error("server did not start");
}
const post = (p, body) => fetch(BASE + p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const lastCode = () => /(\d{6})/.exec(api.emails[api.emails.length - 1].subject)[1];

async function signInOnPage(page, email) {
  await page.waitForURL(/\/signin/);
  await page.fill("#email", email);
  await page.click("#send");
  await page.waitForSelector("#code-form:not([hidden])");
  await page.fill("#code", lastCode()); // auto-submits at 6 digits
}

test.before(async () => {
  api = await mock.start();
  persist = fs.mkdtempSync(path.join(os.tmpdir(), "polish-site-"));
  fs.writeFileSync(path.join(SERVER, ".dev.vars"), [
    "ANTHROPIC_API_KEY=dev", "SESSION_SECRET=dev-session-secret-0123456789", "CODE_PEPPER=p", "RATE_SALT=s", "RESEND_API_KEY=r",
    "GOOGLE_CLIENT_SECRET=g", "PADDLE_WEBHOOK_SECRET=w", `ANTHROPIC_BASE_URL=http://127.0.0.1:${api.port}`,
    `RESEND_BASE_URL=http://127.0.0.1:${api.port}`, `DOMAIN=127.0.0.1:${PORT}`, "DEV_INSECURE_COOKIES=1", "GOOGLE_CLIENT_ID=",
  ].join("\n"));
  execFileSync("npx", ["wrangler", "d1", "migrations", "apply", "polish-db", "--local", "--persist-to", persist], { cwd: SERVER, env: env(), stdio: "pipe" });
  wrangler = spawn("npx", ["wrangler", "dev", "--port", String(PORT), "--ip", "127.0.0.1", "--persist-to", persist], { cwd: SERVER, env: env(), stdio: "ignore", detached: true });
  await waitFor(`${BASE}/v1/config`);
  browser = await chromium.launch();
});

test.after(async () => {
  await browser?.close();
  // wrangler starts workerd children; kill the whole process group so no server is left running.
  try { process.kill(-wrangler.pid, "SIGTERM"); } catch (e) { /* already gone */ }
  api?.server.close();
  try { fs.unlinkSync(path.join(SERVER, ".dev.vars")); } catch (e) { /* ignore */ }
});

test("landing page and legal pages are served", async () => {
  const page = await browser.newPage();
  await page.goto(BASE + "/");
  assert.match(await page.title(), /Polish/);
  assert.ok(await page.locator("#pricing").count());
  for (const p of ["/terms", "/privacy", "/refunds"]) {
    await page.goto(BASE + p);
    assert.ok((await page.locator("h1").textContent()).length > 3, p);
  }
  const r = await fetch(BASE + "/account");
  assert.match(r.headers.get("content-security-policy") || "", /default-src 'self'/);
  await page.close();
});

test("desktop sign-in: device code -> sign in with email code -> approve -> app gets tokens", async () => {
  const start = await (await post("/v1/auth/device/start", { client: "desktop", device_name: "Ward PC" })).json();
  const page = await browser.newPage({ viewport: { width: 1100, height: 760 } });
  await page.goto(start.verification_url);
  await signInOnPage(page, "nurse@example.com");
  await page.waitForURL(/\/connect\?code=/);
  await page.waitForSelector("#ask:not([hidden])");
  assert.equal(await page.locator("#code-box").textContent(), start.user_code);
  assert.match(await page.locator("#ask-text").textContent(), /Ward PC/);
  await page.screenshot({ path: path.join(SHOTS, "site-connect.png") });
  await page.click("#approve");
  await page.waitForSelector("#done:not([hidden])");
  const tok = await post("/v1/auth/device/token", { device_code: start.device_code });
  assert.equal(tok.status, 200);
  const j = await tok.json();
  assert.equal(j.user.email, "nurse@example.com");
  assert.equal(j.balance_credits, 75);
  await page.close();
});

test("extension sign-in: connect page returns a code to the chromiumapp.org redirect", async () => {
  const page = await browser.newPage();
  // sign in first through the normal page
  await page.goto(BASE + "/signin");
  await signInOnPage(page, "chrome-user@example.com");
  await page.waitForURL(/\/account/);
  const verifier = crypto.randomBytes(48).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  const redirect = "https://ghcmmobadipaafjcogaihkckndjkahko.chromiumapp.org/cb";
  let landed = null;
  await page.route((url) => url.hostname.endsWith(".chromiumapp.org"), (route) => { landed = route.request().url(); route.fulfill({ body: "ok" }); });
  await page.goto(`${BASE}/connect?client=extension&redirect_uri=${encodeURIComponent(redirect)}&state=xyz&code_challenge=${challenge}`);
  await page.waitForSelector("#ask:not([hidden])");
  await page.click("#approve");
  await page.waitForURL((url) => url.hostname.endsWith(".chromiumapp.org"));
  const u = new URL(landed);
  assert.equal(u.searchParams.get("state"), "xyz");
  const ex = await post("/v1/auth/code/exchange", { code: u.searchParams.get("code"), code_verifier: verifier, redirect_uri: redirect });
  assert.equal(ex.status, 200);
  await page.close();
});

test("account page shows balance, packs and devices", async () => {
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  await page.goto(BASE + "/account");
  await signInOnPage(page, "buyer@example.com");
  await page.waitForURL(/\/account/);
  await page.waitForSelector("#page:not([hidden])");
  assert.equal(await page.locator("#balance").textContent(), "$0.75");
  assert.equal(await page.locator(".pack").count(), 3);
  assert.equal(await page.locator("#paddle-off").isHidden(), false); // no Paddle token configured in dev
  await page.waitForSelector("#devices tr");
  await page.screenshot({ path: path.join(SHOTS, "site-account.png"), fullPage: true });
  await page.goto(BASE + "/signin");
  await page.waitForURL(/\/account/); // already signed in -> redirected
  await page.close();
});

test("sign-in page screenshot (phone)", async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 760 } });
  await page.goto(BASE + "/signin");
  await page.waitForSelector("#email");
  await page.screenshot({ path: path.join(SHOTS, "site-signin-phone.png") });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  assert.equal(overflow, false);
  await page.close();
});
