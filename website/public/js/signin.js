(async () => {
  const { api, $, show } = P;
  const params = new URLSearchParams(location.search);
  const ret = params.get("return_to");
  const returnTo = ret && ret.startsWith("/") && !ret.startsWith("//") ? ret : "/account";
  const msg = $("msg");
  const errors = { google_failed: "Google sign-in didn't work. Try again or use your email.", google_disabled: "Google sign-in isn't available. Use your email." };
  if (errors[params.get("error")]) show(msg, errors[params.get("error")]);

  const me = await api("/v1/me");
  if (me.ok) return location.replace(returnTo);
  const cfg = await api("/v1/config");
  if (cfg.ok && cfg.body.google_enabled) {
    $("google-box").hidden = false;
    $("google").href = `/auth/google/start?return_to=${encodeURIComponent(returnTo)}`;
  }

  let email = "";
  $("email-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    email = $("email").value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return show(msg, "Enter a valid email address.");
    $("send").disabled = true; show(msg, "");
    const r = await api("/v1/auth/email/start", { method: "POST", json: { email } });
    $("send").disabled = false;
    if (!r.ok) return show(msg, (r.error && r.error.message) || "Couldn't send the code. Try again.");
    $("sent-to").textContent = email;
    $("email-form").hidden = true; $("code-form").hidden = false; $("code").focus();
  });
  $("code").addEventListener("input", (e) => {
    e.target.value = e.target.value.replace(/\D/g, "").slice(0, 6);
    if (e.target.value.length === 6) $("code-form").requestSubmit();
  });
  $("code-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const code = $("code").value;
    if (!/^\d{6}$/.test(code)) return show(msg, "Enter the 6-digit code from the email.");
    $("verify").disabled = true; show(msg, "");
    const r = await api("/v1/auth/email/verify", { method: "POST", json: { email, code, client: "web" } });
    $("verify").disabled = false;
    if (!r.ok) return show(msg, (r.error && r.error.message) || "Sign-in failed. Try again.");
    location.replace(returnTo);
  });
  $("back").addEventListener("click", () => { $("code-form").hidden = true; $("email-form").hidden = false; $("code").value = ""; show(msg, ""); });
})();
