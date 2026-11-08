import pytest

from wa_core.errors import EmptySelection, TextTooLong
from wa_core.textutil import check_length, detect_direction, normalize_newlines


@pytest.mark.parametrize("text,d", [("שלום עולם", "rtl"), ("Hello world", "ltr"),
                                    ("שלום עולם, this is mostly hebrew טקסט ארוך", "rtl"),
                                    ("Meeting with ד\"ר כהן at 10", "ltr"), ("12345", "ltr"), ("", "ltr")])
def test_direction(text, d):
    assert detect_direction(text) == d


def test_length():
    assert check_length("a" * 10, 10)
    with pytest.raises(TextTooLong):
        check_length("a" * 11, 10)
    with pytest.raises(EmptySelection):
        check_length("   \n", 10)


def test_newlines():
    assert normalize_newlines("a\r\nb\rc") == "a\nb\nc"
