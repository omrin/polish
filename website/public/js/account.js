(async () => {
  const { api, $, show, money, toSignIn, date } = P;
  const msg = $("msg");
  let me = await api("/v1/me");
  if (me.status === 401) return toSignIn();
  if (!me.ok) { $("loading").textContent = (me.error && me.error.message) || "Couldn't load your account."; return; }
  $("loading").hidden = true;
  $("page").hidden = false;

  function renderBalance() {
    $("email").textContent = me.body.user.email;
    $("balance").textContent = money(me.body.balance_credits);
    $("checks").textContent = `${me.body.balance_credits.toLocaleString()} credits · about ${me.body.approx_checks_left.toLocaleString()} checks left`;
  }
  renderBalance();

  // Packs and Paddle checkout
  const cfg = (await api("/v1/config")).body || {};
  const canBuy = !!(cfg.paddle_client_token && window.Paddle);
  if (canBuy) {
    if (cfg.paddle_env === "sandbox") Paddle.Environment.set("sandbox");
    Paddle.Initialize({ token: cfg.paddle_client_token });
  }
  $("paddle-off").hidden = canBuy;
  $("packs").innerHTML = "";
  for (const p of me.body.packs) {
    const el = document.createElement("div");
    el.className = "pack";
    el.innerHTML = `<div class="usd"></div><div class="cr"></div><button class="btn primary">Buy</button>`;
    el.querySelector(".usd").textContent = `$${p.usd}`;
    el.querySelector(".cr").textContent = p.label;
    const b = el.querySelector("button");
    b.disabled = !canBuy || !p.price_id;
    b.addEventListener("click", () => Paddle.Checkout.open({
      items: [{ priceId: p.price_id, quantity: 1 }],
      customer: { email: me.body.user.email },
      customData: { user_id: me.body.user.id },
      settings: { successUrl: `${location.origin}/account?purchased=1` },
    }));
    $("packs").appendChild(el);
  }

  // After checkout, wait for the payment webhook to add the credits.
  if (new URLSearchParams(location.search).get("purchased")) {
    const before = me.body.balance_credits;
    show(msg, "Payment received. Adding your credits…", "ok");
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const now = await api("/v1/me");
      if (now.ok && now.body.balance_credits > before) { me = now; renderBalance(); show(msg, "Credits added ✓", "ok"); break; }
      if (i === 29) show(msg, "Your payment went through, but the credits haven't arrived yet. Refresh in a minute.", "err");
    }
    history.replaceState(null, "", "/account");
  }

  // History
  const led = await api("/v1/ledger");
  const names = { purchase: "Purchase", reversal: "Refund", admin_grant: "Adjustment", starter: "Welcome credits" };
  const rows = (led.body && led.body.purchases) || [];
  $("purchases").innerHTML = rows.length ? "" : `<tr><td colspan="3" class="muted">No purchases yet.</td></tr>`;
  for (const p of rows) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td></td><td></td><td class="num"></td>`;
    tr.children[0].textContent = date(p.created_at);
    tr.children[1].textContent = names[p.kind] || p.kind;
    tr.children[2].textContent = (p.credits > 0 ? "+" : "") + p.credits.toLocaleString();
    $("purchases").appendChild(tr);
  }
  const usage = (led.body && led.body.usage) || [];
  $("usage").innerHTML = usage.length ? "" : `<tr><td colspan="3" class="muted">No checks yet.</td></tr>`;
  for (const u of usage) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td></td><td class="num"></td><td class="num"></td>`;
    tr.children[0].textContent = u.day;
    tr.children[1].textContent = u.checks;
    tr.children[2].textContent = u.credits ?? 0;
    $("usage").appendChild(tr);
  }

  // Devices
  async function loadDevices() {
    const s = await api("/v1/auth/sessions");
    const kinds = { web: "Browser", desktop: "Desktop app", extension: "Chrome extension" };
    $("devices").innerHTML = "";
    for (const d of (s.body && s.body.sessions) || []) {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td></td><td class="muted"></td><td class="num"></td>`;
      tr.children[0].textContent = `${kinds[d.kind] || d.kind}${d.device_name ? ` · ${d.device_name}` : ""}${d.current ? " (this browser)" : ""}`;
      tr.children[1].textContent = `last used ${date(d.last_used_at || d.created_at)}`;
      if (!d.current) {
        const b = document.createElement("button");
        b.className = "btn";
        b.textContent = "Sign out";
        b.addEventListener("click", async () => { await api(`/v1/auth/sessions/${d.id}`, { method: "DELETE" }); loadDevices(); });
        tr.children[2].appendChild(b);
      }
      $("devices").appendChild(tr);
    }
  }
  loadDevices();

  $("signout").addEventListener("click", async () => { await api("/v1/auth/logout", { method: "POST", json: {} }); location.href = "/"; });
  $("delete").addEventListener("click", () => { $("confirm-delete").hidden = false; $("confirm-delete").scrollIntoView({ behavior: "smooth" }); });
  $("delete-no").addEventListener("click", () => { $("confirm-delete").hidden = true; });
  $("delete-yes").addEventListener("click", async () => {
    const r = await api("/v1/account/delete", { method: "POST" });
    if (r.ok) location.href = "/";
    else show(msg, (r.error && r.error.message) || "Couldn't delete the account.");
  });
})();
