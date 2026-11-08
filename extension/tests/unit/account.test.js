const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
require("../../src/shared.js");
require("../../src/api.js");
const ACC = require("../../src/account.js");
const API = globalThis.WA_API;

const FIX = (n) => fs.readFileSync(path.join(__dirname, "../../../desktop/tests/fixtures", n), "utf8");
const ORIG = "I has a apple and I wnat to eat it.";
const BASE = "https://svc.test";
const nowSec = () => Math.floor(Date.now() / 1000);

function fakeStore(initial = {}) {
  const data = { ...initial };
  return { data, set: async (o) => Object.assign(data, o) };
}
/** routes: { "POST /v1/analyze": (body, headers) => [status, json] } */
function fakeFetch(routes) {
  const calls = [];
  const fn = async (url, init = {}) => {
    const u = new URL(url);
    const key = `${init.method || "GET"} ${u.pathname}`;
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ key, body, headers: init.headers || {} });
    const h = routes[key];
    if (!h) throw new TypeError(`network: no route ${key}`);
    const [status, json] = h(body, init.headers || {}, calls.length);
    return { ok: status < 300, status, json: async () => json };
  };
  fn.calls = calls;
  return fn;
}
const signedIn = (extra = {}) => ({ ...ACC.DEFAULT_ACCOUNT, serverBaseUrl: BASE, refreshToken: "rt", accessToken: "at", accessTokenExp: nowSec() + 3600, labels: ["Formal", "Concise", "Friendly"], explanationLanguage: "auto", useFastModel: false, ...extra });

test("PKCE challenge is the S256 of the verifier", async () => {
  const { verifier, challenge } = await ACC.pkce();
  assert.ok(verifier.length >= 43);
  assert.equal(challenge, crypto.createHash("sha256").update(verifier).digest("base64url"));
});

test("analyzeViaServer returns the same result as the own-key parser, plus checks left", async () => {
  const fx = JSON.parse(FIX("response_en.json"));
  const f = fakeFetch({ "POST /v1/analyze": () => [200, { result: fx, model: "claude-opus-5-5", usage: { balance_credits: 71, approx_checks_left: 17, credits_charged: 4 } }] });
  const store = fakeStore();
  const r = await ACC.analyzeViaServer(ORIG, "fix", signedIn(), { fetchImpl: f, store });
  const expected = API.parseResponse(JSON.stringify(fx), ORIG);
  assert.deepEqual(r.corrections, expected.corrections);
  assert.equal(r.corrected_text, expected.corrected_text);
  assert.equal(r.meta, "≈ 17 checks left");
  assert.equal(store.data.balanceCredits, 71);
  assert.deepEqual(f.calls[0].body, { text: ORIG, mode: "fix", fast: false, labels: ["Formal", "Concise", "Friendly"], explanation_language: "auto" });
  assert.equal(f.calls[0].headers.authorization, "Bearer at");
});

test("expired access token is refreshed first; a 401 refreshes once and retries", async () => {
  const fx = JSON.parse(FIX("response_en.json"));
  let analyzeCalls = 0;
  const f = fakeFetch({
    "POST /v1/auth/refresh": () => [200, { access_token: "at2", expires_in: 3600, balance_credits: 10 }],
    "POST /v1/analyze": (_b, h) => (++analyzeCalls === 1 ? [401, {}] : [200, { result: fx, model: "m", usage: {} }]),
  });
  const store = fakeStore();
  await ACC.analyzeViaServer(ORIG, "fix", signedIn({ accessTokenExp: 0 }), { fetchImpl: f, store });
  assert.deepEqual(f.calls.map((c) => c.key), ["POST /v1/auth/refresh", "POST /v1/analyze", "POST /v1/auth/refresh", "POST /v1/analyze"]);
  assert.equal(store.data.accessToken, "at2");
});

test("refresh 401 means signed out (and clears tokens)", async () => {
  const f = fakeFetch({ "POST /v1/auth/refresh": () => [401, { error: { code: "unauthorized" } }] });
  const store = fakeStore();
  await assert.rejects(ACC.analyzeViaServer(ORIG, "fix", signedIn({ accessTokenExp: 0 }), { fetchImpl: f, store }), (e) => e.code === "signed_out");
  assert.equal(store.data.refreshToken, "");
});

