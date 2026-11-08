"""Loads shared/prompt.json - the single source of truth shared with the Chrome extension."""
import json
import sys
from functools import lru_cache
from pathlib import Path


def _candidates():
    # PyInstaller one-file bundle unpacks data files under sys._MEIPASS/shared
    meipass = getattr(sys, "_MEIPASS", None)
    if meipass:
        yield Path(meipass) / "shared" / "prompt.json"
    here = Path(__file__).resolve()
    yield here.parent.parent.parent / "shared" / "prompt.json"  # repo layout
    yield here.parent / "prompt.json"


@lru_cache(maxsize=1)
def load() -> dict:
    for path in _candidates():
        if path.exists():
            return json.loads(path.read_text(encoding="utf-8"))
    raise FileNotFoundError("shared/prompt.json not found")


def schema() -> dict:
    return load()["schema"]


def limits() -> dict:
    return load()["limits"]
