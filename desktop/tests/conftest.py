import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
FIX = Path(__file__).parent / "fixtures"


@pytest.fixture
def fixture_text():
    return lambda name: (FIX / name).read_text(encoding="utf-8")


@pytest.fixture
def fixture_json():
    return lambda name: json.loads((FIX / name).read_text(encoding="utf-8"))


@pytest.fixture(autouse=True)
def no_env_key(monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