test("no refresh token -> signed_out without any network call", async () => {
  const f = fakeFetch({});
  await assert.rejects(ACC.analyzeViaServer(ORIG, "fix", { ...ACC.DEFAULT_ACCOUNT, serverBaseUrl: BASE }, { fetchImpl: f, store: fakeStore() }), (e) => e.code === "signed_out");
  assert.equal(f.calls.length, 0);
});

test("error mapping", async () => {
  const cases = [
    [402, { error: { code: "insufficient_credits", buy_url: "https://svc.test/account#buy" } }, (e) => e.code === "no_credits" && e.buyUrl === "https://svc.test/account#buy"],
    [413, { error: { message: "too long" } }, (e) => e.code === "too_long"],
    [422, { error: { code: "refusal" } }, (e) => e.code === "refusal"],
    [429, { error: {} }, (e) => e.code === "rate_limit"],
    [503, { error: {} }, (e) => e.code === "paused"],
    [502, { error: {} }, (e) => e.code === "server"],
    [403, { error: {} }, (e) => e.code === "disabled"],
  ];
  for (const [status, json, check] of cases) {
    const f = fakeFetch({ "POST /v1/analyze": () => [status, json] });
    await assert.rejects(ACC.analyzeViaServer(ORIG, "fix", signedIn(), { fetchImpl: f, store: fakeStore() }), check, `status ${status}`);
  }
  await assert.rejects(ACC.analyzeViaServer(ORIG, "fix", signedIn(), { fetchImpl: async () => { throw new TypeError("offline"); }, store: fakeStore() }), (e) => e.code === "server");
  await assert.rejects(ACC.analyzeViaServer("x".repeat(8001), "fix", signedIn(), { fetchImpl: fakeFetch({}), store: fakeStore() }), (e) => e.code === "too_long");
});

test("signIn opens the connect page with PKCE and exchanges the code", async () => {
  let opened;
  const identity = {
    getRedirectURL: (p) => `https://ghcmmobadipaafjcogaihkckndjkahko.chromiumapp.org/${p}`,
    launchWebAuthFlow: async ({ url }) => {
      opened = new URL(url);
      return `${opened.searchParams.get("redirect_uri")}?code=C0DE&state=${opened.searchParams.get("state")}`;
    },
  };
  const f = fakeFetch({ "POST /v1/auth/code/exchange": (b) => [200, { refresh_token: "rt", access_token: "at", expires_in: 3600, user: { email: "a@b.c" }, balance_credits: 75, approx_checks_left: 18, _body: b }] });
  const store = fakeStore();
  await ACC.signIn({ ...ACC.DEFAULT_ACCOUNT, serverBaseUrl: BASE }, { identity, store, fetchImpl: f });
  assert.equal(opened.origin + opened.pathname, `${BASE}/connect`);
  assert.equal(opened.searchParams.get("client"), "extension");
  const ex = f.calls[0].body;
  assert.equal(ex.code, "C0DE");
  assert.equal(crypto.createHash("sha256").update(ex.code_verifier).digest("base64url"), opened.searchParams.get("code_challenge"));
  assert.deepEqual([store.data.refreshToken, store.data.accountEmail, store.data.balanceCredits], ["rt", "a@b.c", 75]);
});

test("signIn rejects a mismatched state", async () => {
  const identity = { getRedirectURL: () => "https://x.chromiumapp.org/cb", launchWebAuthFlow: async () => "https://x.chromiumapp.org/cb?code=C&state=WRONG" };
  await assert.rejects(ACC.signIn({ ...ACC.DEFAULT_ACCOUNT, serverBaseUrl: BASE }, { identity, store: fakeStore(), fetchImpl: fakeFetch({}) }), (e) => e.code === "sign_in_failed");
});

test("formatBalance", () => {
  assert.equal(ACC.formatBalance(460, 115), "$4.60 · ≈ 115 checks left");
  assert.equal(ACC.formatBalance(-3, 0), "$0.00 · ≈ 0 checks left");
  assert.equal(ACC.formatBalance(null, null), "");
});
