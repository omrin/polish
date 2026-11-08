import json

import pytest

from wa_core.errors import BadResponse
from wa_core.schema import parse_response

ORIG = "I has a apple and I wnat to eat it."


def test_valid_fixture(fixture_text):
    r = parse_response(fixture_text("response_en.json"), ORIG)
    assert r.corrected_text == "I have an apple and I want to eat it."
    assert len(r.corrections) == 3 and r.has_changes and r.rephrasings == []


def test_missing_rephrasings_defaults_to_empty():
    r = parse_response(json.dumps({"corrected_text": ORIG, "corrections": []}), ORIG)
    assert r.rephrasings == [] and r.has_changes is False


def test_invalid_type_enum():
    raw = json.dumps({"corrected_text": "x", "corrections": [
        {"original": "I", "replacement": "x", "type": "tone", "explanation": ""}], "rephrasings": []})
    with pytest.raises(BadResponse):
        parse_response(raw, ORIG)


def test_drops_corrections_not_in_input():
    raw = json.dumps({"corrected_text": "x", "corrections": [
        {"original": "I has", "replacement": "I have", "type": "grammar", "explanation": "."},
        {"original": "nonexistent", "replacement": "y", "type": "spelling", "explanation": "."}],
        "rephrasings": []})
    r = parse_response(raw, ORIG)
    assert [c.original for c in r.corrections] == ["I has"] and r.dropped_corrections == 1


@pytest.mark.parametrize("raw", ["not json", "[]", '{"corrections": []}'])
def test_bad_json(raw):
    with pytest.raises(BadResponse):
        parse_response(raw, ORIG)


def test_hebrew(fixture_text):
    r = parse_response(fixture_text("response_he.json"), "אני הולכת לבית הספר מחר.")
    assert r.corrections[0].replacement == "הולך"
