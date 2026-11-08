"""Small interfaces over OS services so selection logic can be unit-tested with fakes."""
from typing import Any, Protocol


class ClipboardPort(Protocol):
    def get(self) -> str: ...
    def set(self, text: str) -> None: ...


class KeyboardPort(Protocol):
    def release_modifiers(self) -> None: ...
    def copy(self) -> None: ...   # Ctrl+C / Cmd+C
    def paste(self) -> None: ...  # Ctrl+V / Cmd+V


class FocusPort(Protocol):
    def get_foreground(self) -> Any: ...
    def restore(self, handle: Any) -> bool: ...
