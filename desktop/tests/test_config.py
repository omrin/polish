import json

import pytest

from wa_core import config


def test_defaults():
    c = config.Config()
    assert c.model == "claude-opus-5-5" and c.fast_model == "claude-haiku-5-5"
    assert c.hotkeys["fix"] == "<ctrl>+<alt>+g" and c.max_chars == 8000


def test_env_key_wins(monkeypatch):
    c = config.Config(api_key="file-key")
    assert c.effective_api_key == "file-key"
    monkeypatch.setenv("ANTHROPIC_API_KEY", "env-key")
    assert c.effective_api_key == "env-key"


def test_roundtrip(tmp_path):
    p = tmp_path / "c.json"
    c = config.Config(api_key="k", use_fast_model=True, labels=["A", "B"])
    c.hotkeys = {"fix": "<ctrl>+<alt>+x"}
    config.save(c, p)
    loaded = config.load(p)
    assert loaded.api_key == "k" and loaded.use_fast_model and loaded.labels == ["A", "B"]
    assert loaded.hotkeys["fix"] == "<ctrl>+<alt>+x" and loaded.hotkeys["rephrase"] == "<ctrl>+<alt>+r"
    assert loaded.active_model == "claude-haiku-5-5"


def test_corrupt_file(tmp_path):
    p = tmp_path / "c.json"
    p.write_text("{nope")
    assert config.load(p).model == "claude-opus-5-5"


def test_account_defaults():
    c = config.Config()
    assert c.auth_mode == "account" and c.uses_account
    assert c.server_url == "https://polish.example.com" and c.account_email == ""
    assert len(c.device_id) == 36 and config.Config().device_id != c.device_id
    assert c.buy_url == "https://polish.example.com/account#buy"
    assert config.Config(server_url="http://localhost:8787").buy_url == "http://localhost:8787/account#buy"


def test_existing_key_user_keeps_api_key_mode(tmp_path):
    p = tmp_path / "c.json"
    p.write_text(json.dumps({"api_key": "sk-ant-x", "model": "claude-opus-5-5"}))
    c = config.load(p)
    assert c.auth_mode == "api_key" and not c.uses_account and c.api_key == "sk-ant-x"


@pytest.mark.parametrize("data,mode", [
    ({"model": "claude-opus-5-5"}, "account"),                    # old config, no key
    ({"api_key": ""}, "account"),                                 # old config, empty key
    ({"api_key": "sk-ant-x", "auth_mode": "account"}, "account"),  # already chose
    ({"auth_mode": "bogus"}, "account"),
])
def test_auth_mode_on_load(tmp_path, data, mode):
    p = tmp_path / "c.json"
    p.write_text(json.dumps(data))
    assert config.load(p).auth_mode == mode


def test_missing_file_is_account_mode(tmp_path):
    assert config.load(tmp_path / "none.json").auth_mode == "account"


def test_device_id_created_once(tmp_path):
    p = tmp_path / "c.json"
    p.write_text(json.dumps({"api_key": "sk-ant-x"}))
    first = config.load(p).device_id
    assert config.load(p).device_id == first
    # the migration is written down too, so it doesn't depend on the key staying set
    assert json.loads(p.read_text())["auth_mode"] == "api_key"


def test_default_server_url_not_pinned(tmp_path):
    p = tmp_path / "c.json"
    config.save(config.Config(), p)
    assert "server_url" not in json.loads(p.read_text())
    config.save(config.Config(server_url="http://localhost:8787/"), p)
    assert config.load(p).server_url == "http://localhost:8787"
