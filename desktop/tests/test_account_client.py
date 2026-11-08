import json

import httpx2 as httpx
import pytest

from fakes import FakeTokenStore
from test_claude_client import ORIG, fake_client
from wa_core import claude_client
from wa_core.account_client import AccountClient, balance_text, checks_left_text
from wa_core.config import Config
from wa_core.errors import (AccountDisabled, ApiRateLimit, ApiRefused, BadResponse, EmptySelection,
                            InvalidCode, NoCredits, ServerUnreachable, ServicePaused, SignedOut,
                            SignInDenied, SignInExpired, TextTooLong, UpstreamError)

BASE = "https://polish.test"
USER = {"id": "u1", "email": "a@b.co", "created_at": 1}


def bundle(access="acc1", refresh="ref1"):
    b = {"access_token": access, "expires_in": 3600, "user": USER, "balance_credits": 460, "approx_checks_left": 115}
    if refresh:
        b["refresh_token"] = refresh
    return b


def error(status, code, message="nope", headers=None, **extra):
    return httpx.Response(status, json={"error": {"code": code, "message": message, **extra}}, headers=headers)


class Server:
    """Routes requests to handlers keyed by (method, path) and records them."""

    def __init__(self, routes):
        self.routes = routes
        self.calls = []

    def __call__(self, request: httpx.Request):
        body = json.loads(request.content) if request.content else None
        self.calls.append((request.method, request.url.path, body, request.headers.get("authorization")))
        h = self.routes[(request.method, request.url.path)]
        if isinstance(h, list):
            h = h.pop(0)
        return h(request, body) if callable(h) else h

    def paths(self):
        return [p for _, p, _, _ in self.calls]


def make(routes, token="ref1"):
    srv = Server(routes)
    store = FakeTokenStore(token)
    client = AccountClient(BASE + "/", store, http=httpx.Client(transport=httpx.MockTransport(srv)))
    return client, srv, store


def analyze_ok(fixture_json, name="response_en.json"):
    return httpx.Response(200, json={"result": fixture_json(name), "model": "claude-opus-5-5", "usage": {
        "input_tokens": 900, "output_tokens": 120, "credits_charged": 4,
        "balance_credits": 456, "approx_checks_left": 114}})


REFRESH = ("POST", "/v1/auth/refresh")
ANALYZE = ("POST", "/v1/analyze")


# ---- analyze ---------------------------------------------------------------

def test_analyze_matches_own_key_path(fixture_json, fixture_text):
    client, srv, _ = make({REFRESH: httpx.Response(200, json=bundle(refresh=None)),
                           ANALYZE: analyze_ok(fixture_json)})
    got = client.analyze(ORIG, "fix", Config())
    own = claude_client.analyze(ORIG, "fix", Config(api_key="k"), client=fake_client(fixture_text("response_en.json")))
    assert got == own and got.has_changes and len(got.corrections) == 3
    assert client.last_usage == {"balance_credits": 456, "approx_checks_left": 114}
    method, path, body, auth = srv.calls[-1]
    assert auth == "Bearer acc1"
    assert body == {"text": ORIG, "mode": "fix", "fast": False, "labels": ["Formal", "Concise", "Friendly"],
                    "explanation_language": "auto"}


def test_analyze_request_body_rephrase_fast(fixture_json):
    client, srv, _ = make({REFRESH: httpx.Response(200, json=bundle(refresh=None)),
                           ANALYZE: analyze_ok(fixture_json, "response_rephrase.json")})
    cfg = Config(use_fast_model=True, labels=["A", "B"], explanation_language="he")
    r = client.analyze(ORIG, "rephrase", cfg)
    assert [x.label for x in r.rephrasings] == ["Formal", "Concise", "Friendly"]
    assert srv.calls[-1][2] == {"text": ORIG, "mode": "rephrase", "fast": True, "labels": ["A", "B"],
                                "explanation_language": "he"}


def test_access_token_cached(fixture_json):
    client, srv, _ = make({REFRESH: httpx.Response(200, json=bundle(refresh=None)),
                           ANALYZE: lambda req, body: analyze_ok(fixture_json)})
    client.analyze(ORIG, "fix", Config())
    client.analyze(ORIG, "fix", Config())
    assert srv.paths().count("/v1/auth/refresh") == 1


def test_access_token_refreshed_before_expiry(fixture_json):
    client, srv, _ = make({REFRESH: lambda req, body: httpx.Response(200, json={**bundle(refresh=None), "expires_in": 30}),
                           ANALYZE: lambda req, body: analyze_ok(fixture_json)})
    client.analyze(ORIG, "fix", Config())
    client.analyze(ORIG, "fix", Config())
    assert srv.paths().count("/v1/auth/refresh") == 2  # 30 s left is inside the 60 s margin


