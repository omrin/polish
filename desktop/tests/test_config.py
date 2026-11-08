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
