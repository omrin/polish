import { afterEach, describe, expect, it } from "vitest";
import { b64url, pkceChallenge, randomToken } from "../src/lib/crypto";
import { _resetJwksCache } from "../src/lib/google_oidc";
import { nowSec } from "../src/lib/ids";
import { verifyAccess } from "../src/lib/jwt";
import { STARTER_CREDITS } from "../src/lib/pricing";
import { balanceOf, call, env, makeUser, stubFetch, webCookie } from "./helpers";

let stub: ReturnType<typeof stubFetch> | null = null;
afterEach(() => { stub?.restore(); stub = null; });

function resendStub() {
  const sent: any[] = [];
  stub = stubFetch({ "api.resend.com/emails": (_u, init) => { sent.push(JSON.parse(String(init.body))); return new Response("{}"); } });
  return sent;
}
const codeFrom = (mail: any) => /(\d{6})/.exec(mail.subject)![1];

describe("email code sign-in", () => {
  it("sends a code and signs in a desktop client with starter credits", async () => {
    const sent = resendStub();
    const email = `new-${randomToken(4).toLowerCase()}@example.com`;
    expect((await call("/v1/auth/email/start", { method: "POST", json: { email } })).status).toBe(200);
    expect(sent[0].to).toEqual([email]);
    const r = await call("/v1/auth/email/verify", { method: "POST", json: { email, code: codeFrom(sent[0]), client: "desktop", device_name: "PC" } });
    expect(r.status).toBe(200);
    const j: any = await r.json();
    expect(j.refresh_token).toBeTruthy();
    expect(await verifyAccess(env.SESSION_SECRET, j.access_token)).toBeTruthy();
    expect(j.balance_credits).toBe(STARTER_CREDITS);
    expect(j.approx_checks_left).toBe(18);
  });

  it("web sign-in sets an HttpOnly cookie", async () => {
    const sent = resendStub();
    const email = `web-${randomToken(4).toLowerCase()}@example.com`;
    await call("/v1/auth/email/start", { method: "POST", json: { email } });
    const r = await call("/v1/auth/email/verify", { method: "POST", json: { email, code: codeFrom(sent[0]) } });
    expect(r.headers.get("set-cookie")).toMatch(/^ps=.+HttpOnly; Secure; SameSite=Lax/);
  });

  it("rejects wrong codes and locks after 5 attempts", async () => {
    const sent = resendStub();
    const email = `lock-${randomToken(4).toLowerCase()}@example.com`;
    await call("/v1/auth/email/start", { method: "POST", json: { email } });
    const good = codeFrom(sent[0]);
    const wrong = good === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i++) {
      expect((await call("/v1/auth/email/verify", { method: "POST", json: { email, code: wrong } })).status).toBe(401);
    }
    const r = await call("/v1/auth/email/verify", { method: "POST", json: { email, code: good } });
    expect(r.status).toBe(401);
  });

  it("codes expire and are single-use", async () => {
    const sent = resendStub();
    const email = `exp-${randomToken(4).toLowerCase()}@example.com`;
    await call("/v1/auth/email/start", { method: "POST", json: { email } });
    const code = codeFrom(sent[0]);
    expect((await call("/v1/auth/email/verify", { method: "POST", json: { email, code, client: "desktop" } })).status).toBe(200);
    expect((await call("/v1/auth/email/verify", { method: "POST", json: { email, code, client: "desktop" } })).status).toBe(401);
    await env.DB.prepare("UPDATE rate_limits SET count = 0").run();
    await env.DB.prepare("DELETE FROM rate_limits").run();
    await call("/v1/auth/email/start", { method: "POST", json: { email } });
    await env.DB.prepare("UPDATE login_codes SET expires_at = 1 WHERE consumed_at IS NULL").run();
    expect((await call("/v1/auth/email/verify", { method: "POST", json: { email, code: codeFrom(sent[1]) } })).status).toBe(401);
  });

  it("rate-limits code requests per address", async () => {
    resendStub();
    const email = `rl-${randomToken(4).toLowerCase()}@example.com`;
    expect((await call("/v1/auth/email/start", { method: "POST", json: { email } })).status).toBe(200);
    expect((await call("/v1/auth/email/start", { method: "POST", json: { email } })).status).toBe(429);
  });

  it("rejects invalid email", async () => {
    expect((await call("/v1/auth/email/start", { method: "POST", json: { email: "nope" } })).status).toBe(400);
  });
});

