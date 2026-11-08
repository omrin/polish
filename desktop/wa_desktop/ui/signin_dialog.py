"""Sign in to a Polish account: browser confirmation (device flow), or a code sent by email."""
import time
import webbrowser

from PySide6.QtCore import QRegularExpression, Qt, QThread, Signal
from PySide6.QtGui import QRegularExpressionValidator
from PySide6.QtWidgets import (QDialog, QHBoxLayout, QLabel, QLineEdit, QPushButton, QSizePolicy,
                               QStackedWidget, QVBoxLayout, QWidget)

from wa_core import config as config_mod
from wa_core.errors import ServerUnreachable, SignInDenied, SignInExpired, WAError

from .. import background

STYLE = """
    QLabel#title { font-size:16px; font-weight:700; color:#3b8beb; }
    QLabel#code { font-size:24px; font-weight:700; letter-spacing:3px; color:#263238;
                  font-family:"Menlo","Consolas","DejaVu Sans Mono",monospace;
                  background:#f5f7f8; border:1px solid #cfd8dc; border-radius:8px; padding:8px 16px; }
    QLabel#muted { color:#607d8b; }
    QLabel#error { color:#c62828; }
    QPushButton { padding:6px 14px; border-radius:6px; border:1px solid #b0bec5; background:#f5f7f8; }
    QPushButton:disabled { color:#90a4ae; }
    QPushButton#primary { background:qlineargradient(x1:0, y1:0, x2:1, y2:1, stop:0 #4fd3c0, stop:0.5 #3b8beb, stop:1 #6a4ce0);
                          color:white; border:none; font-weight:600; padding:8px 18px; }
    QPushButton#primary:disabled { background:#b0bec5; }
    QPushButton#link { border:none; background:transparent; color:#1565c0; padding:2px 0; text-align:left; }
    QPushButton#link:hover { text-decoration:underline; }
"""

NET_RETRIES = 3  # consecutive network failures tolerated while waiting for the browser


def open_url(url: str):
    webbrowser.open(url)


class DevicePoller(QThread):
    """Asks the service every `interval` seconds whether the browser confirmed the code."""
    signed_in = Signal(object)
    failed = Signal(object)

    def __init__(self, client, device_code: str, interval: float, expires_in: float, parent=None):
        super().__init__(parent)
        self.client, self.device_code = client, device_code
        self.interval = max(1.0, float(interval or 3))
        self.deadline = time.monotonic() + float(expires_in or 600)
        self._cancel = False

    def cancel(self):
        self._cancel = True

    def _sleep(self, seconds: float) -> bool:
        end = time.monotonic() + seconds
        while time.monotonic() < end:
            if self._cancel:
                return False
            self.msleep(100)
        return not self._cancel

    def run(self):
        net_failures = 0
        while self._sleep(self.interval):
            if time.monotonic() > self.deadline:
                self.failed.emit(SignInExpired())
                return
            try:
                r = self.client.device_poll(self.device_code)
            except ServerUnreachable as err:
                net_failures += 1
                if net_failures >= NET_RETRIES:
                    self.failed.emit(err)
                    return
                continue
            except WAError as err:
                self.failed.emit(err)
                return
            except Exception as exc:
                self.failed.emit(WAError(f"Unexpected error: {exc}"))
                return
            net_failures = 0
            if r == "pending":
                continue
            if r == "slow_down":
                self.interval += 2
                continue
            self.signed_in.emit(r)
            return


def _link(text: str) -> QPushButton:
    b = QPushButton(text)
    b.setObjectName("link")
    b.setCursor(Qt.PointingHandCursor)
    b.setFlat(True)
    return b


