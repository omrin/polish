"""Grab the user's current selection from any app via a simulated copy, and paste a replacement.

The user's clipboard is always restored afterwards.
"""
import time
import uuid

from wa_core.errors import EmptySelection
from wa_core.textutil import normalize_newlines

from .ports import ClipboardPort, FocusPort, KeyboardPort


class SelectionService:
    def __init__(self, clipboard: ClipboardPort, keyboard: KeyboardPort, focus: FocusPort,
                 sleep=time.sleep, clock=time.monotonic):
        self.clipboard = clipboard
        self.keyboard = keyboard
        self.focus = focus
        self.sleep = sleep
        self.clock = clock

    def capture_selection(self, timeout: float = 0.6) -> str:
        saved = self._safe_get()
        sentinel = f"__wa_sentinel_{uuid.uuid4().hex}__"
        self.clipboard.set(sentinel)
        try:
            # The hotkey's modifiers are still physically held; release them so Ctrl+C isn't Ctrl+Alt+C.
            self.keyboard.release_modifiers()
            self.sleep(0.06)
            self.keyboard.copy()
            deadline = self.clock() + timeout
            text = sentinel
            while self.clock() < deadline:
                self.sleep(0.025)
                text = self._safe_get()
                if text != sentinel:
                    break
        finally:
            self.clipboard.set(saved)
        if text == sentinel or not text or not text.strip():
            raise EmptySelection()
        return normalize_newlines(text)

    def replace_selection(self, new_text: str, focus_handle=None) -> bool:
        """Paste new_text over the selection. Returns False if focus couldn't be restored;
        in that case new_text is left on the clipboard so the user can paste manually."""
        saved = self._safe_get()
        self.clipboard.set(new_text)
        if focus_handle is not None and not self.focus.restore(focus_handle):
            return False
        self.sleep(0.15)
        self.keyboard.release_modifiers()
        self.keyboard.paste()
        self.sleep(0.3)  # give the target app time to read the clipboard
        self.clipboard.set(saved)
        return True

    def _safe_get(self) -> str:
        try:
            return self.clipboard.get() or ""
        except Exception:
            return ""
