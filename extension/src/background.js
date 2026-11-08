importScripts("shared.js", "api.js", "account.js");

const { analyze, DEFAULT_SETTINGS } = globalThis.WA_API;
const ACC = globalThis.WA_ACCOUNT;
const ALL_DEFAULTS = Object.assign({}, DEFAULT_SETTINGS, ACC.DEFAULT_ACCOUNT);

const store = { set: (o) => chrome.storage.local.set(o) };
const deps = () => ({ identity: chrome.identity, store, fetchImpl: (...a) => fetch(...a) });

chrome.runtime.onInstalled.addListener((details) => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: "wa-fix", title: "Fix grammar & spelling", contexts: ["editable"] });
    chrome.contextMenus.create({ id: "wa-rephrase", title: "Rephrase…", contexts: ["editable"] });
  });
  if (details.reason === "install") {
    getSettings().then((s) => { if (!s.refreshToken && !s.apiKey) chrome.runtime.openOptionsPage(); });
  }
});

function runInTab(tabId, mode, frameId) {
  const opts = typeof frameId === "number" ? { frameId } : undefined;
  chrome.tabs.sendMessage(tabId, { type: "WA_RUN", mode }, opts).catch(() => {});
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab) return;
  runInTab(tab.id, info.menuItemId === "wa-rephrase" ? "rephrase" : "fix", info.frameId);
});

chrome.commands.onCommand.addListener((command, tab) => {
  const mode = command === "rephrase" ? "rephrase" : "fix";
  if (tab) return runInTab(tab.id, mode);
  chrome.tabs.query({ active: true, currentWindow: true }).then(([t]) => t && runInTab(t.id, mode));
});

chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());

async function getSettings() {
  const stored = await chrome.storage.local.get(Object.keys(ALL_DEFAULTS));
  // People who set up an API key before accounts existed keep using it.
  if (!("authMode" in stored) && stored.apiKey) stored.authMode = "api_key";
  return Object.assign({}, ALL_DEFAULTS, stored);
}

const asError = (e) => ({ code: e.code || "error", message: e.message, buyUrl: e.buyUrl });

function handle(fn, sendResponse) {
  fn().then((r) => sendResponse(r), (e) => {
    console.warn("[Polish]", e && e.code, e && e.message);
    sendResponse({ error: asError(e) });
  });
  return true; // async response
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || sender.id !== chrome.runtime.id) return false;
  switch (msg.type) {
    case "WA_ANALYZE":
      return handle(async () => {
        const s = await getSettings();
        const result = s.authMode === "api_key"
          ? await analyze(msg.text, msg.mode, s)
          : await ACC.analyzeViaServer(msg.text, msg.mode, s, deps());
        return { result };
      }, sendResponse);
    case "WA_SIGN_IN":
      return handle(async () => ({ ok: true, account: await ACC.signIn(await getSettings(), deps()) }), sendResponse);
    case "WA_SIGN_OUT":
      return handle(async () => { await ACC.signOut(await getSettings(), deps()); return { ok: true }; }, sendResponse);
    case "WA_GET_ACCOUNT":
      return handle(async () => ({ account: await ACC.fetchAccount(await getSettings(), deps()) }), sendResponse);
    case "WA_OPEN_URL": {
      const url = String(msg.url || "");
      if (/^https?:\/\//.test(url)) chrome.tabs.create({ url });
      return false;
    }
    case "WA_OPEN_OPTIONS":
      chrome.runtime.openOptionsPage();
      return false;
    default:
      return false;
  }
});
