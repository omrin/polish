from PySide6.QtCore import Qt, Signal
from PySide6.QtGui import QCursor, QGuiApplication, QKeySequence, QShortcut
from PySide6.QtWidgets import (QButtonGroup, QFrame, QHBoxLayout, QLabel, QPushButton,
                               QRadioButton, QScrollArea, QTextBrowser, QVBoxLayout, QWidget)

from .diff_render import diff_html

TYPE_COLORS = {"spelling": "#c62828", "grammar": "#1565c0", "punctuation": "#6a1b9a", "style": "#ef6c00"}


class SuggestionPopup(QWidget):
    replace_requested = Signal(str)
    copy_requested = Signal(str)

    def __init__(self):
        super().__init__()
        self.setWindowFlags(Qt.Tool | Qt.FramelessWindowHint | Qt.WindowStaysOnTopHint)
        self.setObjectName("popup")
        self.setStyleSheet("""
            #popup { background:#ffffff; border:1px solid #cfd8dc; border-radius:10px; }
            QLabel#h { font-weight:600; color:#37474f; margin-top:6px; }
            QPushButton { padding:6px 14px; border-radius:6px; border:1px solid #b0bec5; background:#f5f7f8; }
            QPushButton#primary { background:#15c39a; color:white; border:none; font-weight:600; }
            QRadioButton { padding:4px; }
        """)
        self.setMinimumWidth(460)
        self.setMaximumWidth(620)
        self._candidates: list[str] = []
        self._align = Qt.AlignLeft
        outer = QVBoxLayout(self)
        outer.setContentsMargins(14, 12, 14, 12)
        self.title = QLabel()
        self.title.setStyleSheet("font-size:14px;font-weight:700;color:#15c39a;")
        outer.addWidget(self.title)

        scroll = self.scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        scroll.setFrameShape(QFrame.NoFrame)
        scroll.setMaximumHeight(520)
        outer.addWidget(scroll)

        buttons = QHBoxLayout()
        self.replace_btn = QPushButton("Replace")
        self.replace_btn.setObjectName("primary")
        self.copy_btn = QPushButton("Copy")
        close_btn = QPushButton("Close")
        buttons.addStretch(1)
        for b in (close_btn, self.copy_btn, self.replace_btn):
            buttons.addWidget(b)
        outer.addLayout(buttons)

        self.replace_btn.clicked.connect(lambda: self._emit(self.replace_requested))
        self.copy_btn.clicked.connect(lambda: self._emit(self.copy_requested))
        close_btn.clicked.connect(self.hide)
        QShortcut(QKeySequence(Qt.Key_Escape), self, activated=self.hide)
        QShortcut(QKeySequence(Qt.Key_Return), self, activated=lambda: self._emit(self.replace_requested))
        self.group = QButtonGroup(self)

    def _clear(self):
        """Start a fresh body widget (children of a not-yet-shown widget count toward sizeHint)."""
        for b in self.group.buttons():
            self.group.removeButton(b)
        self._candidates = []
        body = QWidget()
        body.setObjectName("body")
        body.setStyleSheet("#body { background:#ffffff; }")
        self.body = QVBoxLayout(body)
        self.body.setContentsMargins(0, 0, 0, 0)
        old = self.scroll.takeWidget()
        if old is not None:
            old.deleteLater()
        self._pending_body = body

    def _heading(self, text):
        lbl = QLabel(text)
        lbl.setAlignment(self._align)
        lbl.setObjectName("h")
        self.body.addWidget(lbl)

    def show_result(self, result, original: str, direction: str, mode: str, model: str):
        self._clear()
        rtl = direction == "rtl"
        self.setLayoutDirection(Qt.RightToLeft if rtl else Qt.LeftToRight)
        self.title.setText(("Rephrase" if mode == "rephrase" else "Grammar & spelling") + f"  ·  {model}")
        align = self._align = Qt.AlignRight if rtl else Qt.AlignLeft

        # Option 0: corrected text (shown as diff)
        self._heading("Corrected" if result.has_changes else "No issues found ✓")
        corrected_radio = QRadioButton("Use corrected text")
        corrected_radio.setChecked(True)
        self.group.addButton(corrected_radio, 0)
        self._candidates.append(result.corrected_text)
        view = QTextBrowser()
        opt = view.document().defaultTextOption()
        opt.setTextDirection(Qt.RightToLeft if rtl else Qt.LeftToRight)
        opt.setAlignment(align)
        view.document().setDefaultTextOption(opt)
        view.setHtml(diff_html(original, result.corrected_text, direction))
        view.setFrameShape(QFrame.NoFrame)
        view.setStyleSheet("background:#fafbfb;border-radius:6px;padding:4px;font-size:13px;")
        view.document().setTextWidth(430)
        view.setFixedHeight(int(min(max(view.document().size().height() + 14, 40), 220)))
        self.body.addWidget(view)
        if result.rephrasings:
            self.body.addWidget(corrected_radio)

        if result.corrections:
            self._heading(f"Fixes ({len(result.corrections)})")
            for c in result.corrections:
                color = TYPE_COLORS.get(c.type, "#455a64")
                lbl = QLabel(
                    f'<span style="color:{color};font-weight:600">{c.type}</span>&nbsp; '
                    f'<s>{_esc(c.original)}</s> → <b>{_esc(c.replacement)}</b><br>'
                    f'<span style="color:#607d8b">{_esc(c.explanation)}</span>')
                lbl.setWordWrap(True)
                lbl.setAlignment(align)
                lbl.setTextFormat(Qt.RichText)
                self.body.addWidget(lbl)

        if result.rephrasings:
            self._heading("Alternatives")
            for idx, r in enumerate(result.rephrasings, start=1):
                rb = QRadioButton(r.label)
                rb.setStyleSheet("font-weight:600")
                self.group.addButton(rb, idx)
                self._candidates.append(r.text)
                self.body.addWidget(rb)
                txt = QLabel(r.text)
                txt.setWordWrap(True)
                txt.setAlignment(align)
                txt.setTextInteractionFlags(Qt.TextSelectableByMouse)
                txt.setStyleSheet("background:#f5f7f8;border-radius:6px;padding:6px;")
                txt.mousePressEvent = lambda e, b=rb: b.setChecked(True)
                self.body.addWidget(txt)

        self.replace_btn.setEnabled(result.has_changes or bool(result.rephrasings))
        self.body.addStretch(1)
        body = self._pending_body
        lay = body.layout()
        width = max(self.width(), self.minimumWidth()) - 28
        h = lay.totalHeightForWidth(width) if lay.hasHeightForWidth() else body.sizeHint().height()
        self.scroll.setFixedHeight(min(h + 12, 520))
        self.scroll.setWidget(body)
        self.adjustSize()
        self.resize(self.width(), self.minimumSizeHint().height())
        self._place()
        self.show()
        self.raise_()
        self.activateWindow()

    def selected_text(self) -> str:
        idx = self.group.checkedId()
        return self._candidates[idx if 0 <= idx < len(self._candidates) else 0]

    def _emit(self, signal):
        if self._candidates:
            signal.emit(self.selected_text())

    def _place(self):
        pos = QCursor.pos()
        screen = QGuiApplication.screenAt(pos) or QGuiApplication.primaryScreen()
        geo = screen.availableGeometry()
        x = min(max(pos.x() + 12, geo.left()), geo.right() - self.width())
        y = pos.y() + 18
        if y + self.height() > geo.bottom():
            y = max(geo.top(), pos.y() - self.height() - 12)
        self.move(x, y)


def _esc(s: str) -> str:
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
