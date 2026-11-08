const { DEFAULT_SETTINGS } = globalThis.WA_API;
const $ = (id) => document.getElementById(id);
const status = (msg, cls = "") => { const s = $("status"); s.textContent = msg; s.className = cls; };

async function load() {
  const s = Object.assign({}, DEFAULT_SETTINGS, await chrome.storage.local.get(Object.keys(DEFAULT_SETTINGS)));
  $("apiKey").value = s.apiKey;
  $("model").value = s.model;
  $("fastModel").value = s.fastModel;
  $("useFastModel").checked = s.useFastModel;
  $("explanationLanguage").value = s.explanationLanguage;
  $("maxChars").value = s.maxChars;
  $("refusalFallback").checked = s.refusalFallback;
  document.querySelectorAll(".label").forEach((el, i) => { el.value = s.labels[i] || ""; });
}

async function save() {
  const labels = [...document.querySelectorAll(".label")].map((e) => e.value.trim()).filter(Boolean);
  await chrome.storage.local.set({
    apiKey: $("apiKey").value.trim(),
    model: $("model").value.trim() || DEFAULT_SETTINGS.model,
    fastModel: $("fastModel").value.trim() || DEFAULT_SETTINGS.fastModel,
    useFastModel: $("useFastModel").checked,
    labels: labels.length ? labels : DEFAULT_SETTINGS.labels,
    explanationLanguage: $("explanationLanguage").value,
    maxChars: Math.max(100, Number($("maxChars").value) || DEFAULT_SETTINGS.maxChars),
    refusalFallback: $("refusalFallback").checked,
  });
  status("Saved ✓", "ok");
}

$("save").addEventListener("click", save);
$("toggleKey").addEventListener("click", () => {
  const k = $("apiKey"); const show = k.type === "password";
  k.type = show ? "text" : "password"; $("toggleKey").textContent = show ? "Hide" : "Show";
});
$("test").addEventListener("click", async () => {
  await save();
  status("Testing…");
  const resp = await chrome.runtime.sendMessage({ type: "WA_ANALYZE", text: "This are a test.", mode: "fix" });
  if (resp && resp.result) status(`Key works ✓  (“This are a test.” → “${resp.result.corrected_text}”)`, "ok");
  else status((resp && resp.error && resp.error.message) || "Failed", "err");
});
load();
