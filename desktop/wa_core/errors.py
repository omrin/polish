"""User-facing error hierarchy. `str(err)` is safe to show in a toast or card."""


class WAError(Exception):
    code = "error"
    default_message = "Something went wrong."

    def __init__(self, message: str | None = None):
        super().__init__(message or self.default_message)


class NoApiKey(WAError):
    code = "no_api_key"
    default_message = "Add your Anthropic API key in Settings."


class EmptySelection(WAError):
    code = "empty_selection"
    default_message = "Select some text first."


class TextTooLong(WAError):
    code = "too_long"
    default_message = "The text is too long. Select a smaller part."


class ApiAuth(WAError):
    code = "auth"
    default_message = "Invalid API key."


class ApiRateLimit(WAError):
    code = "rate_limit"
    default_message = "Rate limited - try again in a few seconds."


class ApiNetwork(WAError):
    code = "network"
    default_message = "Can't reach the Anthropic API (check your connection or proxy)."


class ApiRefused(WAError):
    code = "refusal"
    default_message = "Claude declined to process this text."


class BadResponse(WAError):
    code = "bad_response"
    default_message = "Unexpected response - try again or shorten the text."


# ---- Polish account (server) errors ----------------------------------------

class SignedOut(WAError):
    code = "signed_out"
    default_message = "Sign in to Polish to continue."


class NoCredits(WAError):
    code = "no_credits"
    default_message = "You're out of credits."

    def __init__(self, message: str | None = None, buy_url: str = "", balance: int | None = None):
        super().__init__(message)
        self.buy_url = buy_url
        self.balance = balance


class ServerUnreachable(WAError):
    code = "server_unreachable"
    default_message = "Can't reach the Polish service. Check your connection."


class AccountDisabled(WAError):
    code = "account_disabled"
    default_message = "This account is disabled. Contact support."


class ServicePaused(WAError):
    code = "service_paused"
    default_message = "Polish is paused for maintenance. Try again later."


class UpstreamError(WAError):
    code = "upstream_error"
    default_message = "The AI service didn't respond. Try again."


class SignInExpired(WAError):
    code = "expired"
    default_message = "This sign-in request has expired. Try again."


class SignInDenied(WAError):
    code = "denied"
    default_message = "Sign-in was declined in the browser."


class InvalidCode(WAError):
    code = "invalid_code"
    default_message = "That code isn't right. Check the email or ask for a new code."
