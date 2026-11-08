"""Run a blocking call (network) off the UI thread and get the result back as a signal."""
from PySide6.QtCore import QThread, Signal

from wa_core.errors import WAError


class Task(QThread):
    done = Signal(object)
    failed = Signal(object)  # WAError

    def __init__(self, fn, *args, parent=None):
        super().__init__(parent)
        self.fn, self.args = fn, args

    def run(self):
        try:
            self.done.emit(self.fn(*self.args))
        except WAError as err:
            self.failed.emit(err)
        except Exception as exc:  # never let the thread die silently
            self.failed.emit(WAError(f"Unexpected error: {exc}"))


_running: set = set()  # module-level so a task outlives a dialog closed while it runs


def start(fn, *args, on_done=None, on_failed=None) -> Task:
    """Start a Task and keep a reference to it until it finishes."""
    task = Task(fn, *args)
    tasks = _running
    tasks.add(task)
    if on_done:
        task.done.connect(on_done)
    if on_failed:
        task.failed.connect(on_failed)
    task.finished.connect(lambda: tasks.discard(task))
    task.start()
    return task
