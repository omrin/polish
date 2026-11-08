from PySide6.QtCore import Qt
from PySide6.QtGui import QCursor
from PySide6.QtWidgets import QLabel


class BusyIndicator(QLabel):
    def __init__(self):
        super().__init__("  ✎ Checking…  ")
        self.setWindowFlags(Qt.ToolTip | Qt.FramelessWindowHint | Qt.WindowStaysOnTopHint)
        self.setAttribute(Qt.WA_ShowWithoutActivating)
        self.setStyleSheet("background:#263238;color:white;padding:6px 10px;border-radius:6px;font-size:13px;")

    def show_near_cursor(self):
        pos = QCursor.pos()
        self.adjustSize()
        self.move(pos.x() + 16, pos.y() + 16)
        self.show()
