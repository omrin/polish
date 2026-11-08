"""Keeps the Polish refresh token: in the OS keychain when there is one, else in a private file."""
import logging
import os
from pathlib import Path

from .config import config_dir

log = logging.getLogger(__name__)

SERVICE = "Polish"
USER = "refresh_token"


def _keyring():
    try:
        import keyring
        return keyring
    except Exception:  # not installed, or a broken backend at import time
        return None


class TokenStore:
    """load() -> token or None, save(token), clear(). Never raises for storage problems on load/clear."""

    def __init__(self, path: Path | None = None, use_keyring: bool = True):
        self.path = path or (config_dir() / "token")
        self.use_keyring = use_keyring

    def _kr(self):
        return _keyring() if self.use_keyring else None

    def load(self) -> str | None:
        kr = self._kr()
        if kr is not None:
            try:
                tok = kr.get_password(SERVICE, USER)
                if tok:
                    return tok
            except Exception as exc:
                log.debug("keyring read failed: %s", exc)
        try:
            return self.path.read_text(encoding="utf-8").strip() or None
        except OSError:
            return None

    def save(self, token: str) -> None:
        kr = self._kr()
        if kr is not None:
            try:
                kr.set_password(SERVICE, USER, token)
                self._remove_file()
                return
            except Exception as exc:
                log.info("keyring not available (%s); storing the sign-in in %s", exc, self.path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        fd = os.open(self.path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(token)
        try:
            os.chmod(self.path, 0o600)
        except OSError:
            pass

    def clear(self) -> None:
        kr = self._kr()
        if kr is not None:
            try:
                kr.delete_password(SERVICE, USER)
            except Exception:
                pass
        self._remove_file()

    def _remove_file(self):
        try:
            self.path.unlink()
        except OSError:
            pass
