import pytest

from wa_core.diffing import DiffOp, word_diff


def _cases():
    import json
    from pathlib import Path
    return json.loads((Path(__file__).parent / "fixtures" / "diff_cases.json").read_text(encoding="utf-8"))


@pytest.mark.parametrize("case", _cases())
def test_shared_cases(case):
    assert word_diff(case["a"], case["b"]) == [DiffOp(o, t) for o, t in case["ops"]]


@pytest.mark.parametrize("case", _cases())
def test_reconstructs_both_sides(case):
    ops = word_diff(case["a"], case["b"])
    assert "".join(o.text for o in ops if o.op != "insert") == case["a"]
    assert "".join(o.text for o in ops if o.op != "delete") == case["b"]
