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
