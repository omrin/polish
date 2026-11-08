from types import SimpleNamespace

import anthropic
import httpx2 as httpx
import pytest

from wa_core import shared_data
from wa_core.claude_client import analyze
from wa_core.config import Config
from wa_core.errors import (ApiAuth, ApiNetwork, ApiRateLimit, ApiRefused, BadResponse,
                            NoApiKey, TextTooLong)

ORIG = "I has a apple and I wnat to eat it."


def fake_client(raw=None, stop_reason="end_turn", exc=None):
    resp = SimpleNamespace(stop_reason=stop_reason,
                           content=[SimpleNamespace(type="text", text=raw or "{}")])
    create = (lambda **kw: (_ for _ in ()).throw(exc)) if exc else None
    client = SimpleNamespace(calls=[])

    def _create(**kw):
        client.calls.append(kw)
        if exc:
            raise exc
        return resp
    client.messages = SimpleNamespace(create=_create)
    client.beta = SimpleNamespace(messages=SimpleNamespace(create=_create))
    return client


def _status_error(cls, code):
    req = httpx.Request("POST", "https://api.anthropic.com/v1/messages")
    return cls("boom", response=httpx.Response(code, request=req), body=None)


def test_request_shape_with_fallback(fixture_text):
    c = fake_client(fixture_text("response_en.json"))
    r = analyze(ORIG, "fix", Config(api_key="k"), client=c)
    assert r.has_changes
    kw = c.calls[0]
    assert kw["model"] == "claude-opus-5-5"
    assert kw["output_config"]["format"]["schema"] == shared_data.schema()
    assert kw["output_config"]["effort"] == "low"
    assert kw["betas"] == ["server-side-fallback-2026-07-01"] and kw["fallbacks"] == "default"
    assert "temperature" not in kw and "thinking" not in kw
    assert kw["messages"][0]["content"].startswith("<text>\n")


def test_fast_model_has_no_fallback(fixture_text):
    c = fake_client(fixture_text("response_en.json"))
    analyze(ORIG, "fix", Config(api_key="k", use_fast_model=True), client=c)
    assert c.calls[0]["model"] == "claude-haiku-5-5"
    assert "betas" not in c.calls[0] and "fallbacks" not in c.calls[0]


def test_no_key():
    with pytest.raises(NoApiKey):
        analyze(ORIG, "fix", Config(api_key=""), client=fake_client())


def test_too_long_not_sent():
    c = fake_client()
    with pytest.raises(TextTooLong):
        analyze("x" * 9001, "fix", Config(api_key="k"), client=c)
    assert c.calls == []


@pytest.mark.parametrize("exc,err", [
    (_status_error(anthropic.AuthenticationError, 401), ApiAuth),
    (_status_error(anthropic.RateLimitError, 429), ApiRateLimit),
    (_status_error(anthropic.InternalServerError, 500), ApiNetwork),
    (anthropic.APIConnectionError(request=httpx.Request("POST", "https://x")), ApiNetwork),
    (anthropic.APITimeoutError(request=httpx.Request("POST", "https://x")), ApiNetwork),
])
def test_error_mapping(exc, err):
    with pytest.raises(err):
        analyze(ORIG, "fix", Config(api_key="k"), client=fake_client(exc=exc))


def test_refusal():
    with pytest.raises(ApiRefused):
        analyze(ORIG, "fix", Config(api_key="k"), client=fake_client(stop_reason="refusal"))


def test_max_tokens():
    with pytest.raises(TextTooLong):
        analyze(ORIG, "fix", Config(api_key="k"), client=fake_client(stop_reason="max_tokens"))


def test_bad_json():
    with pytest.raises(BadResponse):
        analyze(ORIG, "fix", Config(api_key="k"), client=fake_client(raw="nope"))


def test_rephrase(fixture_text):
    c = fake_client(fixture_text("response_rephrase.json"))
    r = analyze(ORIG, "rephrase", Config(api_key="k"), client=c)
    assert [x.label for x in r.rephrasings] == ["Formal", "Concise", "Friendly"]
    assert "exactly 3 alternatives" in c.calls[0]["system"]
