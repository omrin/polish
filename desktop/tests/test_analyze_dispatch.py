import pytest

from wa_core import analyze as analyze_mod
from wa_core import claude_client
from wa_core.config import Config
from wa_core.errors import SignedOut


class FakeAccount:
    def __init__(self):
        self.calls = []

    def analyze(self, text, mode, cfg):
        self.calls.append((text, mode, cfg))
        return "from-account"


def test_account_mode_uses_account_client(monkeypatch):
    monkeypatch.setattr(claude_client, "analyze", lambda *a, **k: pytest.fail("called the API directly"))
    acct = FakeAccount()
    cfg = Config(api_key="sk-ant-x")  # a key alone doesn't switch modes
    assert analyze_mod.analyze("hi", "fix", cfg, acct) == "from-account"
    assert acct.calls == [("hi", "fix", cfg)]


def test_api_key_mode_uses_claude_client(monkeypatch):
    seen = []
    monkeypatch.setattr(claude_client, "analyze", lambda text, mode, cfg: seen.append((text, mode)) or "from-key")
    acct = FakeAccount()
    assert analyze_mod.analyze("hi", "rephrase", Config(auth_mode="api_key"), acct) == "from-key"
    assert seen == [("hi", "rephrase")] and acct.calls == []


def test_account_mode_without_client_is_signed_out():
    with pytest.raises(SignedOut):
        analyze_mod.analyze("hi", "fix", Config(), None)
