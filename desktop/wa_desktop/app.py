"""Tray application: global hotkeys -> capture selection -> Claude -> popup -> replace."""
import logging
import sys
from pathlib import Path

from PySide6.QtCore import Qt
from PySide6.QtGui import QAction, QColor, QFont, QIcon, QPainter, QPixmap
from PySide6.QtWidgets import QApplication, QMenu, QSystemTrayIcon

from wa_core import config as config_mod
from wa_core.errors import NoApiKey
from wa_core.textutil import detect_direction

from .hotkeys import HotkeyManager
from .platform_adapters import IS_MAC, PynputKeyboard, PyperclipClipboard, make_focus
from .selection import SelectionService
from .ui.busy_indicator import BusyIndicator
from .ui.popup import SuggestionPopup
from .ui.settings_dialog import SettingsDialog
from .worker import AnalyzeWorker

log = logging.getLogger("polish")


def make_icon() -> QIcon:
    base = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent.parent)) / "assets"
    if (base / "icon.png").exists():
        icon = QIcon()
        # Hand-tuned small sizes keep the P crisp in the system tray.
        for name in ("icon_16.png", "icon_32.png", "icon.png"):
            if (base / name).exists():
                icon.addFile(str(base / name))
        return icon
    pix = QPixmap(64, 64)
    pix.fill(Qt.transparent)
    p = QPainter(pix)
    p.setRenderHint(QPainter.Antialiasing)
    p.setBrush(QColor("#3b8beb")); p.setPen(Qt.NoPen)
    p.drawEllipse(2, 2, 60, 60)
    p.setPen(QColor("white")); p.setFont(QFont("Arial", 30, QFont.Bold))
    p.drawText(pix.rect(), Qt.AlignCenter, "P")
    p.end()
    return QIcon(pix)


class PolishApp:
    def __init__(self, qapp: QApplication):
        self.qapp = qapp
        self.cfg = config_mod.load()
        self.clipboard = PyperclipClipboard()
        self.focus = make_focus()
        self.selection = SelectionService(self.clipboard, PynputKeyboard(), self.focus)
        self.busy = BusyIndicator()
        self.popup = SuggestionPopup()
        self.popup.replace_requested.connect(self.on_replace)
        self.popup.copy_requested.connect(self.on_copy)
        self.worker = None
        self.focus_handle = None
        self.from_clipboard = False

        self.tray = QSystemTrayIcon(make_icon())
        self.tray.setToolTip("Polish - Make it shine.")
        self.tray.setContextMenu(self._build_menu())
        self.tray.show()

        self.hotkeys = HotkeyManager(self.cfg.hotkeys)
        self.hotkeys.triggered.connect(self.run_mode)
        self.hotkeys.failed.connect(lambda msg: self.toast(msg, error=True))

        hk = self.cfg.hotkeys
        if not self.cfg.effective_api_key:
            self.toast("Add your Anthropic API key to get started.")
            self.open_settings()
        else:
            self.toast(f"Running. Select text anywhere and press {hk['fix']} (fix) or {hk['rephrase']} (rephrase).")

    def _build_menu(self) -> QMenu:
        m = QMenu()
        hk = self.cfg.hotkeys
        info = QAction(f"Hotkeys: {hk['fix']} fix · {hk['rephrase']} rephrase", m); info.setEnabled(False)
        m.addAction(info)
        m.addSeparator()
        m.addAction("Check clipboard text", lambda: self.run_on_clipboard("fix"))
        m.addAction("Rephrase clipboard text", lambda: self.run_on_clipboard("rephrase"))
        m.addSeparator()
        self.fast_action = QAction("Fast mode (cheaper, quicker model)", m, checkable=True)
        self.fast_action.setChecked(self.cfg.use_fast_model)
        self.fast_action.toggled.connect(self._toggle_fast)
        m.addAction(self.fast_action)
        m.addAction("Settings…", self.open_settings)
        m.addSeparator()
        m.addAction("Quit", self.quit)
        return m

    # ---- actions -------------------------------------------------------
    def run_mode(self, mode: str):
        if self.worker and self.worker.isRunning():
            return
        self.popup.hide()
        self.from_clipboard = False
        self.focus_handle = self.focus.get_foreground()
        self._start(mode, text=None)

    def run_on_clipboard(self, mode: str):
        if self.worker and self.worker.isRunning():
            return
        self.from_clipboard = True
        self.focus_handle = None
        self._start(mode, text=self.clipboard.get() or "")

    def _start(self, mode, text):
        self.mode = mode
        self.busy.show_near_cursor()
        self.worker = AnalyzeWorker(self.selection, mode, self.cfg, text=text)
        self.worker.done.connect(self.on_done)
        self.worker.failed.connect(self.on_failed)
        self.worker.start()

    def on_done(self, result, original):
        self.busy.hide()
        if result.dropped_corrections:
            log.info("dropped %d corrections not found in input", result.dropped_corrections)
        if self.mode == "fix_instant":
            if not result.has_changes:
                self.toast("No issues found ✓")
                return
            self.on_replace(result.corrected_text)
            n = len(result.corrections)
            self.toast(f"Replaced: {n} fix{'es' if n != 1 else ''}. Press {'Cmd' if IS_MAC else 'Ctrl'}+Z to undo.")
            return
        self.popup.show_result(result, original, detect_direction(original), self.mode, self.cfg.active_model)

    def on_failed(self, err):
        self.busy.hide()
        self.toast(str(err), error=True)
        if isinstance(err, NoApiKey):
            self.open_settings()

    def on_replace(self, text: str):
        self.popup.hide()
        if self.from_clipboard:
            self.clipboard.set(text)
            self.toast("Copied to clipboard.")
            return
        if not self.selection.replace_selection(text, self.focus_handle):
            self.toast(f"Copied - press {'Cmd' if IS_MAC else 'Ctrl'}+V to paste.")

    def on_copy(self, text: str):
        self.clipboard.set(text)
        self.popup.hide()
        self.toast("Copied to clipboard.")

    def _toggle_fast(self, on: bool):
        self.cfg.use_fast_model = on
        config_mod.save(self.cfg)

    def open_settings(self):
        dlg = SettingsDialog(self.cfg)
        dlg.setWindowFlag(Qt.WindowStaysOnTopHint)
        if dlg.exec():
            self.cfg = dlg.apply()
            self.hotkeys.start(self.cfg.hotkeys)
            self.tray.setContextMenu(self._build_menu())
            self.toast("Settings saved.")

    def toast(self, msg: str, error: bool = False):
        icon = QSystemTrayIcon.Warning if error else QSystemTrayIcon.Information
        self.tray.showMessage("Polish", msg, icon, 4000)
        (log.warning if error else log.info)(msg)

    def quit(self):
        self.hotkeys.stop()
        self.qapp.quit()


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    qapp = QApplication(sys.argv)
    qapp.setQuitOnLastWindowClosed(False)
    qapp.setApplicationName("Polish")
    qapp.setWindowIcon(make_icon())
    if not QSystemTrayIcon.isSystemTrayAvailable():
        log.error("No system tray available on this desktop.")
    app = PolishApp(qapp)  # noqa: F841 (keep reference alive)
    return qapp.exec()
