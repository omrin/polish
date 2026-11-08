import webbrowser

from PySide6.QtWidgets import (QButtonGroup, QCheckBox, QComboBox, QDialog, QDialogButtonBox, QFormLayout,
                               QGroupBox, QHBoxLayout, QLabel, QLineEdit, QPushButton, QRadioButton,
                               QSpinBox, QVBoxLayout)

from wa_core import config as config_mod
from wa_core.account_client import balance_text
from wa_core.errors import SignedOut

from .. import background
from .signin_dialog import SignInDialog

MODELS = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"]

NOTE_ACCOUNT = ("<small>⚠ Selected text is sent to the Polish service, which forwards it to Anthropic's API "
                "to check it and doesn't store it. Don't use on patient-identifiable information unless "
                "your organization permits it.</small>")
NOTE_API_KEY = ("<small>⚠ Selected text is sent to Anthropic's API. Don't use on patient-identifiable "
                "information unless your organization permits it. The key is stored in {path}.</small>")


def account_status_text(email: str, usage: dict | None, signed_in: bool) -> str:
    if not signed_in:
        return "Not signed in."
    parts = [f"Signed in as {email}" if email else "Signed in"]
    if balance_text(usage):
        parts.append(balance_text(usage))
    return " · ".join(parts)


class SettingsDialog(QDialog):
    def __init__(self, cfg, account_client=None, parent=None):
        super().__init__(parent)
        self.cfg = cfg
        self.client = account_client
        self.setWindowTitle("Polish - Settings")
        self.setMinimumWidth(500)
        form = self.form = QFormLayout(self)

        # ---- how Polish connects ----
        box = QGroupBox("How Polish checks your text")
        bv = QVBoxLayout(box)
        self.mode_account = QRadioButton("Polish account (recommended)")
        self.mode_api_key = QRadioButton("My own Anthropic API key (advanced)")
        self.mode_group = QButtonGroup(self)
        self.mode_group.addButton(self.mode_account)
        self.mode_group.addButton(self.mode_api_key)
        bv.addWidget(self.mode_account)

        self.account_status = QLabel()
        self.account_status.setWordWrap(True)
        self.account_status.setStyleSheet("color:#37474f; margin-left:22px;")
        bv.addWidget(self.account_status)
        row = QHBoxLayout()
        row.setContentsMargins(22, 0, 0, 0)
        self.buy_btn = QPushButton("Buy credits")
        self.buy_btn.clicked.connect(lambda: webbrowser.open(self.cfg.buy_url))
        self.signout_btn = QPushButton("Sign out")
        self.signout_btn.clicked.connect(self.sign_out)
        self.signin_btn = QPushButton("Sign in…")
        self.signin_btn.clicked.connect(self.sign_in)
        for b in (self.signin_btn, self.buy_btn, self.signout_btn):
            row.addWidget(b)
        row.addStretch(1)
        bv.addLayout(row)
        bv.addSpacing(4)
        bv.addWidget(self.mode_api_key)
        form.addRow(box)

        # ---- own-key rows ----
        self.api_key = QLineEdit(cfg.api_key)
        self.api_key.setEchoMode(QLineEdit.Password)
        self.api_key.setPlaceholderText("sk-ant-…")
        form.addRow("Anthropic API key", self.api_key)

        self.model = QComboBox(); self.model.setEditable(True); self.model.addItems(MODELS)
        self.model.setCurrentText(cfg.model)
        form.addRow("Model", self.model)
        self.fast_model = QComboBox(); self.fast_model.setEditable(True); self.fast_model.addItems(MODELS)
        self.fast_model.setCurrentText(cfg.fast_model)
        form.addRow("Fast-mode model", self.fast_model)

        # ---- common rows ----
        self.hk = {}
        for mode, label in (("fix", "Fix (popup)"), ("fix_instant", "Fix && replace instantly"),
                            ("rephrase", "Rephrase")):
            self.hk[mode] = QLineEdit(cfg.hotkeys.get(mode, ""))
            form.addRow(f"Hotkey: {label}", self.hk[mode])
        form.addRow("", QLabel("<small>Format: &lt;ctrl&gt;+&lt;alt&gt;+g, &lt;cmd&gt;+&lt;shift&gt;+r …</small>"))

        self.labels = QLineEdit(", ".join(cfg.labels))
        form.addRow("Rephrasing styles", self.labels)

        self.lang = QComboBox()
        self.lang.addItem("Same as the text", "auto"); self.lang.addItem("English", "en"); self.lang.addItem("Hebrew", "he")
        self.lang.setCurrentIndex(max(0, self.lang.findData(cfg.explanation_language)))
        form.addRow("Explanations language", self.lang)

        self.max_chars = QSpinBox(); self.max_chars.setRange(100, 100000); self.max_chars.setValue(cfg.max_chars)
        form.addRow("Max characters", self.max_chars)

        self.fallback = QCheckBox("If Claude declines, retry on a fallback model")
        self.fallback.setChecked(cfg.refusal_fallback)
        form.addRow("", self.fallback)

        # ---- account-only row ----
        self.server_url = QLineEdit(cfg.server_url)
        self.server_url.setPlaceholderText(config_mod.Config().server_url)
        form.addRow("Service address (advanced)", self.server_url)

        self.note = QLabel()
        self.note.setWordWrap(True)
        form.addRow(self.note)

        buttons = QDialogButtonBox(QDialogButtonBox.Save | QDialogButtonBox.Cancel)
        buttons.accepted.connect(self.accept)
        buttons.rejected.connect(self.reject)
        form.addRow(buttons)

        (self.mode_api_key if cfg.auth_mode == "api_key" else self.mode_account).setChecked(True)
        self.mode_account.toggled.connect(self._mode_changed)
        self._mode_changed()
        self._refresh_account()
        if self.client is not None and self.client.signed_in:
            background.start(self.client.me, on_done=lambda _: self._refresh_account(),
                             on_failed=self._me_failed)

    # ---- account section -------------------------------------------------
    @property
    def account_mode(self) -> bool:
        return self.mode_account.isChecked()

    def _mode_changed(self, *_):
        acct = self.account_mode
        for w in (self.api_key, self.model, self.fast_model, self.fallback):
            self.form.setRowVisible(w, not acct)
        self.form.setRowVisible(self.server_url, acct)
        self.account_status.setVisible(acct)
        self._refresh_account()
        self.note.setText(NOTE_ACCOUNT if acct else NOTE_API_KEY.format(path=config_mod.default_path()))
        self.adjustSize()

    def _refresh_account(self):
        signed_in = bool(self.client and self.client.signed_in)
        email = (self.client.email if self.client else "") or self.cfg.account_email
        usage = self.client.last_usage if self.client else None
        self.account_status.setText(account_status_text(email, usage, signed_in))
        acct = self.account_mode
        self.signin_btn.setVisible(acct and not signed_in)
        self.buy_btn.setVisible(acct)
        self.signout_btn.setVisible(acct and signed_in)

    def _me_failed(self, err):
        if isinstance(err, SignedOut):
            self._refresh_account()

    def sign_in(self):
        if self.client is None:
            return
        url = self.server_url.text().strip().rstrip("/")
        if url:
            self.client.set_server_url(url)
        if SignInDialog(self.client, self.cfg, self).exec():
            self._refresh_account()

    def sign_out(self):
        if self.client is None:
            return
        self.signout_btn.setEnabled(False)
        self.cfg.account_email = ""
        config_mod.save(self.cfg)
        background.start(self.client.logout, on_done=self._signed_out, on_failed=self._signed_out)

    def _signed_out(self, _):
        self.signout_btn.setEnabled(True)
        self._refresh_account()

    def apply(self):
        c = self.cfg
        c.auth_mode = "account" if self.account_mode else "api_key"
        c.server_url = self.server_url.text().strip().rstrip("/") or config_mod.Config().server_url
        c.api_key = self.api_key.text().strip()
        c.model = self.model.currentText().strip() or c.model
        c.fast_model = self.fast_model.currentText().strip() or c.fast_model
        c.hotkeys = {m: w.text().strip() for m, w in self.hk.items()}
        c.labels = [s.strip() for s in self.labels.text().split(",") if s.strip()] or c.labels
        c.explanation_language = self.lang.currentData()
        c.max_chars = self.max_chars.value()
        c.refusal_fallback = self.fallback.isChecked()
        config_mod.save(c)
        return c
