from PySide6.QtCore import QThread, Signal

from wa_core.analyze import analyze
from wa_core.errors import WAError


class AnalyzeWorker(QThread):
    done = Signal(object, str)   # AnalysisResult, original text
    failed = Signal(object)      # WAError

    def __init__(self, selection_service, mode, cfg, text=None, account_client=None, parent=None):
        super().__init__(parent)
        self.selection = selection_service
        self.mode = mode
        self.cfg = cfg
        self.text = text
        self.account_client = account_client

    def run(self):
        try:
            text = self.text if self.text is not None else self.selection.capture_selection()
            api_mode = "rephrase" if self.mode == "rephrase" else "fix"
            result = analyze(text, api_mode, self.cfg, self.account_client)
            self.done.emit(result, text)
        except WAError as err:
            self.failed.emit(err)
        except Exception as exc:  # never let the worker thread die silently
            self.failed.emit(WAError(f"Unexpected error: {exc}"))
