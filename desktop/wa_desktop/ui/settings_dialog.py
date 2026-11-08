from PySide6.QtWidgets import (QCheckBox, QComboBox, QDialog, QDialogButtonBox, QFormLayout,
                               QLabel, QLineEdit, QSpinBox)

from wa_core import config as config_mod

MODELS = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"]


class SettingsDialog(QDialog):
    def __init__(self, cfg, parent=None):
        super().__init__(parent)
        self.cfg = cfg
        self.setWindowTitle("Writing Assistant - Settings")
        self.setMinimumWidth(480)
        form = QFormLayout(self)

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

        self.hk = {}
        for mode, label in (("fix", "Fix (popup)"), ("fix_instant", "Fix & replace instantly"),
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

        self.fallback = QCheckBox("If Claude declines, retry on a fallback model (server-side)")
        self.fallback.setChecked(cfg.refusal_fallback)
        form.addRow("", self.fallback)

        note = QLabel("<small>⚠ Selected text is sent to Anthropic's API. Don't use on patient-identifiable "
                      "information unless your organization permits it. The key is stored in "
                      f"{config_mod.default_path()}.</small>")
        note.setWordWrap(True)
        form.addRow(note)

        buttons = QDialogButtonBox(QDialogButtonBox.Save | QDialogButtonBox.Cancel)
        buttons.accepted.connect(self.accept)
        buttons.rejected.connect(self.reject)
        form.addRow(buttons)

    def apply(self):
        c = self.cfg
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
