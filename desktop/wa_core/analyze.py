"""One entry point for a check: through the Polish service, or straight to Anthropic with the user's key."""
from . import claude_client
from .config import Config
from .errors import SignedOut
from .schema import AnalysisResult


def analyze(text: str, mode: str, cfg: Config, account_client=None) -> AnalysisResult:
    """mode is "fix" or "rephrase"."""
    if cfg.auth_mode == "api_key":
        return claude_client.analyze(text, mode, cfg)
    if account_client is None:
        raise SignedOut()
    return account_client.analyze(text, mode, cfg)