def test_401_refreshes_and_retries_once(fixture_json):
    client, srv, _ = make({
        REFRESH: [httpx.Response(200, json=bundle("old", refresh=None)), httpx.Response(200, json=bundle("new", refresh=None))],
        ANALYZE: [error(401, "unauthorized"), analyze_ok(fixture_json)],
    })
    r = client.analyze(ORIG, "fix", Config())
    assert r.has_changes
    auths = [a for m, p, b, a in srv.calls if p == "/v1/analyze"]
    assert auths == ["Bearer old", "Bearer new"]


def test_second_401_is_signed_out():
    client, srv, store = make({
        REFRESH: lambda req, body: httpx.Response(200, json=bundle(refresh=None)),
        ANALYZE: lambda req, body: error(401, "unauthorized"),
    })
    with pytest.raises(SignedOut):
        client.analyze(ORIG, "fix", Config())
    assert srv.paths().count("/v1/analyze") == 2


def test_refresh_401_is_signed_out_and_forgets_token():
    client, srv, store = make({REFRESH: error(401, "unauthorized", "Your sign-in has expired.")})
    with pytest.raises(SignedOut) as e:
        client.analyze(ORIG, "fix", Config())
    assert str(e.value) == "Sign in to Polish to continue."
    assert store.token is None and "/v1/analyze" not in srv.paths()


def test_no_token_is_signed_out_without_network():
    client, srv, _ = make({}, token=None)
    with pytest.raises(SignedOut):
        client.analyze(ORIG, "fix", Config())
    assert srv.calls == [] and not client.signed_in


def test_empty_and_too_long_not_sent():
    client, srv, _ = make({})
    with pytest.raises(EmptySelection):
        client.analyze("  ", "fix", Config())
    with pytest.raises(TextTooLong):
        client.analyze("x" * 8001, "fix", Config(max_chars=20000))  # the service's limit still applies
    assert srv.calls == []


def test_402_no_credits():
    client, _, _ = make({REFRESH: httpx.Response(200, json=bundle(refresh=None)),
                         ANALYZE: error(402, "insufficient_credits", "You're out of credits.", balance=3, needed=10,
                                        buy_url="https://polish.test/account#buy")})
    with pytest.raises(NoCredits) as e:
        client.analyze(ORIG, "fix", Config())
    assert e.value.buy_url == "https://polish.test/account#buy" and e.value.balance == 3
    assert str(e.value) == "You're out of credits."


@pytest.mark.parametrize("resp,exc", [
    (error(413, "text_too_long", "Text is 9,000 characters; the limit is 8,000."), TextTooLong),
    (error(429, "rate_limited", "Polish is busy right now.", headers={"Retry-After": "5"}, retry_after=5), ApiRateLimit),
    (error(422, "refusal", "Claude declined to process this text."), ApiRefused),
    (error(422, "too_long", "The response was cut off."), TextTooLong),
    (error(502, "upstream_error", "The AI service didn't respond. Try again."), UpstreamError),
    (error(502, "bad_response", "Unexpected response. Try again."), BadResponse),
    (error(503, "service_paused", "Polish is paused for maintenance."), ServicePaused),
    (error(403, "account_disabled", "This account is disabled."), AccountDisabled),
    (httpx.Response(502, text="<html>Bad gateway</html>"), ServerUnreachable),
    (httpx.Response(200, json={"model": "x"}), BadResponse),
    (httpx.Response(200, text="not json"), BadResponse),
])
def test_error_mapping(resp, exc):
    client, _, _ = make({REFRESH: httpx.Response(200, json=bundle(refresh=None)), ANALYZE: resp})
    with pytest.raises(exc):
        client.analyze(ORIG, "fix", Config())


def test_server_message_is_shown():
    client, _, _ = make({REFRESH: httpx.Response(200, json=bundle(refresh=None)),
                         ANALYZE: error(413, "text_too_long", "Text is 9,000 characters; the limit is 8,000.")})
    with pytest.raises(TextTooLong, match="limit is 8,000"):
        client.analyze(ORIG, "fix", Config())


@pytest.mark.parametrize("exc", [httpx.ConnectError("down"), httpx.ReadTimeout("slow")])
def test_connection_errors(exc):
    def boom(req, body):
        raise exc
    client, _, _ = make({REFRESH: httpx.Response(200, json=bundle(refresh=None)), ANALYZE: boom})
    with pytest.raises(ServerUnreachable) as e:
        client.analyze(ORIG, "fix", Config())
    assert str(e.value) == "Can't reach the Polish service. Check your connection."


# ---- sign-in ---------------------------------------------------------------

DEVICE_TOKEN = ("POST", "/v1/auth/device/token")


