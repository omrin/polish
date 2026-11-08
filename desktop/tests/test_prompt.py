import re

import pytest

from wa_core.prompt import build_system_prompt, build_user_message

LABELS = ["Formal", "Concise", "Friendly"]


def test_fix_mode_has_empty_rephrasings_instruction():
    p = build_system_prompt("fix", LABELS)
    assert "rephrasings: Return an empty array." in p


def test_rephrase_mode_lists_labels_in_order():
    p = build_system_prompt("rephrase", LABELS)
    assert "exactly 3 alternatives" in p
    assert "Formal, Concise, Friendly" in p


@pytest.mark.parametrize("lang,expected", [("auto", "the same language as the input"),
                                           ("en", "English"), ("he", "Hebrew"),
                                           ("xx", "the same language as the input")])
def test_explanation_language(lang, expected):
    assert f"written in {expected}." in build_system_prompt("fix", LABELS, lang)


@pytest.mark.parametrize("mode", ["fix", "rephrase"])
def test_no_unfilled_placeholders(mode):
    assert not re.search(r"\{[a-z_]+\}", build_system_prompt(mode, LABELS))


def test_user_message_wraps_text():
    assert build_user_message("hello\nworld") == "<text>\nhello\nworld\n</text>"


def test_unknown_mode():
    with pytest.raises(ValueError):
        build_system_prompt("translate", LABELS)
