"""Tray application: global hotkeys -> capture selection -> Claude -> popup -> replace."""
import logging
import sys
import webbrowser
from pathlib import Path

from PySide6.QtCore import QDir, QLockFile, Qt, QTimer
from PySide6.QtGui import QAction, QColor, QFont, QIcon, QPainter, QPixmap
from PySide6.QtWidgets import QApplication, QMenu, QSystemTrayIcon

from wa_core import config as config_mod
from wa_core.account_client import AccountClient, balance_text, checks_left_text
from wa_core.errors import NoApiKey, NoCredits, SignedOut
from wa_core.textutil import detect_direction
from wa_core.token_store import TokenStore

from . import background
from .hotkeys import HotkeyManager
from .platform_adapters import IS_MAC, PynputKeyboard, PyperclipClipboard, make_focus
from .selection import SelectionService
from .ui.busy_indicator import BusyIndicator
from .ui.popup import SuggestionPopup
from .ui.settings_dialog import SettingsDialog
from .ui.signin_dialog import SignInDialog
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
        self.account = AccountClient(self.cfg.server_url, TokenStore())
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
        self.signin_open = False

        self.tray = QSystemTrayIcon(make_icon())
        self.tray.setToolTip("Polish - Make it shine.")
        self._rebuild_menu()
        self.tray.show()

        self.hotkeys = HotkeyManager(self.cfg.hotkeys)
        self.hotkeys.triggered.connect(self.run_mode)
        self.hotkeys.failed.connect(lambda msg: self.toast(msg, error=True))

        hk = self.cfg.hotkeys
        if self.cfg.uses_account and not self.account.signed_in:
            self.toast("Sign in to start using Polish")
            QTimer.singleShot(0, self.open_signin)
        elif not self.cfg.uses_account and not self.cfg.effective_api_key:
            self.toast("Add your Anthropic API key to get started.")
            self.open_settings()
        else:
            self.toast(f"Running. Select text anywhere and press {hk['fix']} (fix) or {hk['rephrase']} (rephrase).")
            self.refresh_account()

    def _build_menu(self) -> QMenu:
        m = QMenu()
        hk = self.cfg.hotkeys
        info = QAction(f"Hotkeys: {hk['fix']} fix · {hk['rephrase']} rephrase", m); info.setEnabled(False)
        m.addAction(info)
        acct = self.cfg.uses_account
        signed_in = acct and self.account.signed_in
        self.account_info = None
        if acct:
            self.account_info = QAction(self._account_info_text(signed_in), m)
            self.account_info.setEnabled(False)
            m.addAction(self.account_info)
        m.addSeparator()
        m.addAction("Check clipboard text", lambda: self.run_on_clipboard("fix"))
        m.addAction("Rephrase clipboard text", lambda: self.run_on_clipboard("rephrase"))
        m.addSeparator()
        label = "Fast mode (1 credit per check)" if acct else "Fast mode (cheaper, quicker model)"
        self.fast_action = QAction(label, m, checkable=True)
        self.fast_action.setChecked(self.cfg.use_fast_model)
        self.fast_action.toggled.connect(self._toggle_fast)
        m.addAction(self.fast_action)
        if acct:
            m.addAction("Buy credits…", self.buy_credits)
            if signed_in:
                m.addAction("Sign out", self.sign_out)
            else:
                m.addAction("Sign in…", self.open_signin)
        m.addAction("Settings…", self.open_settings)
        m.addSeparator()
        m.addAction("Quit", self.quit)
        return m

    def _rebuild_menu(self):
        self.menu = self._build_menu()  # keep a reference; the tray doesn't own it
        self.tray.setContextMenu(self.menu)

    def _account_info_text(self, signed_in: bool) -> str:
        if not signed_in:
            return "Not signed in"
        parts = [self.account.email or self.cfg.account_email or "Signed in"]
        if balance_text(self.account.last_usage):
            parts.append(balance_text(self.account.last_usage))
        return " · ".join(parts)

    def _update_account_info(self):
        if self.cfg.uses_account and self.account_info is not None:
            self.account_info.setText(self._account_info_text(self.account.signed_in))

    # ---- account -------------------------------------------------------
    def refresh_account(self):
        """Fetch the email and balance in the background (startup, after sign-in)."""
        if self.cfg.uses_account and self.account.signed_in:
            background.start(self.account.me, on_done=self._account_loaded, on_failed=self._account_failed)

    def _account_loaded(self, _):
        email = self.account.email
        if email and email != self.cfg.account_email:
            self.cfg.account_email = email
            config_mod.save(self.cfg)
        self._update_account_info()

    def _account_failed(self, err):
        log.info("couldn't load account: %s", err)
        if isinstance(err, SignedOut):
            self._rebuild_menu()

    def open_signin(self):
        if self.signin_open:
            return
        self.signin_open = True
        try:
            self.account.set_server_url(self.cfg.server_url)
            dlg = SignInDialog(self.account, self.cfg)
            dlg.setWindowFlag(Qt.WindowStaysOnTopHint)
            if dlg.exec():
                hk = self.cfg.hotkeys
                self.toast(f"Signed in. Select text anywhere and press {hk['fix']} (fix) or {hk['rephrase']} (rephrase).")
        finally:
            self.signin_open = False
            self._rebuild_menu()

    def sign_out(self):
        self.cfg.account_email = ""
        config_mod.save(self.cfg)
        background.start(self.account.logout, on_done=self._signed_out, on_failed=self._signed_out)

    def _signed_out(self, _):
        self._rebuild_menu()
        self.toast("Signed out.")

    def buy_credits(self):
        webbrowser.open(self.cfg.buy_url)

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
        self.worker = AnalyzeWorker(self.selection, mode, self.cfg, text=text, account_client=self.account)
        self.worker.done.connect(self.on_done)
        self.worker.failed.connect(self.on_failed)
        self.worker.start()

    def on_done(self, result, original):
        self.busy.hide()
        if self.cfg.uses_account:
            self._update_account_info()
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
        self.popup.show_result(result, original, detect_direction(original), self.mode, self._subtitle())

    def _subtitle(self) -> str:
        if not self.cfg.uses_account:
            return self.cfg.active_model
        return checks_left_text((self.account.last_usage or {}).get("approx_checks_left")) or "Polish"

    def on_failed(self, err):
        self.busy.hide()
        if isinstance(err, NoCredits):
            if err.balance is not None:
                self.account.last_usage = {"balance_credits": err.balance, "approx_checks_left": 0}
            self.toast(f"{err} Opening the page to buy more.", error=True)
            webbrowser.open(err.buy_url or self.cfg.buy_url)
            self._update_account_info()
            return
        self.toast(str(err), error=True)
        if isinstance(err, NoApiKey):
            self.open_settings()
        elif isinstance(err, SignedOut):
            self._rebuild_menu()
            self.open_signin()
        # ServerUnreachable and the rest: the toast says it all.

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
        dlg = SettingsDialog(self.cfg, self.account)
        dlg.setWindowFlag(Qt.WindowStaysOnTopHint)
        saved = dlg.exec()
        if saved:
            self.cfg = dlg.apply()
            self.account.set_server_url(self.cfg.server_url)
            self.hotkeys.start(self.cfg.hotkeys)
            self.toast("Settings saved.")
        self._rebuild_menu()  # sign-in state may have changed even on Cancel
        if saved and self.cfg.uses_account and not self.account.signed_in:
            QTimer.singleShot(0, self.open_signin)

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
    # Only one Polish at a time (e.g. started by Windows at login and again from the Start menu).
    lock = QLockFile(str(Path(QDir.tempPath()) / "polish-app.lock"))
    if not lock.tryLock(100):
        log.info("Polish is already running.")
        return 0
    qapp.setApplicationName("Polish")
    qapp.setWindowIcon(make_icon())
    if not QSystemTrayIcon.isSystemTrayAvailable():
        log.error("No system tray available on this desktop.")
    app = PolishApp(qapp)  # noqa: F841 (keep reference alive)
    return qapp.exec()
