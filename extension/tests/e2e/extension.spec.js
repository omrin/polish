// End-to-end: loads the unpacked extension in Chromium and drives it against a mock Claude API.
// Run: npm run test:e2e   (needs the `playwright` package and a Chromium build)
const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");
const { chromium } = require("playwright");
const mock = require("./mock-api");

const EXT = path.resolve(__dirname, "../..");
const CORRECTED = "I have an apple and I want to eat it.";
let ctx, sw, api, page, userDir;

async function setSettings(s) {
  await sw.evaluate(async (s) => { await chrome.storage.local.clear(); await chrome.storage.local.set(s); }, s);
}

async function openPage() {
  if (page) await page.close();
  page = await ctx.newPage();
  await page.goto(`http://127.0.0.1:${api.port}/page.html`);
  await page.waitForFunction(() => document.querySelector("#ta") && true);
}

const card = () => page.locator("wa-card-host .card");

test.before(async () => {
  api = await mock.start();
  userDir = fs.mkdtempSync(path.join(os.tmpdir(), "wa-e2e-"));
  ctx = await chromium.launchPersistentContext(userDir, {
    channel: "chromium", headless: true,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });
  [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent("serviceworker");
  // Close the options tab that opens on first install.
  for (const p of ctx.pages()) if (p.url().startsWith("chrome-extension://")) await p.close();
});

test.after(async () => {
  await ctx?.close();
  api?.server.close();
});

test.beforeEach(async () => {
  await setSettings({ apiKey: "test-key", apiBaseUrl: `http://127.0.0.1:${api.port}` });
  api.requests.length = 0;
  await openPage();
});

test("textarea: floating button -> fix -> apply", async () => {
  await page.click("#ta");
  const fixBtn = page.locator("wa-button-host button.f");
  await fixBtn.waitFor({ state: "visible" });
  await fixBtn.click();
  await card().getByText("Fixes (3)").waitFor();
  await page.screenshot({ path: path.join(os.tmpdir(), "wa-e2e-textarea.png") });
  assert.equal(await card().locator("del").first().textContent(), "has");
  await card().locator('[data-act="apply"]').click();
  assert.equal(await page.inputValue("#ta"), CORRECTED);
  assert.ok((await page.evaluate(() => window.inputEvents)) > 0, "input event fired");
  const req = api.requests[0];
  assert.equal(req.body.model, "claude-opus-5-5");
  assert.equal(req.headers["anthropic-dangerous-direct-browser-access"], "true");
  assert.equal(req.body.fallbacks, "default");
  assert.ok(req.body.output_config.format.schema.properties.corrected_text);
  assert.ok(req.body.messages[0].content.startsWith("<text>\nI has a apple"));
});

test("text input: only the selected part is checked and replaced", async () => {
  await page.fill("#inp", "Hello. I has a apple and I wnat to eat it. Bye.");
  await page.evaluate(() => { const el = document.querySelector("#inp"); el.focus(); el.setSelectionRange(7, 42); });
  await page.locator("wa-button-host button.f").click();
  await card().getByText("Fixes (3)").waitFor();
  await card().locator('[data-act="apply"]').click();
  assert.equal(await page.inputValue("#inp"), `Hello. ${CORRECTED} Bye.`);
});

test("contenteditable: fix -> apply", async () => {
  await page.click("#ce");
  await page.locator("wa-button-host button.f").click();
  await card().getByText("Fixes (3)").waitFor();
  await card().locator('[data-act="apply"]').click();
  assert.equal((await page.locator("#ce").innerText()).trim(), CORRECTED);
});

test("rephrase via keyboard command path -> pick Concise -> apply", async () => {
  await page.click("#ta");
  // chrome.commands can't be pressed from Playwright; send the same message the command handler sends.
  await sw.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    await chrome.tabs.sendMessage(tab.id, { type: "WA_RUN", mode: "rephrase" });
  });
  await card().getByText("Alternatives").waitFor();
  assert.equal(await card().locator("label.alt").count(), 4);
  assert.match(api.requests[0].body.system, /exactly 3 alternatives/);
  await page.screenshot({ path: path.join(os.tmpdir(), "wa-e2e-rephrase.png") });
  await card().locator("label.alt", { hasText: "Concise" }).click();
  await card().locator('[data-act="apply"]').click();
  assert.equal(await page.inputValue("#ta"), "I'll eat my apple.");
});

test("Hebrew text renders right-to-left", async () => {
  await page.click("#he");
  await page.locator("wa-button-host button.f").click();
  await card().getByText("Fixes (1)").waitFor();
  assert.equal(await card().getAttribute("dir"), "rtl");
  await page.screenshot({ path: path.join(os.tmpdir(), "wa-e2e-hebrew.png") });
  await card().locator('[data-act="apply"]').click();
  assert.equal(await page.inputValue("#he"), "אני הולך לבית הספר מחר.");
});

test("missing API key shows a helpful error", async () => {
  await setSettings({ apiBaseUrl: `http://127.0.0.1:${api.port}` });
  await page.click("#ta");
  await page.locator("wa-button-host button.f").click();
  await card().getByText("Add your Anthropic API key").waitFor();
  assert.equal(await card().locator('[data-act="options"]').count(), 1);
  assert.equal(api.requests.length, 0);
});

test("invalid API key (401)", async () => {
  await setSettings({ apiKey: "bad-key", apiBaseUrl: `http://127.0.0.1:${api.port}` });
  await page.click("#ta");
  await page.locator("wa-button-host button.f").click();
  await card().getByText("Invalid API key").waitFor();
});

test("Escape closes the card without changing text", async () => {
  await page.click("#ta");
  await page.locator("wa-button-host button.f").click();
  await card().getByText("Fixes (3)").waitFor();
  await page.keyboard.press("Escape");
  assert.equal(await card().count(), 0);
  assert.equal(await page.inputValue("#ta"), "I has a apple and I wnat to eat it.");
});
