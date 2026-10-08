"""The delivery stage's adapters: Telegram Bot API, or a local outbox file.

Telegram was verified against the real @hypnosisflow channel 2026-09-18:
a workflow_dispatch run of .github/workflows/agent-run.yml sent 124 items
across 5 topics with no errors, and the pending queue drained to 0.
Telegram posts go through agent/bot_api.py (429 retry, token-free errors).
"""

from __future__ import annotations

import os
import time
from pathlib import Path

from agent import bot_api
from agent.paths import DataPaths
from agent.preset import Preset

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
        for index, message in enumerate(messages):
            bot_api.call(
                token,
                "sendMessage",
                {"chat_id": self.chat, "text": message, "parse_mode": "HTML", "disable_web_page_preview": True},
            )
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
