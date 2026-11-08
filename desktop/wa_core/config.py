import json
import os
import sys
from dataclasses import asdict, dataclass, field, fields
from pathlib import Path

from . import shared_data


def config_dir() -> Path:
    if sys.platform.startswith("win"):
        base = Path(os.environ.get("APPDATA", Path.home() / "AppData" / "Roaming"))
        return base / "WritingAssistant"
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / "WritingAssistant"
    return Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config")) / "writing-assistant"


def _default_hotkeys() -> dict:
    return {
        "fix": "<ctrl>+<alt>+g",
        "fix_instant": "<ctrl>+<alt>+<shift>+g",
        "rephrase": "<ctrl>+<alt>+r",
    }


@dataclass
class Config:
    api_key: str = ""
    model: str = field(default_factory=lambda: shared_data.load()["default_model"])
    fast_model: str = field(default_factory=lambda: shared_data.load()["fast_model"])
    use_fast_model: bool = False
    hotkeys: dict = field(default_factory=_default_hotkeys)
    labels: list = field(default_factory=lambda: list(shared_data.load()["default_labels"]))
    explanation_language: str = "auto"
    max_chars: int = field(default_factory=lambda: shared_data.limits()["max_chars"])
    refusal_fallback: bool = True

    @property
    def active_model(self) -> str:
        return self.fast_model if self.use_fast_model else self.model

    @property
    def effective_api_key(self) -> str:
        return os.environ.get("ANTHROPIC_API_KEY") or self.api_key


def default_path() -> Path:
    return config_dir() / "config.json"


def load(path: Path | None = None) -> Config:
    path = path or default_path()
    cfg = Config()
    if path.exists():
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            data = {}
        known = {f.name for f in fields(Config)}
        for k, v in data.items():
            if k in known:
                setattr(cfg, k, v)
        hk = _default_hotkeys()
        hk.update(cfg.hotkeys or {})
        cfg.hotkeys = hk
    return cfg


def save(cfg: Config, path: Path | None = None) -> Path:
    path = path or default_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(asdict(cfg), indent=2, ensure_ascii=False), encoding="utf-8")
    try:
        os.chmod(path, 0o600)
    except OSError:
        pass
    return path
