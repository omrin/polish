import importlib.util
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]


def test_extension_shared_js_in_sync():
    spec = importlib.util.spec_from_file_location("sync_shared", REPO / "scripts" / "sync_shared.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    assert (REPO / "extension" / "src" / "shared.js").read_text(encoding="utf-8") == mod.render()
