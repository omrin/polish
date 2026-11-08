// Suggestion card rendered in a Shadow DOM so host-page CSS can't break it.
(function () {
  const CSS = `
    :host { all: initial; }
    .card { position: fixed; z-index: 2147483647; width: 400px; max-width: calc(100vw - 16px);
      max-height: min(560px, calc(100vh - 16px)); display: flex; flex-direction: column;
      background: #fff; color: #263238; border: 1px solid #cfd8dc; border-radius: 12px;
      box-shadow: 0 10px 32px rgba(0,0,0,.18); font: 14px/1.45 system-ui, -apple-system, "Segoe UI", Arial, sans-serif; }
    .hdr { display: flex; align-items: center; gap: 8px; padding: 10px 14px; border-bottom: 1px solid #eceff1; }
    .hdr .t { font-weight: 700; color: #11a683; flex: 1; }
    .hdr .m { color: #90a4ae; font-size: 12px; }
    .x { border: none; background: none; font-size: 18px; cursor: pointer; color: #78909c; padding: 0 4px; }
    .body { overflow: auto; padding: 10px 14px; }
    h4 { margin: 10px 0 6px; font-size: 12px; text-transform: uppercase; letter-spacing: .04em; color: #78909c; }
    .diff { background: #fafbfb; border-radius: 8px; padding: 8px 10px; white-space: pre-wrap; word-wrap: break-word; }
    del { color: #c62828; background: #fdecea; }
    ins { color: #1b5e20; background: #e3f6e5; text-decoration: none; }
    .fix { padding: 4px 0; border-bottom: 1px dashed #eceff1; }
    .fix:last-child { border-bottom: none; }
    .tag { font-size: 11px; font-weight: 700; text-transform: uppercase; margin-inline-end: 6px; }
    .tag.spelling { color: #c62828 } .tag.grammar { color: #1565c0 } .tag.punctuation { color: #6a1b9a } .tag.style { color: #ef6c00 }
    .why { color: #607d8b; font-size: 13px; }
    label.alt { display: block; border: 1px solid #e0e6e8; border-radius: 8px; padding: 8px 10px; margin: 6px 0; cursor: pointer; }
    label.alt:has(input:checked) { border-color: #15c39a; background: #effcf8; }
    label.alt b { display: block; font-size: 12px; color: #37474f; }
    .ftr { display: flex; gap: 8px; justify-content: flex-end; padding: 10px 14px; border-top: 1px solid #eceff1; }
    button.b { padding: 6px 14px; border-radius: 6px; border: 1px solid #b0bec5; background: #f5f7f8; cursor: pointer; font: inherit; }
    button.p { background: #15c39a; border-color: #15c39a; color: #fff; font-weight: 600; }
    button.b:disabled { opacity: .5; cursor: default; }
    .err { color: #b71c1c; }
    .ok { color: #2e7d32; font-weight: 600; }
    .spin { display: inline-block; width: 14px; height: 14px; border: 2px solid #b2dfdb; border-top-color: #15c39a;
      border-radius: 50%; animation: r .8s linear infinite; vertical-align: -2px; margin-inline-end: 8px; }
    @keyframes r { to { transform: rotate(360deg) } }
  `;

  const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  class WACard {
    constructor() {
      this.host = document.createElement("wa-card-host");
      this.host.setAttribute("data-wa", "card");
      this.root = this.host.attachShadow({ mode: "open" });
      this.root.innerHTML = `<style>${CSS}</style><div class="card" role="dialog" aria-label="Writing Assistant"></div>`;
      this.el = this.root.querySelector(".card");
      this.onApply = null;
      this._onKey = (e) => { if (e.key === "Escape") this.close(); };
      this._onDown = (e) => {
        const path = e.composedPath();
        if (!path.includes(this.host) && !path.some((n) => n && n.getAttribute && n.getAttribute("data-wa"))) this.close();
      };
    }

    isOpen() { return this.host.isConnected; }

    open(anchorRect) {
      if (!this.isOpen()) {
        (document.body || document.documentElement).appendChild(this.host);
        document.addEventListener("keydown", this._onKey, true);
        document.addEventListener("mousedown", this._onDown, true);
      }
      this.anchor = anchorRect;
      this.position();
    }

    position() {
      const r = this.anchor || { left: 20, bottom: 20, top: 20, right: 20 };
      const w = Math.min(400, window.innerWidth - 16);
      const h = this.el.offsetHeight || 200;
      let left = Math.min(Math.max(8, r.left), window.innerWidth - w - 8);
      let top = r.bottom + 8;
      if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 8);
      if (top + h > window.innerHeight - 8) top = Math.max(8, window.innerHeight - h - 8);
      this.el.style.left = left + "px";
      this.el.style.top = top + "px";
    }

    close() {
      if (!this.isOpen()) return;
      this.host.remove();
      document.removeEventListener("keydown", this._onKey, true);
      document.removeEventListener("mousedown", this._onDown, true);
    }

    _frame(title, meta, body, footer, dir) {
      this.el.setAttribute("dir", dir || "ltr");
      this.el.innerHTML = `
        <div class="hdr" dir="ltr"><span class="t">${esc(title)}</span><span class="m">${esc(meta || "")}</span>
          <button class="x" title="Close" aria-label="Close">×</button></div>
        <div class="body">${body}</div>${footer ? `<div class="ftr" dir="ltr">${footer}</div>` : ""}`;
      this.el.querySelector(".x").addEventListener("click", () => this.close());
      requestAnimationFrame(() => this.position());
    }

    showLoading(mode) {
      this._frame(mode === "rephrase" ? "Rephrase" : "Grammar & spelling", "",
        `<div><span class="spin"></span>Checking…</div>`);
    }

    showError(message, code) {
      const footer = code === "no_api_key"
        ? `<button class="b p" data-act="options">Open Options</button>` : `<button class="b" data-act="close">Close</button>`;
      this._frame("Writing Assistant", "", `<div class="err">${esc(message)}</div>`, footer);
      const opt = this.el.querySelector('[data-act="options"]');
      if (opt) opt.addEventListener("click", () => { chrome.runtime.sendMessage({ type: "WA_OPEN_OPTIONS" }); this.close(); });
      const cl = this.el.querySelector('[data-act="close"]');
      if (cl) cl.addEventListener("click", () => this.close());
    }

    showNotice(message) {
      this._frame("Writing Assistant", "", `<div>${esc(message)}</div>`, `<button class="b" data-act="close">Close</button>`);
      this.el.querySelector('[data-act="close"]').addEventListener("click", () => this.close());
    }

    showResult(result, original, mode) {
      const { wordDiff, detectDirection } = globalThis.WA_DIFF;
      const dir = detectDirection(original);
      const candidates = [result.corrected_text, ...result.rephrasings.map((r) => r.text)];
      const diff = wordDiff(original, result.corrected_text).map((o) =>
        o.op === "equal" ? esc(o.text) : o.op === "delete" ? `<del>${esc(o.text)}</del>` : `<ins>${esc(o.text)}</ins>`).join("");

      let body = "";
      if (!result.has_changes && !result.rephrasings.length) {
        body += `<div class="ok">✓ No issues found</div>`;
      } else {
        const diffBlock = `<div class="diff">${diff}</div>`;
        body += result.rephrasings.length
          ? `<label class="alt"><input type="radio" name="c" value="0" checked hidden><b>${result.has_changes ? "Corrected" : "Original (no issues found ✓)"}</b>${diffBlock}</label>`
          : `<h4>Corrected</h4>${diffBlock}`;
      }
      if (result.corrections.length) {
        body += `<h4>Fixes (${result.corrections.length})</h4>` + result.corrections.map((c) =>
          `<div class="fix"><span class="tag ${esc(c.type)}">${esc(c.type)}</span><del>${esc(c.original)}</del> → <ins>${esc(c.replacement)}</ins>
            <div class="why">${esc(c.explanation)}</div></div>`).join("");
      }
      if (result.rephrasings.length) {
        body += `<h4>Alternatives</h4>` + result.rephrasings.map((r, i) =>
          `<label class="alt"><input type="radio" name="c" value="${i + 1}" hidden><b>${esc(r.label)}</b>${esc(r.text)}</label>`).join("");
      }
      const canApply = result.has_changes || result.rephrasings.length > 0;
      const footer = `<button class="b" data-act="close">Close</button><button class="b" data-act="copy">Copy</button>
        <button class="b p" data-act="apply" ${canApply ? "" : "disabled"}>Apply</button>`;
      this._frame(mode === "rephrase" ? "Rephrase" : "Grammar & spelling", result.model || "", body, footer, dir);

      const selected = () => {
        const r = this.el.querySelector('input[name="c"]:checked');
        return candidates[r ? Number(r.value) : 0];
      };
      this.el.querySelector('[data-act="close"]').addEventListener("click", () => this.close());
      this.el.querySelector('[data-act="copy"]').addEventListener("click", async () => {
        try { await navigator.clipboard.writeText(selected()); } catch (e) { /* ignore */ }
        this.close();
      });
      this.el.querySelector('[data-act="apply"]').addEventListener("click", () => {
        const text = selected();
        this.close();
        if (this.onApply) this.onApply(text);
      });
    }
  }

  globalThis.WACard = WACard;
})();