describe("sessions", () => {
  it("refresh returns a new access token; logout revokes", async () => {
    const sent = resendStub();
    const email = `ref-${randomToken(4).toLowerCase()}@example.com`;
    await call("/v1/auth/email/start", { method: "POST", json: { email } });
    const j: any = await (await call("/v1/auth/email/verify", { method: "POST", json: { email, code: codeFrom(sent[0]), client: "extension" } })).json();
    const r = await call("/v1/auth/refresh", { method: "POST", json: { refresh_token: j.refresh_token } });
    expect(r.status).toBe(200);
    expect(((await r.json()) as any).access_token).toBeTruthy();
    await call("/v1/auth/logout", { method: "POST", json: { refresh_token: j.refresh_token } });
    expect((await call("/v1/auth/refresh", { method: "POST", json: { refresh_token: j.refresh_token } })).status).toBe(401);
  });

  it("web cookies can't be used as refresh tokens; /me works with the cookie", async () => {
    const u = await makeUser();
    const cookie = await webCookie(u.id);
    expect((await call("/v1/auth/refresh", { method: "POST", json: { refresh_token: cookie } })).status).toBe(401);
    const me = await call("/v1/me", { cookie });
    expect(me.status).toBe(200);
    expect(((await me.json()) as any).user.email).toBe(u.email);
  });

  it("rejects tampered and alg=none tokens", async () => {
    expect((await call("/v1/me", { token: "eyJhbGciOiJub25lIn0.eyJzdWIiOiJ4In0." })).status).toBe(401);
    expect((await call("/v1/me", { token: "a.b.c" })).status).toBe(401);
  });

  it("cookie POSTs need the X-Requested-With header", async () => {
    const u = await makeUser();
    const cookie = await webCookie(u.id);
    const r = await call("/v1/auth/device/approve", { method: "POST", headers: { cookie: `ps=${cookie}`, "content-type": "application/json" }, body: JSON.stringify({ user_code: "BBBB-CCCC" }) });
    expect(r.status).toBe(403);
  });
});

describe("desktop device sign-in", () => {
  it("start -> pending -> approve -> tokens, single use", async () => {
    const s: any = await (await call("/v1/auth/device/start", { method: "POST", json: { client: "desktop", device_name: "Ward PC" } })).json();
    expect(s.user_code).toMatch(/^[B-Z2-9]{4}-[B-Z2-9]{4}$/);
    expect(s.verification_url).toBe(`https://polish.test/connect?code=${s.user_code}`);
    expect((await call("/v1/auth/device/token", { method: "POST", json: { device_code: s.device_code } })).status).toBe(428);
    const u = await makeUser();
    const cookie = await webCookie(u.id);
    const info: any = await (await call(`/v1/auth/device/info?user_code=${s.user_code.toLowerCase()}`, { cookie })).json();
    expect(info).toMatchObject({ device_name: "Ward PC", status: "pending" });
    expect((await call("/v1/auth/device/approve", { method: "POST", cookie, json: { user_code: s.user_code } })).status).toBe(200);
    await env.DB.prepare("UPDATE device_codes SET last_poll_at = last_poll_at - 10").run();
    const t = await call("/v1/auth/device/token", { method: "POST", json: { device_code: s.device_code } });
    expect(t.status).toBe(200);
    const j: any = await t.json();
    expect(j.user.id).toBe(u.id);
    await env.DB.prepare("UPDATE device_codes SET last_poll_at = last_poll_at - 10").run();
    expect((await call("/v1/auth/device/token", { method: "POST", json: { device_code: s.device_code } })).status).toBe(410);
  });

  it("slows down fast polling and expires", async () => {
    const s: any = await (await call("/v1/auth/device/start", { method: "POST", json: {} })).json();
    await call("/v1/auth/device/token", { method: "POST", json: { device_code: s.device_code } });
    expect((await call("/v1/auth/device/token", { method: "POST", json: { device_code: s.device_code } })).status).toBe(429);
    await env.DB.prepare("UPDATE device_codes SET expires_at = 1").run();
    await env.DB.prepare("UPDATE device_codes SET last_poll_at = NULL").run();
    expect((await call("/v1/auth/device/token", { method: "POST", json: { device_code: s.device_code } })).status).toBe(410);
  });

  it("deny is reported to the app", async () => {
    const s: any = await (await call("/v1/auth/device/start", { method: "POST", json: {} })).json();
    const cookie = await webCookie((await makeUser()).id);
    await call("/v1/auth/device/approve", { method: "POST", cookie, json: { user_code: s.user_code, deny: true } });
    expect((await call("/v1/auth/device/token", { method: "POST", json: { device_code: s.device_code } })).status).toBe(403);
  });
});

