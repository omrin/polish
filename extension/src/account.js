// Polish account mode: sign in with the Polish service and check text through it (no API key needed).
// Used by the background service worker. Pure functions with injected chrome/fetch so they can be unit-tested.
(function () {
  const S = globalThis.WA_SHARED;
  const API = globalThis.WA_API;

  const DEFAULT_ACCOUNT = {
    authMode: "account", // "account" | "api_key"
    serverBaseUrl: S.service.base_url,
    refreshToken: "",
    accessToken: "",
    accessTokenExp: 0,
    accountEmail: "",
    balanceCredits: null,
    approxChecks: null,
  };

  const MESSAGES = {
    signed_out: "Sign in to Polish to continue.",
    no_credits: "You're out of credits.",
    server: "Can't reach the Polish service. Check your connection.",
    paused: "Polish is paused for maintenance. Try again later.",
    disabled: "This account is disabled. Contact support.",
    sign_in_failed: "Sign-in didn't finish. Try again.",
  };

  const WAError = API.WAError;
  const fail = (code, message, extra) => Object.assign(new WAError(code, message || MESSAGES[code]), extra || {});
  const base = (s) => String(s.serverBaseUrl || DEFAULT_ACCOUNT.serverBaseUrl).replace(/\/$/, "");
  const nowSec = () => Math.floor(Date.now() / 1000);

  function b64url(bytes) {
    let s = "";
    for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  async function pkce() {
    const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
    const challenge = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
    return { verifier, challenge };
  }

  async function postJson(fetchImpl, url, body, token) {
    const headers = { "content-type": "application/json" };
    if (token) headers.authorization = `Bearer ${token}`;
    let resp;
    try {
      resp = await fetchImpl(url, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(S.limits.timeout_seconds * 1000 + 10000) });
    } catch (e) {
      throw fail("server");
    }
    let json = null;
    try { json = await resp.json(); } catch (e) { /* non-JSON */ }
    return { status: resp.status, ok: resp.ok, json };
  }

  /** Account fields saved after sign-in or refresh. */
  function tokenFields(j) {
    const out = {};
    if (j.refresh_token) out.refreshToken = j.refresh_token;
    if (j.access_token) { out.accessToken = j.access_token; out.accessTokenExp = nowSec() + (j.expires_in || 3600); }
    if (j.user && j.user.email) out.accountEmail = j.user.email;
    if (typeof j.balance_credits === "number") out.balanceCredits = j.balance_credits;
    if (typeof j.approx_checks_left === "number") out.approxChecks = j.approx_checks_left;
    return out;
  }

  /**
   * Interactive sign-in: opens the Polish website in a Chrome auth window, the user approves,
   * and the extension exchanges the one-time code (PKCE) for tokens.
   */
  async function signIn(settings, deps) {
    const { identity, store, fetchImpl } = deps;
    const { verifier, challenge } = await pkce();
    const state = b64url(crypto.getRandomValues(new Uint8Array(16)));
    const redirectUri = identity.getRedirectURL("cb");
    const url = `${base(settings)}/connect?` + new URLSearchParams({
      client: "extension", redirect_uri: redirectUri, state, code_challenge: challenge,
    }).toString();
    let responseUrl;
    try {
      responseUrl = await identity.launchWebAuthFlow({ url, interactive: true });
    } catch (e) {
      throw fail("sign_in_failed", "Sign-in was closed before it finished.");
    }
    const back = new URL(responseUrl);
    if (back.searchParams.get("state") !== state || !back.searchParams.get("code")) throw fail("sign_in_failed");
    const r = await postJson(fetchImpl, `${base(settings)}/v1/auth/code/exchange`, {
      code: back.searchParams.get("code"), code_verifier: verifier, redirect_uri: redirectUri,
    });
    if (!r.ok || !r.json || !r.json.refresh_token) throw fail("sign_in_failed");
    const fields = { authMode: "account", ...tokenFields(r.json) };
    await store.set(fields);
    return fields;
  }

  async function signOut(settings, deps) {
    if (settings.refreshToken) {
      try { await postJson(deps.fetchImpl, `${base(settings)}/v1/auth/logout`, { refresh_token: settings.refreshToken }); } catch (e) { /* offline is fine */ }
    }
    const cleared = { refreshToken: "", accessToken: "", accessTokenExp: 0, accountEmail: "", balanceCredits: null, approxChecks: null };
    await deps.store.set(cleared);
    return cleared;
  }

  /** Returns a valid access token, refreshing it when it's missing or about to expire. */
  async function ensureAccess(settings, deps, force) {
    if (!force && settings.accessToken && settings.accessTokenExp > nowSec() + 60) return settings.accessToken;
    if (!settings.refreshToken) throw fail("signed_out");
    const r = await postJson(deps.fetchImpl, `${base(settings)}/v1/auth/refresh`, { refresh_token: settings.refreshToken });
    if (r.status === 401) {
      await deps.store.set({ refreshToken: "", accessToken: "", accessTokenExp: 0 });
      Object.assign(settings, { refreshToken: "", accessToken: "", accessTokenExp: 0 });
      throw fail("signed_out", "Your sign-in has expired. Sign in again.");
    }
    if (!r.ok || !r.json || !r.json.access_token) throw fail("server");
    const fields = tokenFields(r.json);
    Object.assign(settings, fields);
    await deps.store.set(fields);
    return settings.accessToken;
  }

  function mapError(status, json, settings) {
    const e = (json && json.error) || {};
    switch (status) {
      case 401: return fail("signed_out");
      case 402: return fail("no_credits", MESSAGES.no_credits, { buyUrl: e.buy_url || S.service.buy_url, balance: e.balance });
      case 403: return fail("disabled", e.message || MESSAGES.disabled);
      case 413: return fail("too_long", e.message);
      case 422: return fail(e.code === "refusal" ? "refusal" : "too_long", e.message);
      case 429: return fail("rate_limit", e.message);
      case 503: return fail("paused", e.message || MESSAGES.paused);
      default: return fail(status >= 500 ? "server" : "api_error", e.message || MESSAGES.server);
    }
  }

  /** Check text through the Polish service. Returns the same result shape as WA_API.analyze. */
  async function analyzeViaServer(text, mode, settings, deps) {
    if (!text || !text.trim()) throw fail("empty");
    if (text.length > S.limits.max_chars) {
      throw fail("too_long", `Text is ${text.length.toLocaleString()} characters; limit is ${S.limits.max_chars.toLocaleString()}. Select a smaller part.`);
    }
    const body = {
      text, mode,
      fast: !!settings.useFastModel,
      labels: (settings.labels && settings.labels.length ? settings.labels : S.default_labels).slice(0, 5).map((l) => String(l).slice(0, 30)),
      explanation_language: ["auto", "en", "he"].includes(settings.explanationLanguage) ? settings.explanationLanguage : "auto",
    };
    let token = await ensureAccess(settings, deps, false);
    let r = await postJson(deps.fetchImpl, `${base(settings)}/v1/analyze`, body, token);
    if (r.status === 401) {
      token = await ensureAccess(settings, deps, true);
      r = await postJson(deps.fetchImpl, `${base(settings)}/v1/analyze`, body, token);
    }
    if (!r.ok) throw mapError(r.status, r.json, settings);
    if (!r.json || r.json.result === undefined) throw fail("bad_response");
    const result = API.parseResponse(JSON.stringify(r.json.result), text);
    result.model = r.json.model;
    const u = r.json.usage || {};
    if (typeof u.approx_checks_left === "number") result.meta = `≈ ${u.approx_checks_left} checks left`;
    await deps.store.set({ balanceCredits: u.balance_credits ?? null, approxChecks: u.approx_checks_left ?? null });
    return result;
  }

  /** Current balance from the server (also confirms the sign-in still works). */
  async function fetchAccount(settings, deps) {
    const token = await ensureAccess(settings, deps, false);
    let resp;
    try {
      resp = await deps.fetchImpl(`${base(settings)}/v1/me`, { headers: { authorization: `Bearer ${token}` } });
    } catch (e) {
      throw fail("server");
    }
    if (resp.status === 401) throw fail("signed_out");
    if (!resp.ok) throw fail("server");
    const j = await resp.json();
    const fields = tokenFields(j);
    await deps.store.set(fields);
    return { email: j.user && j.user.email, balanceCredits: j.balance_credits, approxChecks: j.approx_checks_left };
  }

  /** "$4.60 · ≈ 115 checks left" */
  function formatBalance(credits, approx) {
    if (typeof credits !== "number") return "";
    const usd = (Math.max(0, credits) / 100).toFixed(2);
    return typeof approx === "number" ? `$${usd} · ≈ ${approx} checks left` : `$${usd}`;
  }

  globalThis.WA_ACCOUNT = { DEFAULT_ACCOUNT, MESSAGES, pkce, signIn, signOut, ensureAccess, analyzeViaServer, fetchAccount, formatBalance };
  if (typeof module !== "undefined") module.exports = globalThis.WA_ACCOUNT;
})();
