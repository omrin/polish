const { DEFAULT_SETTINGS } = globalThis.WA_API;
const ACC = globalThis.WA_ACCOUNT;
const ALL_DEFAULTS = Object.assign({}, DEFAULT_SETTINGS, ACC.DEFAULT_ACCOUNT);
const $ = (id) => document.getElementById(id);
const status = (msg, cls = "") => { const s = $("status"); s.textContent = msg; s.className = cls; };
const send = (msg) => chrome.runtime.sendMessage(msg);

async function current() {
  const stored = await chrome.storage.local.get(Object.keys(ALL_DEFAULTS));
  if (!("authMode" in stored) && stored.apiKey) stored.authMode = "api_key";
  return Object.assign({}, ALL_DEFAULTS, stored);
}

function showMode(mode) {
  $("mode-account").checked = mode !== "api_key";
  $("mode-key").checked = mode === "api_key";
  $("account-section").hidden = mode === "api_key";
  $("key-section").hidden = mode !== "api_key";
}

function showAccount(s) {
  const signedIn = !!s.refreshToken;
  $("signed-out").hidden = signedIn;
  $("signed-in").hidden = !signedIn;
  $("acct-email").textContent = s.accountEmail || "";
  $("acct-balance").textContent = ACC.formatBalance(s.balanceCredits, s.approxChecks) || "Balance not loaded yet";
}

async function load() {
  const s = await current();
  showMode(s.authMode);
  showAccount(s);
  $("apiKey").value = s.apiKey;
  $("model").value = s.model;
  $("fastModel").value = s.fastModel;
  $("useFastModel").checked = s.useFastModel;
  $("useFastModelAcct").checked = s.useFastModel;
  $("explanationLanguage").value = s.explanationLanguage;
  $("maxChars").value = s.maxChars;
  $("refusalFallback").checked = s.refusalFallback;
  document.querySelectorAll(".label").forEach((el, i) => { el.value = s.labels[i] || ""; });
  if (s.authMode !== "api_key" && s.refreshToken) refreshBalance(true);
}

async function save() {
  const labels = [...document.querySelectorAll(".label")].map((e) => e.value.trim()).filter(Boolean);
  const mode = $("mode-key").checked ? "api_key" : "account";
  await chrome.storage.local.set({
    authMode: mode,
    apiKey: $("apiKey").value.trim(),
    model: $("model").value.trim() || DEFAULT_SETTINGS.model,
    fastModel: $("fastModel").value.trim() || DEFAULT_SETTINGS.fastModel,
    useFastModel: mode === "api_key" ? $("useFastModel").checked : $("useFastModelAcct").checked,
    labels: labels.length ? labels : DEFAULT_SETTINGS.labels,
    explanationLanguage: $("explanationLanguage").value,
    maxChars: Math.max(100, Number($("maxChars").value) || DEFAULT_SETTINGS.maxChars),
    refusalFallback: $("refusalFallback").checked,
  });
  status("Saved ✓", "ok");
}

async function refreshBalance(quiet) {
  const resp = await send({ type: "WA_GET_ACCOUNT" });
  if (resp && resp.account) {
    showAccount(await current());
    if (!quiet) status("Balance updated ✓", "ok");
  } else if (resp && resp.error) {
    if (resp.error.code === "signed_out") showAccount(await current());
    if (!quiet || resp.error.code === "signed_out") status(resp.error.message, "err");
  }
}

for (const id of ["mode-account", "mode-key"]) {
  $(id).addEventListener("change", async () => {
    showMode($("mode-key").checked ? "api_key" : "account");
    await save();
  });
}
$("save").addEventListener("click", save);
$("toggleKey").addEventListener("click", () => {
  const k = $("apiKey"); const show = k.type === "password";
  k.type = show ? "text" : "password"; $("toggleKey").textContent = show ? "Hide" : "Show";
});
$("signin").addEventListener("click", async () => {
  status("Opening sign-in…");
  const resp = await send({ type: "WA_SIGN_IN" });
  if (resp && resp.ok) { showAccount(await current()); status("Signed in ✓", "ok"); }
  else status((resp && resp.error && resp.error.message) || "Sign-in failed.", "err");
});
$("signout").addEventListener("click", async () => {
  await send({ type: "WA_SIGN_OUT" });
  showAccount(await current());
  status("Signed out.");
});
$("refresh").addEventListener("click", () => refreshBalance(false));
$("buy").addEventListener("click", async () => {
  send({ type: "WA_OPEN_URL", url: globalThis.WA_SHARED.service.buy_url.replace(/^https:\/\/[^/]+/, (await current()).serverBaseUrl.replace(/\/$/, "")) });
});
$("test").addEventListener("click", async () => {
  await save();
  status("Testing…");
  const resp = await send({ type: "WA_ANALYZE", text: "This are a test.", mode: "fix" });
  if (resp && resp.result) {
    status(`Works ✓  (“This are a test.” → “${resp.result.corrected_text}”)`, "ok");
    showAccount(await current());
  } else status((resp && resp.error && resp.error.message) || "Failed", "err");
});
load();
