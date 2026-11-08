import re

from .errors import EmptySelection, TextTooLong

_HEBREW = re.compile(r"[֐-׿יִ-ﭏ]")
_LETTER = re.compile(r"[^\W\d_]", re.UNICODE)


def hebrew_ratio(text: str) -> float:
    letters = _LETTER.findall(text)
    if not letters:
        return 0.0
    return sum(1 for ch in letters if _HEBREW.match(ch)) / len(letters)


def detect_direction(text: str) -> str:
    """'rtl' when more than 30% of the letters are Hebrew, else 'ltr'."""
    return "rtl" if hebrew_ratio(text) > 0.3 else "ltr"


def normalize_newlines(text: str) -> str:
    return text.replace("\r\n", "\n").replace("\r", "\n")


def check_length(text: str, max_chars: int) -> str:
    if not text or not text.strip():
        raise EmptySelection()
    if len(text) > max_chars:
        raise TextTooLong(
            f"Selection is {len(text):,} characters; limit is {max_chars:,}. Select a smaller part."
        )
    return text
