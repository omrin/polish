import os
import sys

from wa_core import token_store
from wa_core.token_store import TokenStore


class BrokenKeyring:
    def get_password(self, *a):
        raise RuntimeError("no backend")

    set_password = delete_password = get_password


class MemKeyring:
    def __init__(self):
        self.d = {}

    def get_password(self, s, u):
        return self.d.get((s, u))

    def set_password(self, s, u, p):
        self.d[(s, u)] = p

    def delete_password(self, s, u):
        self.d.pop((s, u), None)


def test_file_fallback_when_keyring_fails(tmp_path, monkeypatch):
    monkeypatch.setattr(token_store, "_keyring", lambda: BrokenKeyring())
    st = TokenStore(tmp_path / "token")
    assert st.load() is None
    st.save("abc")
    assert st.load() == "abc"
    if not sys.platform.startswith("win"):
        assert os.stat(tmp_path / "token").st_mode & 0o777 == 0o600
    st.clear()
    assert st.load() is None and not (tmp_path / "token").exists()


def test_file_fallback_without_keyring_module(tmp_path, monkeypatch):
    monkeypatch.setattr(token_store, "_keyring", lambda: None)
    st = TokenStore(tmp_path / "token")
    st.save("abc")
    assert st.load() == "abc"


def test_keyring_used_when_available(tmp_path, monkeypatch):
    kr = MemKeyring()
    monkeypatch.setattr(token_store, "_keyring", lambda: kr)
    (tmp_path / "token").write_text("stale")
    st = TokenStore(tmp_path / "token")
    st.save("abc")
    assert kr.d == {("Polish", "refresh_token"): "abc"}
    assert not (tmp_path / "token").exists()  # no copy left on disk
    assert st.load() == "abc"
    st.clear()
    assert kr.d == {} and st.load() is None
