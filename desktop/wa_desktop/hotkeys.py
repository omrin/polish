"""Global hotkeys (work in any application) via pynput, bridged to Qt signals."""
import logging

from PySide6.QtCore import QObject, Signal

log = logging.getLogger(__name__)


class HotkeyManager(QObject):
    triggered = Signal(str)   # mode: fix | fix_instant | rephrase
    failed = Signal(str)

    def __init__(self, hotkeys: dict, parent=None):
        super().__init__(parent)
        self._listener = None
        self.start(hotkeys)

    def start(self, hotkeys: dict) -> None:
        self.stop()
        try:
            from pynput import keyboard
            mapping = {combo: (lambda m=mode: self.triggered.emit(m))
                       for mode, combo in hotkeys.items() if combo}
            self._listener = keyboard.GlobalHotKeys(mapping)
            self._listener.daemon = True
            self._listener.start()
        except Exception as exc:  # bad combo string, no X server, missing permission...
            log.exception("hotkey registration failed")
            self.failed.emit(f"Couldn't register hotkeys: {exc}")

    def stop(self) -> None:
        if self._listener is not None:
            self._listener.stop()
            self._listener = None
