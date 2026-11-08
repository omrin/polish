"""Talks to the Polish service: sign-in (device flow or email code), balance, and checks."""
import json
import logging
import platform
import threading
import time

import httpx2 as httpx

from . import shared_data
from .config import Config
from .errors import (AccountDisabled, ApiRateLimit, ApiRefused, BadResponse, InvalidCode, NoCredits,
                     ServerUnreachable, ServicePaused, SignedOut, SignInDenied, SignInExpired,
                     TextTooLong, UpstreamError, WAError)
from .schema import AnalysisResult, parse_response
from .textutil import check_length

log = logging.getLogger(__name__)

AUTH_TIMEOUT = 20
REFRESH_EARLY = 60  # seconds before expiry that we fetch a new access token
MAX_LABELS, MAX_LABEL_CHARS = 5, 30  # the service's limits


def default_device_name() -> str:
    return f"Polish on {platform.node() or 'this computer'}"[:80]


def checks_left_text(n) -> str:
    if n is None:
        return ""
    n = int(n)
    return f"≈ {n:,} check{'s' if n != 1 else ''} left"


def balance_text(usage: dict | None) -> str:
    """'$4.60 · ≈ 115 checks left' (100 credits = $1)."""
    if not usage or usage.get("balance_credits") is None:
        return ""
    parts = [f"${usage['balance_credits'] / 100:,.2f}"]
    if usage.get("approx_checks_left") is not None:
        parts.append(checks_left_text(usage["approx_checks_left"]))
    return " · ".join(parts)


def _usage(body: dict) -> dict | None:
    if "balance_credits" not in body:
        return None
    return {"balance_credits": body.get("balance_credits"), "approx_checks_left": body.get("approx_checks_left")}


