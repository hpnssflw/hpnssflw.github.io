"""Telegram Bot API delivery for the research digest.

# TODO: not yet verified against a real channel -- TELEGRAM_BOT_TOKEN isn't
# in agent/.env yet, and agent/defaults.yaml's delivery.telegram_channel is
# still the "@REPLACE_ME" placeholder. Once the bot is created (via
# @BotFather), the channel exists, and the bot is added as a channel admin
# (see docs/superpowers/specs/2026-09-17-telegram-delivery-design.md §
# Prerequisite), set both and run `python -m agent --topic <slug>` to send
# a live digest and confirm it lands in the channel.
"""

from __future__ import annotations

import os

import requests

from agent.config import Settings

SEND_MESSAGE_URL = "https://api.telegram.org/bot{token}/sendMessage"


def send(messages: list[str], settings: Settings) -> None:
    token = os.environ["TELEGRAM_BOT_TOKEN"]
    url = SEND_MESSAGE_URL.format(token=token)
    for message in messages:
        response = requests.post(
            url,
            json={
                "chat_id": settings.delivery.telegram_channel,
                "text": message,
                "parse_mode": "HTML",
                "disable_web_page_preview": True,
            },
            timeout=10,
        )
        response.raise_for_status()