def test_device_start():
    info = {"device_code": "dc", "user_code": "BCDF-GHJK", "verification_url": "https://polish.test/connect?code=BCDF-GHJK",
            "interval": 3, "expires_in": 600}
    client, srv, _ = make({("POST", "/v1/auth/device/start"): httpx.Response(200, json=info)}, token=None)
    assert client.device_start("Polish on test") == info
    assert srv.calls[0][2] == {"client": "desktop", "device_name": "Polish on test"}


def test_device_poll_states():
    client, srv, store = make({DEVICE_TOKEN: [
        error(428, "authorization_pending"),
        error(429, "slow_down", retry_after=3),
        httpx.Response(200, json=bundle()),
    ]}, token=None)
    assert client.device_poll("dc") == "pending"
    assert client.device_poll("dc") == "slow_down"
    assert store.token is None
    got = client.device_poll("dc")
    assert got["user"]["email"] == "a@b.co"
    assert store.token == "ref1" and client.email == "a@b.co"
    assert client.last_usage == {"balance_credits": 460, "approx_checks_left": 115}
    assert srv.calls[0][2] == {"device_code": "dc"}


@pytest.mark.parametrize("resp,exc", [
    (error(410, "expired", "This sign-in request has expired. Try again."), SignInExpired),
    (error(403, "denied", "Sign-in was declined in the browser."), SignInDenied),
])
def test_device_poll_failures(resp, exc):
    client, _, store = make({DEVICE_TOKEN: resp}, token=None)
    with pytest.raises(exc):
        client.device_poll("dc")
    assert store.token is None


def test_device_poll_network():
    def boom(req, body):
        raise httpx.ConnectError("down")
    client, _, _ = make({DEVICE_TOKEN: boom}, token=None)
    with pytest.raises(ServerUnreachable):
        client.device_poll("dc")


def test_email_sign_in_stores_token(fixture_json):
    client, srv, store = make({
        ("POST", "/v1/auth/email/start"): httpx.Response(200, json={"ok": True}),
        ("POST", "/v1/auth/email/verify"): httpx.Response(200, json=bundle("acc9", "ref9")),
        ANALYZE: analyze_ok(fixture_json),
    }, token=None)
    client.email_start(" a@b.co ")
    client.email_verify("a@b.co", "123456", "Polish on test")
    assert store.token == "ref9" and client.signed_in
    assert srv.calls[0][2] == {"email": "a@b.co"}
    assert srv.calls[1][2] == {"email": "a@b.co", "code": "123456", "client": "desktop", "device_name": "Polish on test"}
    client.analyze(ORIG, "fix", Config())  # uses the access token from sign-in, no refresh
    assert srv.paths() == ["/v1/auth/email/start", "/v1/auth/email/verify", "/v1/analyze"]
    assert srv.calls[-1][3] == "Bearer acc9"


def test_email_wrong_code():
    client, _, store = make({("POST", "/v1/auth/email/verify"): error(401, "invalid_code", "That code isn't right.")},
                            token=None)
    with pytest.raises(InvalidCode, match="isn't right"):
        client.email_verify("a@b.co", "000000")
    assert store.token is None


def test_bad_email():
    client, _, _ = make({("POST", "/v1/auth/email/start"): error(400, "bad_request", "Enter a valid email address.")})
    with pytest.raises(Exception, match="Enter a valid email address."):
        client.email_start("nope")


# ---- account ---------------------------------------------------------------

def test_me():
    me = {"user": USER, "balance_credits": 1234, "approx_checks_left": 300, "fast_mode_credits": 1, "packs": []}
    client, srv, _ = make({REFRESH: httpx.Response(200, json=bundle(refresh=None)),
                           ("GET", "/v1/me"): httpx.Response(200, json=me)})
    assert client.me() == me
    assert client.last_usage == {"balance_credits": 1234, "approx_checks_left": 300}
    assert srv.calls[-1][3] == "Bearer acc1"


def test_logout_clears_even_when_offline():
    def boom(req, body):
        raise httpx.ConnectError("down")
    client, srv, store = make({("POST", "/v1/auth/logout"): boom})
    client.logout()
    assert store.token is None and srv.calls[0][2] == {"refresh_token": "ref1"}


def test_set_server_url_forgets_access(fixture_json):
    client, srv, _ = make({REFRESH: lambda req, body: httpx.Response(200, json=bundle(refresh=None)),
                           ANALYZE: lambda req, body: analyze_ok(fixture_json)})
    client.analyze(ORIG, "fix", Config())
    client.set_server_url("https://other.test")
    client.analyze(ORIG, "fix", Config())
    assert srv.paths().count("/v1/auth/refresh") == 2


def test_balance_text():
    assert balance_text({"balance_credits": 460, "approx_checks_left": 115}) == "$4.60 · ≈ 115 checks left"
    assert balance_text(None) == ""
    assert checks_left_text(1) == "≈ 1 check left"
