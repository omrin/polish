import json
import logging
from typing import Literal

from pydantic import BaseModel, Field, ValidationError

from .errors import BadResponse

log = logging.getLogger(__name__)


class Correction(BaseModel):
    original: str
    replacement: str
    type: Literal["spelling", "grammar", "punctuation", "style"]
    explanation: str


class Rephrasing(BaseModel):
    label: str
    text: str


class AnalysisResult(BaseModel):
    corrected_text: str
    corrections: list[Correction] = Field(default_factory=list)
    rephrasings: list[Rephrasing] = Field(default_factory=list)
    has_changes: bool = False
    dropped_corrections: int = 0


def parse_response(raw: str, original_text: str) -> AnalysisResult:
    try:
        data = json.loads(raw)
        if not isinstance(data, dict):
            raise BadResponse()
        data.setdefault("rephrasings", [])
        result = AnalysisResult.model_validate(data)
    except (json.JSONDecodeError, ValidationError) as exc:
        log.warning("bad response from API: %s\nraw=%r", exc, raw[:2000])
        raise BadResponse() from exc

    kept = [c for c in result.corrections if c.original and c.original in original_text]
    result.dropped_corrections = len(result.corrections) - len(kept)
    result.corrections = kept
    result.has_changes = result.corrected_text != original_text
    return result
