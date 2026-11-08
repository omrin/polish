import pytest

from wa_core.errors import EmptySelection
from wa_desktop.selection import SelectionService


class FakeClock:
    def __init__(self): self.t = 0.0
    def sleep(self, s): self.t += s
    def now(self): return self.t


class FakeClipboard:
    def __init__(self, text=""): self.text = text; self.history = []
    def get(self): return self.text
    def set(self, t): self.text = t; self.history.append(t)


class FakeKeyboard:
    """Simulates the focused app: on copy, puts `selected` on the clipboard (if any)."""
    def __init__(self, clipboard, selected):
        self.cb, self.selected, self.events = clipboard, selected, []
    def release_modifiers(self): self.events.append("release")
    def copy(self):
        self.events.append("copy")
        if self.selected is not None:
            self.cb.set(self.selected)
    def paste(self): self.events.append(("paste", self.cb.get()))


class FakeFocus:
    def __init__(self, ok=True): self.ok = ok
    def get_foreground(self): return 42
    def restore(self, h): return self.ok


def make(selected, clip="user clipboard", focus_ok=True):
    cb, clk = FakeClipboard(clip), FakeClock()
    kb = FakeKeyboard(cb, selected)
    return SelectionService(cb, kb, FakeFocus(focus_ok), sleep=clk.sleep, clock=clk.now), cb, kb


def test_capture_restores_clipboard():
    svc, cb, kb = make("hello\r\nworld")
    assert svc.capture_selection() == "hello\nworld"
    assert cb.text == "user clipboard"
    assert kb.events[:2] == ["release", "copy"]


@pytest.mark.parametrize("selected", [None, "   "])
def test_empty_selection(selected):
    svc, cb, _ = make(selected)
    with pytest.raises(EmptySelection):
        svc.capture_selection()
    assert cb.text == "user clipboard"


def test_replace_pastes_and_restores():
    svc, cb, kb = make("x")
    assert svc.replace_selection("new text", focus_handle=42) is True
    assert ("paste", "new text") in kb.events
    assert cb.text == "user clipboard"


def test_replace_focus_fail_leaves_text_on_clipboard():
    svc, cb, kb = make("x", focus_ok=False)
    assert svc.replace_selection("new text", focus_handle=42) is False
    assert cb.text == "new text" and not any(isinstance(e, tuple) for e in kb.events)
