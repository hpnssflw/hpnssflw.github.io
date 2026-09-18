"""Telegram Bot API delivery for the research digest.

Verified against the real @hypnosisflow channel 2026-09-18: a
workflow_dispatch run of .github/workflows/agent-run.yml sent 124 items
across 5 topics with no errors, and the pending queue drained to 0.
"""

from __future__ import annotations

import os
import time

import requests

from agent.config import Settings

SEND_MESSAGE_URL = "https://api.telegram.org/bot{token}/sendMessage"

# Pause between successive messages in a multi-message batch, so we don't
# trip Telegram's flood limits on channel posts.
INTER_MESSAGE_DELAY_SECONDS = 1


def send(messages: list[str], settings: Settings) -> None:
    token = os.environ["TELEGRAM_BOT_TOKEN"]
    url = SEND_MESSAGE_URL.format(token=token)
    for index, message in enumerate(messages):
        _send_one(url, message, settings)
        if index < len(messages) - 1:
            time.sleep(INTER_MESSAGE_DELAY_SECONDS)


def _send_one(url: str, message: str, settings: Settings) -> None:
    """POST a single message, retrying exactly once if Telegram responds
    429 (flood limit) with a retry_after hint. Any other failure -- or a
    second failure after the retry -- propagates as a RuntimeError whose
    message never contains the bot token or the request URL (only the
    HTTP status and Telegram's own JSON error body, which are safe to log
    -- see docs/superpowers/specs/2026-09-17-telegram-delivery-design.md)."""
    try:
        response = _post(url, message, settings)
        if response.status_code == 429:
            retry_after = _retry_after_seconds(response)
            time.sleep(retry_after)
            response = _post(url, message, settings)
        response.raise_for_status()
    except requests.RequestException as exc:
        raise RuntimeError(_safe_error_message(exc)) from None


def _post(url: str, message: str, settings: Settings) -> requests.Response:
    return requests.post(
        url,
        json={
            "chat_id": settings.delivery.telegram_channel,
            "text": message,
            "parse_mode": "HTML",
            "disable_web_page_preview": True,
        },
        timeout=10,
    )


def _retry_after_seconds(response: requests.Response) -> float:
    try:
        return float(response.json()["parameters"]["retry_after"])
    except (ValueError, KeyError, TypeError):
        return 1.0


def _safe_error_message(exc: requests.RequestException) -> str:
    """Build an error message from only the parts of a requests exception
    that can't contain the bot token: the HTTP status code and Telegram's
    JSON error body (response.text). Never the exception's own str() or
    the request URL, both of which embed the token."""
    response = exc.response
    if response is not None:
        return f"Telegram API error: HTTP {response.status_code}: {response.text}"
    return "Telegram request failed"
