// Approves a sign-in for the desktop app (?code=ABCD-EFGH) or the Chrome extension (?client=extension&...).
(async () => {
  const { api, $, show, toSignIn } = P;
  const q = new URLSearchParams(location.search);
  const msg = $("msg");
  const me = await api("/v1/me");
  if (me.status === 401) return toSignIn();
  $("loading").hidden = true;
  if (!me.ok) return show(msg, (me.error && me.error.message) || "Something went wrong.");
  $("who").textContent = me.body.user.email;
  $("switch").addEventListener("click", async (e) => {
    e.preventDefault();
    await api("/v1/auth/logout", { method: "POST", json: {} });
    toSignIn();
  });

  const finish = (text) => { $("ask").hidden = true; $("done").hidden = false; if (text) $("done-text").textContent = text; };

  if (q.get("client") === "extension") {
    $("ask-title").textContent = "Connect the Chrome extension";
    $("ask-text").textContent = "Polish for Chrome will check text with your account and use your credits.";
    $("ask").hidden = false;
    $("approve").addEventListener("click", async () => {
      $("approve").disabled = true;
      const r = await api("/v1/auth/code/approve", { method: "POST", json: {
        redirect_uri: q.get("redirect_uri") || "", code_challenge: q.get("code_challenge") || "", state: q.get("state") || "", device_name: "Chrome",
      } });
      if (!r.ok) { $("approve").disabled = false; return show(msg, (r.error && r.error.message) || "Couldn't connect the extension."); }
      location.replace(r.body.redirect);
    });
    $("deny").addEventListener("click", () => finish("Cancelled. You can close this window."));
    return;
  }

  const code = (q.get("code") || "").toUpperCase();
  const info = await api(`/v1/auth/device/info?user_code=${encodeURIComponent(code)}`);
  if (!info.ok) return show(msg, (info.error && info.error.message) || "This code isn't valid. Start sign-in again from the Polish app.");
  if (info.body.status !== "pending") return finish(info.body.status === "approved" ? "This device is already connected." : "This request was cancelled.");
  $("ask-title").textContent = "Connect the Polish app";
  $("ask-text").textContent = `Polish on ${info.body.device_name || "your computer"} will check text with your account and use your credits.`;
  $("code-box").textContent = info.body.user_code; $("code-box").hidden = false; $("code-hint").hidden = false;
  $("ask").hidden = false;
  $("approve").addEventListener("click", async () => {
    $("approve").disabled = true;
    const r = await api("/v1/auth/device/approve", { method: "POST", json: { user_code: info.body.user_code } });
    if (!r.ok) { $("approve").disabled = false; return show(msg, (r.error && r.error.message) || "Couldn't connect."); }
    finish("Go back to Polish. It will finish signing in by itself. You can close this tab.");
  });
  $("deny").addEventListener("click", async () => {
    await api("/v1/auth/device/approve", { method: "POST", json: { user_code: info.body.user_code, deny: true } });
    finish("Cancelled. Polish on that device was not connected.");
  });
})();