describe("extension code flow (PKCE)", () => {
  const redirect = "https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/cb";
  it("approve -> exchange with verifier", async () => {
    const u = await makeUser();
    const cookie = await webCookie(u.id);
    const verifier = randomToken(48);
    const r: any = await (await call("/v1/auth/code/approve", { method: "POST", cookie, json: { redirect_uri: redirect, code_challenge: await pkceChallenge(verifier), state: "st" } })).json();
    const url = new URL(r.redirect);
    expect(url.searchParams.get("state")).toBe("st");
    const code = url.searchParams.get("code")!;
    expect((await call("/v1/auth/code/exchange", { method: "POST", json: { code, code_verifier: randomToken(48), redirect_uri: redirect } })).status).toBe(400);
    const ok = await call("/v1/auth/code/exchange", { method: "POST", json: { code, code_verifier: verifier, redirect_uri: redirect } });
    expect(ok.status).toBe(200);
    expect((await call("/v1/auth/code/exchange", { method: "POST", json: { code, code_verifier: verifier, redirect_uri: redirect } })).status).toBe(400);
  });
  it("rejects extensions that aren't allow-listed", async () => {
    const cookie = await webCookie((await makeUser()).id);
    const r = await call("/v1/auth/code/approve", { method: "POST", cookie, json: {
      redirect_uri: "https://ppppppppppppppppppppppppppppppppp.chromiumapp.org/cb".replace(/p{33}/, "p".repeat(32)),
      code_challenge: await pkceChallenge(randomToken(48)), state: "s" } });
    expect(r.status).toBe(403);
  });
});

describe("Google sign-in", () => {
  async function keypair() {
    const kp = (await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
    const jwk: any = await crypto.subtle.exportKey("jwk", kp.publicKey);
    jwk.kid = "k1"; jwk.alg = "RS256"; jwk.use = "sig";
    return { kp, jwk };
  }
  async function idToken(kp: CryptoKeyPair, claims: Record<string, unknown>) {
    const enc = new TextEncoder();
    const h = b64url(enc.encode(JSON.stringify({ alg: "RS256", kid: "k1" })));
    const p = b64url(enc.encode(JSON.stringify({ iss: "https://accounts.google.com", aud: "test-google-client", exp: nowSec() + 600, email_verified: true, ...claims })));
    const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", kp.privateKey, enc.encode(`${h}.${p}`));
    return `${h}.${p}.${b64url(sig)}`;
  }
  async function flow(claims: Record<string, unknown>) {
    _resetJwksCache();
    const { kp, jwk } = await keypair();
    const tok = await idToken(kp, claims);
    stub = stubFetch({
      "oauth2.googleapis.com/token": () => new Response(JSON.stringify({ id_token: tok })),
      "googleapis.com/oauth2/v3/certs": () => new Response(JSON.stringify({ keys: [jwk] })),
    });
    const start = await call("/auth/google/start?return_to=/connect?code=AAAA-BBBB");
    expect(start.status).toBe(302);
    const loc = new URL(start.headers.get("location")!);
    expect(loc.searchParams.get("code_challenge_method")).toBe("S256");
    expect(loc.searchParams.get("redirect_uri")).toBe("https://polish.test/auth/google/callback");
    return call(`/auth/google/callback?code=abc&state=${loc.searchParams.get("state")}`);
  }

  it("signs in, sets a cookie and returns to the requested page", async () => {
    const r = await flow({ sub: "g-1", email: "gina@example.com" });
    expect(r.status).toBe(302);
    expect(r.headers.get("location")).toBe("/connect?code=AAAA-BBBB");
    expect(r.headers.get("set-cookie")).toMatch(/^ps=/);
  });

  it("links to an existing email account", async () => {
    const u = await makeUser({ email: "linker@example.com" });
    await flow({ sub: "g-2", email: "Linker@example.com" });
    const row = await env.DB.prepare("SELECT google_sub FROM users WHERE id = ?").bind(u.id).first<any>();
    expect(row.google_sub).toBe("g-2");
    expect(await balanceOf(u.id)).toBe(STARTER_CREDITS);
  });

  it.each([
    [{ sub: "g-3", email: "a@example.com", aud: "someone-else" }],
    [{ sub: "g-4", email: "b@example.com", exp: nowSec() - 10 }],
    [{ sub: "g-5", email: "c@example.com", email_verified: false }],
  ])("rejects bad id tokens %#", async (claims) => {
    const r = await flow(claims);
    expect(r.headers.get("location")).toBe("/signin?error=google_failed");
    expect(r.headers.get("set-cookie")).toBeNull();
  });

  it("refuses open redirects", async () => {
    const r = await call("/auth/google/start?return_to=//evil.com");
    const state = new URL(r.headers.get("location")!).searchParams.get("state");
    const row: any = await env.DB.prepare("SELECT return_to FROM oauth_states WHERE state = ?").bind(state).first();
    expect(row.return_to).toBe("/account");
  });
});
