// Claude API call + prompt building + response validation. Used by the background service worker.
// Raw fetch is used because an MV3 extension without a bundler cannot load the npm SDK.
(function () {
  const S = globalThis.WA_SHARED;
  const FALLBACK_BETA = "server-side-fallback-2026-07-01";

  const MESSAGES = {
    no_api_key: "Add your Anthropic API key in Options.",
    empty: "No text in this field.",
    too_long: "The text is too long. Select a smaller part.",
    auth: "Invalid API key.",
    rate_limit: "Rate limited — try again in a few seconds.",
    network: "Can't reach the Anthropic API (check your connection or proxy).",
    refusal: "Claude declined to process this text.",
    bad_response: "Unexpected response — try again or shorten the text.",
  };

  class WAError extends Error {
    constructor(code, message) { super(message || MESSAGES[code] || "Something went wrong."); this.code = code; }
  }

  const DEFAULT_SETTINGS = {
    apiKey: "",
    model: S.default_model,
    fastModel: S.fast_model,
    useFastModel: false,
    labels: S.default_labels.slice(),
    explanationLanguage: "auto",
    maxChars: S.limits.max_chars,
    refusalFallback: true,
    apiBaseUrl: "https://api.anthropic.com",
  };

  function buildSystemPrompt(mode, labels, explanationLanguage) {
    if (!(mode in S.rephrasing_instruction)) throw new Error(`unknown mode ${mode}`);
    const lang = S.explanation_language[explanationLanguage] || S.explanation_language.auto;
    const instruction = S.rephrasing_instruction[mode]
      .split("{n}").join(String(labels.length))
      .split("{labels}").join(labels.join(", "));
    return S.system_prompt.split("{explanation_language}").join(lang)
      .split("{rephrasing_instruction}").join(instruction);
  }

  function buildUserMessage(text) { return S.user_template.split("{text}").join(text); }

  const TYPES = new Set(["spelling", "grammar", "punctuation", "style"]);
  const isStr = (v) => typeof v === "string";

  function parseResponse(raw, originalText) {
    let data;
    try { data = JSON.parse(raw); } catch (e) { throw new WAError("bad_response"); }
    if (!data || typeof data !== "object" || Array.isArray(data) || !isStr(data.corrected_text)
        || !Array.isArray(data.corrections || []) || !Array.isArray(data.rephrasings || []))
      throw new WAError("bad_response");
    const corrections = data.corrections || [];
    for (const c of corrections) {
      if (!c || !isStr(c.original) || !isStr(c.replacement) || !isStr(c.explanation) || !TYPES.has(c.type))
        throw new WAError("bad_response");
    }
    const rephrasings = data.rephrasings || [];
    for (const r of rephrasings) if (!r || !isStr(r.label) || !isStr(r.text)) throw new WAError("bad_response");
    const kept = corrections.filter((c) => c.original && originalText.includes(c.original));
    return {
      corrected_text: data.corrected_text,
      corrections: kept,
      rephrasings,
      has_changes: data.corrected_text !== originalText,
      dropped_corrections: corrections.length - kept.length,
    };
  }

  function activeModel(s) { return s.useFastModel ? s.fastModel : s.model; }

  function buildRequest(text, mode, settings) {
    const model = activeModel(settings);
    const body = {
      model,
      max_tokens: 16000,
      system: buildSystemPrompt(mode, settings.labels, settings.explanationLanguage),
      messages: [{ role: "user", content: buildUserMessage(text) }],
      output_config: { effort: "low", format: { type: "json_schema", schema: S.schema } },
    };
    const headers = {
      "content-type": "application/json",
      "x-api-key": settings.apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    };
    if (settings.refusalFallback && S.fallback_models.includes(model)) {
      headers["anthropic-beta"] = FALLBACK_BETA;
      body.fallbacks = "default";
    }
    return { url: `${settings.apiBaseUrl.replace(/\/$/, "")}/v1/messages`, headers, body };
  }

  async function analyze(text, mode, settingsIn, fetchImpl) {
    const settings = Object.assign({}, DEFAULT_SETTINGS, settingsIn || {});
    const doFetch = fetchImpl || globalThis.fetch.bind(globalThis);
    if (!settings.apiKey) throw new WAError("no_api_key");
    if (!text || !text.trim()) throw new WAError("empty");
    if (text.length > settings.maxChars)
      throw new WAError("too_long", `Text is ${text.length.toLocaleString()} characters; limit is ${settings.maxChars.toLocaleString()}. Select a smaller part.`);
    const req = buildRequest(text, mode, settings);
    let resp;
    try {
      resp = await doFetch(req.url, {
        method: "POST", headers: req.headers, body: JSON.stringify(req.body),
        signal: AbortSignal.timeout(S.limits.timeout_seconds * 1000),
      });
    } catch (e) {
      throw new WAError("network");
    }
    let json = null;
    try { json = await resp.json(); } catch (e) { /* handled below */ }
    if (!resp.ok) {
      if (resp.status === 401) throw new WAError("auth");
      if (resp.status === 403) throw new WAError("auth", "This API key isn't allowed to use that model.");
      if (resp.status === 429) throw new WAError("rate_limit");
      const msg = json && json.error && json.error.message ? json.error.message : resp.statusText;
      throw new WAError("api_error", `API error ${resp.status}: ${msg}`);
    }
    if (!json) throw new WAError("bad_response");
    if (json.stop_reason === "refusal") throw new WAError("refusal");
    if (json.stop_reason === "max_tokens") throw new WAError("too_long", "The response was cut off — select a shorter piece of text.");
    const block = (json.content || []).find((b) => b.type === "text");
    if (!block) throw new WAError("bad_response");
    const result = parseResponse(block.text, text);
    result.model = json.model || req.body.model;
    return result;
  }

  globalThis.WA_API = { WAError, MESSAGES, DEFAULT_SETTINGS, buildSystemPrompt, buildUserMessage,
    parseResponse, buildRequest, analyze, activeModel };
  if (typeof module !== "undefined") module.exports = globalThis.WA_API;
})();
