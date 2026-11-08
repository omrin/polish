from PySide6.QtCore import Qt
from PySide6.QtGui import QCursor
from PySide6.QtWidgets import QLabel


class BusyIndicator(QLabel):
    def __init__(self):
        super().__init__("  ✦ Polishing…  ")
        self.setWindowFlags(Qt.ToolTip | Qt.FramelessWindowHint | Qt.WindowStaysOnTopHint)
        self.setAttribute(Qt.WA_ShowWithoutActivating)
        self.setStyleSheet("background:qlineargradient(x1:0, y1:0, x2:1, y2:1, stop:0 #4fd3c0, stop:0.5 #3b8beb, stop:1 #6a4ce0);color:white;padding:6px 10px;border-radius:6px;font-size:13px;")

    def show_near_cursor(self):
        pos = QCursor.pos()
        self.adjustSize()
        self.move(pos.x() + 16, pos.y() + 16)
        self.show()