class SignInDialog(QDialog):
    def __init__(self, account_client, cfg, parent=None):
        super().__init__(parent)
        self.client, self.cfg = account_client, cfg
        self.poller: DevicePoller | None = None
        self.verification_url = ""
        self.setWindowTitle("Polish - Sign in")
        self.setStyleSheet(STYLE)
        self.setMinimumWidth(440)

        outer = QVBoxLayout(self)
        outer.setContentsMargins(22, 18, 22, 16)
        outer.setSpacing(10)
        title = QLabel("Sign in to Polish")
        title.setObjectName("title")
        outer.addWidget(title)

        self.stack = QStackedWidget()
        outer.addWidget(self.stack)
        self.stack.addWidget(self._start_page())
        self.stack.addWidget(self._device_page())
        self.stack.addWidget(self._email_page())
        self._set_page(0)

        self.error = QLabel()
        self.error.setObjectName("error")
        self.error.setWordWrap(True)
        self.error.hide()
        outer.addWidget(self.error)

        bottom = QHBoxLayout()
        bottom.addStretch(1)
        cancel = QPushButton("Cancel")
        cancel.clicked.connect(self.reject)
        bottom.addWidget(cancel)
        outer.addLayout(bottom)

    # ---- pages -----------------------------------------------------------
    def _start_page(self) -> QWidget:
        w = QWidget()
        v = QVBoxLayout(w)
        v.setContentsMargins(0, 0, 0, 0)
        intro = QLabel("Sign in or create an account in your browser. Checks are paid with Polish "
                       "credits, so you don't need an API key.")
        intro.setWordWrap(True)
        v.addWidget(intro)
        self.signin_btn = QPushButton("Sign in to Polish")
        self.signin_btn.setObjectName("primary")
        self.signin_btn.setDefault(True)
        self.signin_btn.clicked.connect(self.start_device)
        row = QHBoxLayout()
        row.addWidget(self.signin_btn)
        row.addStretch(1)
        v.addSpacing(4)
        v.addLayout(row)
        email = _link("Use an email code instead")
        email.clicked.connect(self.show_email)
        v.addWidget(email)
        return w

    def _device_page(self) -> QWidget:
        w = QWidget()
        v = QVBoxLayout(w)
        v.setContentsMargins(0, 0, 0, 0)
        v.addWidget(QLabel("We opened your browser. If asked, confirm this code:"))
        self.code_label = QLabel()
        self.code_label.setObjectName("code")
        self.code_label.setTextInteractionFlags(Qt.TextSelectableByMouse)
        row = QHBoxLayout()
        row.addWidget(self.code_label)
        row.addStretch(1)
        v.addLayout(row)
        self.device_status = QLabel("Waiting for you to confirm in the browser…")
        self.device_status.setObjectName("muted")
        v.addWidget(self.device_status)
        again = QPushButton("Open browser again")
        again.clicked.connect(lambda: open_url(self.verification_url))
        row2 = QHBoxLayout()
        row2.addWidget(again)
        row2.addStretch(1)
        v.addLayout(row2)
        email = _link("Use an email code instead")
        email.clicked.connect(self.show_email)
        v.addWidget(email)
        return w

    def _email_page(self) -> QWidget:
        w = QWidget()
        v = QVBoxLayout(w)
        v.setContentsMargins(0, 0, 0, 0)
        v.addWidget(QLabel("We'll email you a 6-digit code."))
        row = QHBoxLayout()
        self.email = QLineEdit(self.cfg.account_email)
        self.email.setPlaceholderText("you@example.com")
        self.email.returnPressed.connect(self.send_code)
        self.send_btn = QPushButton("Send code")
        self.send_btn.clicked.connect(self.send_code)
        row.addWidget(self.email, 1)
        row.addWidget(self.send_btn)
        v.addLayout(row)

        self.code_row = QWidget()
        cr = QHBoxLayout(self.code_row)
        cr.setContentsMargins(0, 0, 0, 0)
        self.code = QLineEdit()
        self.code.setPlaceholderText("6-digit code")
        self.code.setMaxLength(6)
        self.code.setValidator(QRegularExpressionValidator(QRegularExpression(r"\d{0,6}"), self.code))
        self.code.textChanged.connect(lambda t: self.verify_btn.setEnabled(len(t) == 6))
        self.code.returnPressed.connect(self.verify_code)
        self.verify_btn = QPushButton("Sign in")
        self.verify_btn.setObjectName("primary")
        self.verify_btn.setEnabled(False)
        self.verify_btn.clicked.connect(self.verify_code)
        cr.addWidget(self.code, 1)
        cr.addWidget(self.verify_btn)
        self.code_row.hide()
        v.addWidget(self.code_row)

        self.email_status = QLabel()
        self.email_status.setObjectName("muted")
        self.email_status.setWordWrap(True)
        self.email_status.hide()
        v.addWidget(self.email_status)
        back = _link("Sign in with the browser instead")
        back.clicked.connect(self.show_start)
        v.addWidget(back)
        return w

    # ---- helpers ---------------------------------------------------------
    def _show_error(self, msg: str = ""):
        self.error.setText(msg)
        self.error.setVisible(bool(msg))
        self.adjustSize()

    def _set_page(self, index: int):
        """Show one page and size the dialog to it (a stack is otherwise as tall as its tallest page)."""
        for i in range(self.stack.count()):
            pol = QSizePolicy.Preferred if i == index else QSizePolicy.Ignored
            self.stack.widget(i).setSizePolicy(pol, pol)
        self.stack.setCurrentIndex(index)
        self.adjustSize()

    def _stop_poller(self):
        if self.poller is not None:
            self.poller.cancel()
            self.poller = None

    def show_start(self):
        self._stop_poller()
        self._show_error()
        self.signin_btn.setEnabled(True)
        self.signin_btn.setText("Sign in to Polish")
        self._set_page(0)

    def show_email(self):
        self._stop_poller()
        self._show_error()
        self._set_page(2)
        self.email.setFocus()

    # ---- browser sign-in -------------------------------------------------
    def start_device(self):
        self._show_error()
        self.signin_btn.setEnabled(False)
        self.signin_btn.setText("Starting…")
        background.start(self.client.device_start, on_done=self._device_started, on_failed=self._device_failed)

    def _device_started(self, info: dict):
        self.verification_url = info.get("verification_url", "")
        self.code_label.setText(info.get("user_code", ""))
        self._set_page(1)
        if self.verification_url:
            open_url(self.verification_url)
        self.poller = DevicePoller(self.client, info["device_code"], info.get("interval", 3),
                                   info.get("expires_in", 600))
        self.poller.signed_in.connect(self._finish)
        self.poller.failed.connect(self._poll_failed)
        self.poller.finished.connect(self.poller.deleteLater)
        self.poller.start()

    def _poll_failed(self, err):
        if self.sender() is self.poller:  # ignore an older attempt that was cancelled
            self._device_failed(err)

    def _device_failed(self, err):
        self.show_start()
        if isinstance(err, SignInExpired):
            msg = "The sign-in request expired. Click Sign in to Polish to try again."
        elif isinstance(err, SignInDenied):
            msg = "Sign-in was declined in the browser. Click Sign in to Polish to try again."
        else:
            msg = str(err)
        self._show_error(msg)

    # ---- email code ------------------------------------------------------
    def send_code(self):
        addr = self.email.text().strip()
        if "@" not in addr or "." not in addr.split("@")[-1]:
            self._show_error("Enter a valid email address.")
            return
        self._show_error()
        self.send_btn.setEnabled(False)
        self.send_btn.setText("Sending…")
        background.start(self.client.email_start, addr, on_done=self._code_sent, on_failed=self._email_failed)

    def _code_sent(self, _):
        self.send_btn.setEnabled(True)
        self.send_btn.setText("Send again")
        self.code_row.show()
        self.email_status.setText(f"We sent a code to {self.email.text().strip()}. It's valid for 10 minutes.")
        self.email_status.show()
        self.adjustSize()
        self.code.setFocus()

    def verify_code(self):
        if len(self.code.text()) != 6:
            return
        self._show_error()
        self.verify_btn.setEnabled(False)
        self.verify_btn.setText("Signing in…")
        background.start(self.client.email_verify, self.email.text().strip(), self.code.text(),
                         on_done=self._finish, on_failed=self._email_failed)

    def _email_failed(self, err):
        self.send_btn.setEnabled(True)
        self.send_btn.setText("Send again" if self.code_row.isVisible() else "Send code")
        self.verify_btn.setEnabled(len(self.code.text()) == 6)
        self.verify_btn.setText("Sign in")
        self._show_error(str(err))

    # ---- done ------------------------------------------------------------
    def _finish(self, bundle: dict):
        self._stop_poller()
        self.cfg.account_email = ((bundle or {}).get("user") or {}).get("email", "") or self.cfg.account_email
        config_mod.save(self.cfg)
        self.accept()

    def done(self, result):
        self._stop_poller()
        super().done(result)
