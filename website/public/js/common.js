// Small helpers shared by the app pages. Talks to the Polish API on the same origin (cookie session).
window.P = (() => {
  async function api(path, opts = {}) {
    const init = { method: opts.method || "GET", credentials: "same-origin", headers: { "x-requested-with": "polish" } };
    if (opts.json !== undefined) { init.headers["content-type"] = "application/json"; init.body = JSON.stringify(opts.json); }
    let r;
    try { r = await fetch(path, init); } catch (e) { return { ok: false, status: 0, error: { code: "network", message: "Can't reach Polish. Check your connection." } }; }
    let body = null;
    try { body = await r.json(); } catch (e) { /* empty */ }
    return { ok: r.ok, status: r.status, body, error: body && body.error };
  }
  const $ = (id) => document.getElementById(id);
  function show(el, text, kind) { el.textContent = text; el.className = `msg ${kind || "err"}`; el.hidden = !text; }
  const money = (credits) => `$${(Math.max(0, credits) / 100).toFixed(2)}`;
  const here = () => location.pathname + location.search;
  const toSignIn = () => location.replace(`/signin?return_to=${encodeURIComponent(here())}`);
  const date = (sec) => new Date(sec * 1000).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  return { api, $, show, money, toSignIn, date };
})();
