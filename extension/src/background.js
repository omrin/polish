importScripts("shared.js", "api.js");

const { analyze, DEFAULT_SETTINGS } = globalThis.WA_API;

chrome.runtime.onInstalled.addListener((details) => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: "wa-fix", title: "Fix grammar & spelling", contexts: ["editable"] });
    chrome.contextMenus.create({ id: "wa-rephrase", title: "Rephrase…", contexts: ["editable"] });
  });
  if (details.reason === "install") {
    chrome.storage.local.get("apiKey").then(({ apiKey }) => { if (!apiKey) chrome.runtime.openOptionsPage(); });
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
  const stored = await chrome.storage.local.get(Object.keys(DEFAULT_SETTINGS));
  return Object.assign({}, DEFAULT_SETTINGS, stored);
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === "WA_ANALYZE") {
    (async () => {
      try {
        const settings = await getSettings();
        const result = await analyze(msg.text, msg.mode, settings);
        sendResponse({ result });
      } catch (e) {
        console.warn("[Writing Assistant]", e);
        sendResponse({ error: { code: e.code || "error", message: e.message } });
      }
    })();
    return true; // async response
  }
  if (msg && msg.type === "WA_OPEN_OPTIONS") {
    chrome.runtime.openOptionsPage();
  }
  return false;
});