class AccountClient:
    def __init__(self, server_url: str, token_store, http: httpx.Client | None = None):
        self.server_url = (server_url or "").rstrip("/")
        self.tokens = token_store
        self.http = http or httpx.Client(timeout=AUTH_TIMEOUT)
        self.user: dict | None = None
        self.last_usage: dict | None = None  # {"balance_credits", "approx_checks_left"}
        self._access: str | None = None
        self._access_exp = 0.0
        self._lock = threading.Lock()

    # ---- state -----------------------------------------------------------
    @property
    def signed_in(self) -> bool:
        return bool(self.tokens.load())

    @property
    def email(self) -> str:
        return (self.user or {}).get("email") or ""

    def set_server_url(self, url: str):
        url = (url or "").rstrip("/")
        if url != self.server_url:
            self.server_url = url
            self._forget_access()

    def _forget_access(self):
        self._access, self._access_exp = None, 0.0

    def _remember(self, body: dict):
        if body.get("access_token"):
            self._access = body["access_token"]
            self._access_exp = time.time() + float(body.get("expires_in") or 3600)
        if body.get("user"):
            self.user = body["user"]
        usage = _usage(body)
        if usage:
            self.last_usage = usage

    # ---- HTTP ------------------------------------------------------------
    def _request(self, method: str, path: str, body: dict | None = None, token: str | None = None,
                 timeout: float = AUTH_TIMEOUT) -> dict:
        headers = {"Authorization": f"Bearer {token}"} if token else {}
        try:
            resp = self.http.request(method, self.server_url + path, json=body, headers=headers, timeout=timeout)
        except httpx.HTTPError as exc:  # connect/read errors and timeouts
            log.info("Polish service unreachable: %s", exc)
            raise ServerUnreachable() from exc
        if resp.status_code >= 400:
            raise self._error(resp)
        try:
            data = resp.json()
        except ValueError as exc:
            raise BadResponse() from exc
        if not isinstance(data, dict):
            raise BadResponse()
        return data

    def _error(self, resp: httpx.Response) -> WAError:
        status = resp.status_code
        try:
            err = resp.json().get("error") or {}
        except (ValueError, AttributeError):
            err = {}
        if not isinstance(err, dict):
            err = {}
        code, msg = err.get("code", ""), err.get("message") or None
        if code == "invalid_code":
            return InvalidCode(msg)
        if status == 401:
            return SignedOut()
        if status == 402 or code == "insufficient_credits":
            return NoCredits(buy_url=err.get("buy_url") or shared_data.service()["buy_url"],
                             balance=err.get("balance"))
        if code == "account_disabled":
            return AccountDisabled(msg)
        if code == "denied":
            return SignInDenied(msg)
        if status == 410 or code == "expired":
            return SignInExpired(msg)
        if status == 413 or code in ("text_too_long", "too_long"):
            return TextTooLong(msg)
        if status == 429:
            return ApiRateLimit(msg or "Too many requests. Try again in a moment.")
        if code == "refusal":
            return ApiRefused(msg)
        if code == "bad_response":
            return BadResponse(msg)
        if code == "upstream_error":
            return UpstreamError(msg)
        if code == "service_paused" or (status == 503 and not code):
            return ServicePaused(msg)
        if status >= 500 and not code:  # a proxy or gateway page, not the service itself
            return ServerUnreachable()
        return WAError(msg or f"The Polish service returned an error ({status}).")

    def _authed(self, method: str, path: str, body: dict | None = None, timeout: float = AUTH_TIMEOUT) -> dict:
        """Call with the access token; on 401 refresh once and retry once."""
        token = self.access_token()  # SignedOut here means there is no usable sign-in at all
        try:
            return self._request(method, path, body, token=token, timeout=timeout)
        except SignedOut:
            self._forget_access()
        return self._request(method, path, body, token=self.access_token(force=True), timeout=timeout)

    # ---- tokens ----------------------------------------------------------
    def access_token(self, force: bool = False) -> str:
        with self._lock:
            if not force and self._access and time.time() < self._access_exp - REFRESH_EARLY:
                return self._access
            return self._refresh_locked()["access_token"]

    def refresh(self) -> dict:
        with self._lock:
            return self._refresh_locked()

    def _refresh_locked(self) -> dict:
        rt = self.tokens.load()
        if not rt:
            self._forget_access()
            raise SignedOut()
        try:
            body = self._request("POST", "/v1/auth/refresh", {"refresh_token": rt})
        except SignedOut:
            self._forget_access()
            self.tokens.clear()
            raise
        if not body.get("access_token"):
            raise BadResponse()
        self._remember(body)
        return body

    def _signed_in(self, body: dict) -> dict:
        if not body.get("refresh_token"):
            raise BadResponse()
        self.tokens.save(body["refresh_token"])
        self._remember(body)
        return body

    # ---- sign-in ---------------------------------------------------------
    def device_start(self, device_name: str | None = None) -> dict:
        """-> {device_code, user_code, verification_url, interval, expires_in}"""
        return self._request("POST", "/v1/auth/device/start",
                             {"client": "desktop", "device_name": device_name or default_device_name()})

    def device_poll(self, device_code: str):
        """-> "pending", "slow_down", or the token bundle. Raises SignInExpired / SignInDenied."""
        try:
            resp = self.http.post(self.server_url + "/v1/auth/device/token",
                                  json={"device_code": device_code}, timeout=AUTH_TIMEOUT)
        except httpx.HTTPError as exc:
            raise ServerUnreachable() from exc
        if resp.status_code == 428:
            return "pending"
        if resp.status_code == 429:
            return "slow_down"
        if resp.status_code >= 400:
            raise self._error(resp)
        try:
            body = resp.json()
        except ValueError as exc:
            raise BadResponse() from exc
        return self._signed_in(body)

    def email_start(self, email: str) -> None:
        self._request("POST", "/v1/auth/email/start", {"email": email.strip()})

    def email_verify(self, email: str, code: str, device_name: str | None = None) -> dict:
        return self._signed_in(self._request("POST", "/v1/auth/email/verify", {
            "email": email.strip(), "code": code.strip(), "client": "desktop",
            "device_name": device_name or default_device_name(),
        }))

    def logout(self) -> None:
        """Forget the sign-in here, and tell the service (best effort)."""
        rt = self.tokens.load()
        self.tokens.clear()
        self._forget_access()
        self.user, self.last_usage = None, None
        if rt:
            try:
                self._request("POST", "/v1/auth/logout", {"refresh_token": rt}, timeout=10)
            except WAError as exc:
                log.info("logout request failed: %s", exc)

    # ---- account ---------------------------------------------------------
    def me(self) -> dict:
        """-> {user, balance_credits, approx_checks_left, fast_mode_credits, packs}"""
        body = self._authed("GET", "/v1/me")
        self._remember(body)
        return body

    def analyze(self, text: str, mode: str, cfg: Config) -> AnalysisResult:
        limit = min(cfg.max_chars, shared_data.limits()["max_chars"])
        check_length(text, limit)
        labels = [str(x).strip()[:MAX_LABEL_CHARS] for x in cfg.labels if str(x).strip()][:MAX_LABELS]
        body = {
            "text": text,
            "mode": "rephrase" if mode == "rephrase" else "fix",
            "fast": bool(cfg.use_fast_model),
            "labels": labels,
            "explanation_language": cfg.explanation_language if cfg.explanation_language in ("auto", "en", "he") else "auto",
        }
        timeout = shared_data.limits()["timeout_seconds"] + 15  # the service waits up to the model's timeout
        data = self._authed("POST", "/v1/analyze", body, timeout=timeout)
        if not isinstance(data.get("result"), dict):
            raise BadResponse()
        usage = data.get("usage") or {}
        if usage.get("balance_credits") is not None:
            self.last_usage = {"balance_credits": usage["balance_credits"],
                               "approx_checks_left": usage.get("approx_checks_left")}
        return parse_response(json.dumps(data["result"]), text)
