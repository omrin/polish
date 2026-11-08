const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
require("../../src/shared.js");
const API = require("../../src/api.js");

const FIX = (n) => fs.readFileSync(path.join(__dirname, "../../../desktop/tests/fixtures", n), "utf8");
const ORIG = "I has a apple and I wnat to eat it.";

function fakeFetch(status, json, calls = []) {
  return async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    return { ok: status < 300, status, statusText: "x", json: async () => json };
  };
}
const okBody = (text, stop = "end_turn") => ({ model: "claude-opus-5-5", stop_reason: stop, content: [{ type: "text", text }] });

test("prompt matches Python behaviour", () => {
  assert.match(API.buildSystemPrompt("fix", ["A", "B", "C"], "auto"), /rephrasings: Return an empty array\./);
  const p = API.buildSystemPrompt("rephrase", ["Formal", "Concise", "Friendly"], "he");
  assert.match(p, /exactly 3 alternatives/); assert.match(p, /Formal, Concise, Friendly/); assert.match(p, /written in Hebrew\./);
  assert.doesNotMatch(p, /\{[a-z_]+\}/);
  assert.equal(API.buildUserMessage("hi"), "<text>\nhi\n</text>");
});

test("parseResponse validates and filters", () => {
  const r = API.parseResponse(FIX("response_en.json"), ORIG);
  assert.equal(r.corrections.length, 3); assert.ok(r.has_changes);
  const r2 = API.parseResponse(JSON.stringify({ corrected_text: ORIG, corrections: [] }), ORIG);
  assert.deepEqual(r2.rephrasings, []); assert.equal(r2.has_changes, false);
  const r3 = API.parseResponse(JSON.stringify({ corrected_text: "x", rephrasings: [], corrections: [
    { original: "I has", replacement: "I have", type: "grammar", explanation: "." },
    { original: "nope", replacement: "y", type: "spelling", explanation: "." }] }), ORIG);
  assert.equal(r3.corrections.length, 1); assert.equal(r3.dropped_corrections, 1);
  for (const bad of ["not json", "[]", '{"corrections": []}',
    JSON.stringify({ corrected_text: "x", corrections: [{ original: "I", replacement: "x", type: "tone", explanation: "" }] })])
    assert.throws(() => API.parseResponse(bad, ORIG), (e) => e.code === "bad_response");
});

test("request shape: structured output, fallback, headers", async () => {
  const calls = [];
  const r = await API.analyze(ORIG, "fix", { apiKey: "k" }, fakeFetch(200, okBody(FIX("response_en.json")), calls));
  assert.ok(r.has_changes);
  const { url, init, body } = calls[0];
  assert.equal(url, "https://api.anthropic.com/v1/messages");
  assert.equal(init.headers["x-api-key"], "k");
  assert.equal(init.headers["anthropic-dangerous-direct-browser-access"], "true");
  assert.equal(init.headers["anthropic-beta"], "server-side-fallback-2026-07-01");
  assert.equal(body.fallbacks, "default");
  assert.equal(body.model, "claude-opus-5-5");
  assert.deepEqual(body.output_config.format.schema, globalThis.WA_SHARED.schema);
  assert.equal(body.output_config.effort, "low");
  assert.ok(!("temperature" in body) && !("thinking" in body));
});

test("fast model sends no fallback", async () => {
  const calls = [];
  await API.analyze(ORIG, "fix", { apiKey: "k", useFastModel: true }, fakeFetch(200, okBody(FIX("response_en.json")), calls));
  assert.equal(calls[0].body.model, "claude-haiku-5-5");
  assert.ok(!("fallbacks" in calls[0].body)); assert.ok(!("anthropic-beta" in calls[0].init.headers));
});

const expectCode = (code) => (e) => e.code === code;
test("errors", async () => {
  await assert.rejects(API.analyze(ORIG, "fix", { apiKey: "" }, fakeFetch(200, {})), expectCode("no_api_key"));
  await assert.rejects(API.analyze("  ", "fix", { apiKey: "k" }, fakeFetch(200, {})), expectCode("empty"));
  await assert.rejects(API.analyze("x".repeat(9001), "fix", { apiKey: "k" }, fakeFetch(200, {})), expectCode("too_long"));
  await assert.rejects(API.analyze(ORIG, "fix", { apiKey: "k" }, fakeFetch(401, {})), expectCode("auth"));
  await assert.rejects(API.analyze(ORIG, "fix", { apiKey: "k" }, fakeFetch(429, {})), expectCode("rate_limit"));
  await assert.rejects(API.analyze(ORIG, "fix", { apiKey: "k" }, fakeFetch(500, { error: { message: "boom" } })),
    (e) => e.code === "api_error" && /500: boom/.test(e.message));
  await assert.rejects(API.analyze(ORIG, "fix", { apiKey: "k" }, async () => { throw new TypeError("offline"); }), expectCode("network"));
  await assert.rejects(API.analyze(ORIG, "fix", { apiKey: "k" }, fakeFetch(200, okBody("", "refusal"))), expectCode("refusal"));
  await assert.rejects(API.analyze(ORIG, "fix", { apiKey: "k" }, fakeFetch(200, okBody("", "max_tokens"))), expectCode("too_long"));
});
