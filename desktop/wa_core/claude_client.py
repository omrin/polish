"""Calls the Claude API and turns the structured JSON reply into an AnalysisResult."""
import logging

import anthropic

from . import shared_data
from .config import Config
from .errors import (ApiAuth, ApiNetwork, ApiRateLimit, ApiRefused, BadResponse,
                     NoApiKey, TextTooLong)
from .prompt import build_system_prompt, build_user_message
from .schema import AnalysisResult, parse_response
from .textutil import check_length

log = logging.getLogger(__name__)

FALLBACK_BETA = "server-side-fallback-2026-07-01"


def _make_client(api_key: str) -> anthropic.Anthropic:
    return anthropic.Anthropic(
        api_key=api_key, timeout=shared_data.limits()["timeout_seconds"], max_retries=2
    )


def build_request(text: str, mode: str, cfg: Config) -> dict:
    model = cfg.active_model
    req = dict(
        model=model,
        max_tokens=16000,
        system=build_system_prompt(mode, cfg.labels, cfg.explanation_language),
        messages=[{"role": "user", "content": build_user_message(text)}],
        output_config={
            "effort": "low",
            "format": {"type": "json_schema", "schema": shared_data.schema()},
        },
    )
    if cfg.refusal_fallback and model in shared_data.load()["fallback_models"]:
        # On a safety decline the API re-runs the request on a fallback model in the same call.
        req["betas"] = [FALLBACK_BETA]
        req["fallbacks"] = "default"
    return req


def analyze(text: str, mode: str, cfg: Config, client: anthropic.Anthropic | None = None) -> AnalysisResult:
    key = cfg.effective_api_key
    if not key:
        raise NoApiKey()
    check_length(text, cfg.max_chars)
    client = client or _make_client(key)
    req = build_request(text, mode, cfg)
    try:
        if "betas" in req:
            resp = client.beta.messages.create(**req)
        else:
            resp = client.messages.create(**req)
    except anthropic.AuthenticationError as exc:
        raise ApiAuth() from exc
    except anthropic.PermissionDeniedError as exc:
        raise ApiAuth("This API key isn't allowed to use that model.") from exc
    except anthropic.RateLimitError as exc:
        raise ApiRateLimit() from exc
    except anthropic.APIStatusError as exc:
        msg = getattr(exc, "message", "") or str(exc)
        raise ApiNetwork(f"API error {exc.status_code}: {msg}") from exc
    except (anthropic.APIConnectionError, anthropic.APITimeoutError) as exc:
        raise ApiNetwork() from exc

    if resp.stop_reason == "refusal":
        raise ApiRefused()
    if resp.stop_reason == "max_tokens":
        raise TextTooLong("The response was cut off - select a shorter piece of text.")
    raw = next((b.text for b in resp.content if getattr(b, "type", None) == "text"), None)
    if raw is None:
        raise BadResponse()
    return parse_response(raw, original_text=text)
