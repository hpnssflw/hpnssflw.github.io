"""The delivery stage's adapters: Telegram Bot API, or a local outbox file.

Telegram was verified against the real @hypnosisflow channel 2026-09-18:
a workflow_dispatch run of .github/workflows/agent-run.yml sent 124 items
across 5 topics with no errors, and the pending queue drained to 0.
"""

from __future__ import annotations

import os
import time
from pathlib import Path

import requests

from agent.paths import DataPaths
from agent.preset import Preset

SEND_MESSAGE_URL = "https://api.telegram.org/bot{token}/sendMessage"

# Pause between successive messages in a multi-message batch, so we don't
# trip Telegram's flood limits on channel posts.
INTER_MESSAGE_DELAY_SECONDS = 1


class TelegramDelivery:
    label = "Telegram"

    def __init__(self, chat: str, bot_token_env: str) -> None:
        self.chat = chat
        self.bot_token_env = bot_token_env

    def send(self, messages: list[str], run_id: str) -> None:
        token = os.environ[self.bot_token_env]
        url = SEND_MESSAGE_URL.format(token=token)
        for index, message in enumerate(messages):
            _send_one(url, message, self.chat)
            if index < len(messages) - 1:
                time.sleep(INTER_MESSAGE_DELAY_SECONDS)


class FileDelivery:
    """Writes the digest to <data-dir>/outbox/<run_id>.html, messages
    separated by <hr> -- the demo presets' delivery target."""

    label = "File"

    def __init__(self, outbox: Path) -> None:
        self.outbox = outbox

    def send(self, messages: list[str], run_id: str) -> None:
        self.outbox.mkdir(parents=True, exist_ok=True)
        (self.outbox / f"{run_id}.html").write_text(
            "\n\n<hr>\n\n".join(messages) + "\n", encoding="utf-8", newline="\n"
        )


def delivery_for(preset: Preset, paths: DataPaths) -> TelegramDelivery | FileDelivery:
    if preset.delivery.type == "telegram":
        return TelegramDelivery(preset.delivery.chat, preset.delivery.bot_token_env)
    return FileDelivery(paths.outbox)


def _send_one(url: str, message: str, chat: str) -> None:
    """POST a single message, retrying exactly once if Telegram responds
    429 (flood limit) with a retry_after hint. Any other failure -- or a
    second failure after the retry -- propagates as a RuntimeError whose
    message never contains the bot token or the request URL (only the
    HTTP status and Telegram's own JSON error body, which are safe to log
    -- see docs/superpowers/specs/2026-09-17-telegram-delivery-design.md)."""
    try:
        response = _post(url, message, chat)
        if response.status_code == 429:
            retry_after = _retry_after_seconds(response)
            time.sleep(retry_after)
            response = _post(url, message, chat)
        response.raise_for_status()
    except requests.RequestException as exc:
        raise RuntimeError(_safe_error_message(exc)) from None


def _post(url: str, message: str, chat: str) -> requests.Response:
    return requests.post(
        url,
        json={
            "chat_id": chat,
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
