"""Real OS adapters for ClipboardPort / KeyboardPort / FocusPort."""
import sys

IS_MAC = sys.platform == "darwin"
IS_WIN = sys.platform.startswith("win")


class PyperclipClipboard:
    def __init__(self):
        import pyperclip
        self._pc = pyperclip

    def get(self) -> str:
        return self._pc.paste()

    def set(self, text: str) -> None:
        self._pc.copy(text)


class PynputKeyboard:
    def __init__(self):
        from pynput.keyboard import Controller, Key
        self._kb = Controller()
        self._Key = Key
        self._mod = Key.cmd if IS_MAC else Key.ctrl

    def release_modifiers(self) -> None:
        K = self._Key
        for k in (K.ctrl, K.ctrl_l, K.ctrl_r, K.alt, K.alt_l, K.alt_r, K.alt_gr,
                  K.shift, K.shift_l, K.shift_r, K.cmd, K.cmd_l, K.cmd_r):
            try:
                self._kb.release(k)
            except Exception:
                pass

    def _combo(self, char: str) -> None:
        with self._kb.pressed(self._mod):
            self._kb.press(char)
            self._kb.release(char)

    def copy(self) -> None:
        self._combo("c")

    def paste(self) -> None:
        self._combo("v")


class Win32Focus:
    def __init__(self):
        import ctypes
        self._user32 = ctypes.windll.user32

    def get_foreground(self):
        return self._user32.GetForegroundWindow()

    def restore(self, handle) -> bool:
        if not handle:
            return False
        if self._user32.GetForegroundWindow() == handle:
            return True
        # Pressing/releasing ALT lets a background process call SetForegroundWindow.
        self._user32.keybd_event(0x12, 0, 0, 0)
        self._user32.keybd_event(0x12, 0, 2, 0)
        return bool(self._user32.SetForegroundWindow(handle))


class NoopFocus:
    """macOS/Linux: hiding our tool window returns focus to the previous app."""

    def get_foreground(self):
        return None

    def restore(self, handle) -> bool:
        return True


def make_focus():
    if IS_WIN:
        try:
            return Win32Focus()
        except Exception:
            pass
    return NoopFocus()
