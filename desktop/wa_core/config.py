import json
import os
import sys
import uuid
from dataclasses import asdict, dataclass, field, fields
from pathlib import Path

from . import shared_data


def config_dir() -> Path:
    if sys.platform.startswith("win"):
        base = Path(os.environ.get("APPDATA", Path.home() / "AppData" / "Roaming"))
        return base / "Polish"
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / "Polish"
    return Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config")) / "polish"


def _default_hotkeys() -> dict:
    return {
        "fix": "<ctrl>+<alt>+g",
        "fix_instant": "<ctrl>+<alt>+<shift>+g",
        "rephrase": "<ctrl>+<alt>+r",
    }


AUTH_MODES = ("account", "api_key")


def _default_server_url() -> str:
    return shared_data.service()["base_url"].rstrip("/")


@dataclass
class Config:
    # "account": sign in to the Polish service and pay with credits (default).
    # "api_key": call Anthropic directly with the user's own key (advanced).
    auth_mode: str = "account"
    server_url: str = field(default_factory=_default_server_url)
    account_email: str = ""
    device_id: str = field(default_factory=lambda: str(uuid.uuid4()))
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

    @property
    def uses_account(self) -> bool:
        return self.auth_mode != "api_key"

    @property
    def buy_url(self) -> str:
        svc = shared_data.service()
        base = (self.server_url or "").rstrip("/")
        if not base or base == _default_server_url():
            return svc["buy_url"]
        return f"{base}/account#buy"


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
        if not isinstance(data, dict):
            data = {}
        known = {f.name for f in fields(Config)}
        for k, v in data.items():
            if k in known:
                setattr(cfg, k, v)
        hk = _default_hotkeys()
        hk.update(cfg.hotkeys or {})
        cfg.hotkeys = hk
        # Configs written before Polish accounts existed: someone with a key keeps using it.
        if "auth_mode" not in data and data.get("api_key"):
            cfg.auth_mode = "api_key"
        if cfg.auth_mode not in AUTH_MODES:
            cfg.auth_mode = "account"
        cfg.server_url = (cfg.server_url or "").strip().rstrip("/") or _default_server_url()
        if data and "device_id" not in data:
            try:  # create the device id once, so it stays the same across launches
                save(cfg, path)
            except OSError:
                pass
    return cfg


def save(cfg: Config, path: Path | None = None) -> Path:
    path = path or default_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    data = asdict(cfg)
    if data["server_url"] == _default_server_url():
        # Not pinned: follow the address that ships with the app (it changes once the domain is live).
        del data["server_url"]
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    try:
        os.chmod(path, 0o600)
    except OSError:
        pass
    return path
