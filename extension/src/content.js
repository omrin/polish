// Content script: finds the editable field, shows the floating button, runs checks, applies results.
(function () {
  if (globalThis.__waLoaded) return;
  globalThis.__waLoaded = true;

  const TEXT_INPUT_TYPES = new Set(["", "text", "search", "email", "url"]);
  let lastEditable = null;
  let card = null;
  let busy = false;

  function editableRoot(node) {
    if (!node || node.nodeType !== 1) return null;
    if (node.tagName === "TEXTAREA") return node.disabled || node.readOnly ? null : node;
    if (node.tagName === "INPUT") {
      const t = (node.getAttribute("type") || "").toLowerCase();
      return TEXT_INPUT_TYPES.has(t) && !node.disabled && !node.readOnly ? node : null;
    }
    if (node.isContentEditable) {
      let el = node;
      while (el.parentElement && el.parentElement.isContentEditable) el = el.parentElement;
      return el;
    }
    return null;
  }

  function deepActiveElement() {
    let a = document.activeElement;
    while (a && a.shadowRoot && a.shadowRoot.activeElement) a = a.shadowRoot.activeElement;
    return a;
  }

  function isTextControl(el) { return el.tagName === "TEXTAREA" || el.tagName === "INPUT"; }

  // ---------- floating button ----------
  const btnHost = document.createElement("wa-button-host");
  btnHost.setAttribute("data-wa", "button");
  const btnRoot = btnHost.attachShadow({ mode: "open" });
  btnRoot.innerHTML = `<style>
      :host { all: initial; }
      .w { position: fixed; z-index: 2147483646; display: flex; gap: 2px; align-items: center;
        background: #fff; border-radius: 14px; box-shadow: 0 1px 4px rgba(0,0,0,.25); padding: 2px; }
      button { all: unset; cursor: pointer; width: 22px; height: 22px; border-radius: 50%; display: grid; place-items: center;
        font: 700 12px/1 system-ui, Arial, sans-serif; color: #fff; background: linear-gradient(135deg, #5ee7c8 0%, #3b8beb 50%, #6a4ce0 100%); }
      button.f img { width: 22px; height: 22px; border-radius: 50%; }
      button.r { background: #fff; color: #3b8beb; font-size: 13px; }
      button:hover { filter: brightness(.92); }
    </style>
    <div class="w"><button class="f" title="Fix grammar & spelling (Alt+Shift+G)" aria-label="Fix grammar and spelling"><img src="${chrome.runtime.getURL("icons/icon48.png")}" alt=""></button><button class="r" title="Rephrase (Alt+Shift+R)" aria-label="Rephrase">✎</button></div>`;
  const btnWrap = btnRoot.querySelector(".w");
  btnRoot.querySelector(".f").addEventListener("click", () => run("fix"));
  btnRoot.querySelector(".r").addEventListener("click", () => run("rephrase"));
  // Keep focus & selection in the field when the button is pressed.
  btnWrap.addEventListener("mousedown", (e) => e.preventDefault());

  function placeButton() {
    if (!lastEditable || !lastEditable.isConnected) return hideButton();
    const r = lastEditable.getBoundingClientRect();
    if (r.width < 60 || r.height < 16 || r.bottom < 0 || r.top > window.innerHeight) return hideButton();
    if (!btnHost.isConnected) (document.body || document.documentElement).appendChild(btnHost);
    const w = 50, h = 26;
    const top = Math.min(r.bottom - h - 4, window.innerHeight - h - 4);
    btnWrap.style.top = Math.max(r.top + 2, top) + "px";
    btnWrap.style.left = Math.max(0, r.right - w - 6) + "px";
  }
  function hideButton() { btnHost.remove(); }

  document.addEventListener("focusin", (e) => {
    const target = e.composedPath ? e.composedPath()[0] : e.target;
    const el = editableRoot(target);
    if (el) { lastEditable = el; placeButton(); }
  }, true);
  document.addEventListener("focusout", () => {
    setTimeout(() => {
      const a = deepActiveElement();
      if (!editableRoot(a) && !(card && card.isOpen())) hideButton();
    }, 200);
  }, true);
  window.addEventListener("scroll", () => btnHost.isConnected && placeButton(), true);
  window.addEventListener("resize", () => btnHost.isConnected && placeButton());
  document.addEventListener("input", () => btnHost.isConnected && placeButton(), true);

  // ---------- reading the text ----------
  function getTarget() {
    const active = editableRoot(deepActiveElement());
    const el = active || lastEditable;
    if (!el || !el.isConnected) return null;
    if (isTextControl(el)) {
      const v = el.value || "";
      let start = el.selectionStart ?? 0, end = el.selectionEnd ?? 0;
      if (start === end) { start = 0; end = v.length; }
      return { kind: "control", el, start, end, text: v.slice(start, end), fullValue: v };
    }
    const sel = window.getSelection();
    let range;
    if (sel && sel.rangeCount && !sel.isCollapsed && el.contains(sel.getRangeAt(0).commonAncestorContainer)) {
      range = sel.getRangeAt(0).cloneRange();
      return { kind: "rich", el, range, text: sel.toString() };
    }
    range = document.createRange();
    range.selectNodeContents(el);
    return { kind: "rich", el, range, text: el.innerText };
  }

  // ---------- applying ----------
  function setNativeValue(el, value) {
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
  }

  async function applyText(target, newText) {
    const el = target.el;
    if (!el.isConnected) return fallbackCopy(newText);
    if (target.kind === "control") {
      let { start, end } = target;
      const v = el.value;
      if (v.slice(start, end) !== target.text) {           // the field changed meanwhile
        const idx = v.indexOf(target.text);
        if (idx < 0) return fallbackCopy(newText);
        start = idx; end = idx + target.text.length;
      }
      el.focus();
      el.setSelectionRange(start, end);
      // execCommand keeps the native undo stack (Ctrl+Z) and works with React/Vue-controlled inputs.
      let ok = false;
      try { ok = document.execCommand("insertText", false, newText); } catch (e) { ok = false; }
      if (!ok || el.value.slice(start, start + newText.length) !== newText) {
        setNativeValue(el, v.slice(0, start) + newText + v.slice(end));
        el.setSelectionRange(start, start + newText.length);
        el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertReplacementText", data: newText }));
      }
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return;
    }
    el.focus();
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(target.range);
    let ok = false;
    try { ok = document.execCommand("insertText", false, newText); } catch (e) { ok = false; }
    if (!ok) {
      target.range.deleteContents();
      target.range.insertNode(document.createTextNode(newText));
      el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertReplacementText", data: newText }));
    }
  }

  async function fallbackCopy(text) {
    try { await navigator.clipboard.writeText(text); } catch (e) { /* ignore */ }
    ensureCard().open(null);
    card.showNotice("Couldn't insert the text (the field changed) — it was copied to your clipboard instead.");
  }

  function ensureCard() {
    if (!card) card = new globalThis.WACard();
    return card;
  }

  // ---------- main flow ----------
  async function run(mode) {
    if (busy) return;
    const c = ensureCard();
    if (location.hostname === "docs.google.com") {
      c.open(null);
      return c.showError("Google Docs isn't supported (it doesn't use normal text fields). Copy the text into another field, or use the desktop app.");
    }
    const target = getTarget();
    const anchor = target ? target.el.getBoundingClientRect() : null;
    c.open(anchor);
    if (!target || !target.text || !target.text.trim()) return c.showError("No text in this field.");
    c.showLoading(mode);
    busy = true;
    let resp;
    try {
      resp = await chrome.runtime.sendMessage({ type: "WA_ANALYZE", text: target.text, mode });
    } catch (e) {
      resp = { error: { code: "extension", message: "The extension was updated — reload this page and try again." } };
    } finally {
      busy = false;
    }
    if (!c.isOpen()) return; // user closed it while waiting
    if (!resp || resp.error) {
      const err = (resp && resp.error) || { message: "Something went wrong." };
      c.onRetry = () => run(mode);
      return c.showError(err.message, err.code, err);
    }
    c.onRetry = null;
    c.onApply = (text) => applyText(target, text);
    c.showResult(resp.result, target.text, mode);
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (!msg || msg.type !== "WA_RUN") return;
    // Commands are broadcast to every frame; only the focused frame with an editable field acts.
    if (!document.hasFocus() && !editableRoot(deepActiveElement())) return;
    if (!editableRoot(deepActiveElement()) && !lastEditable) return;
    run(msg.mode);
  });

  globalThis.__waTest = { run, getTarget };
})();
