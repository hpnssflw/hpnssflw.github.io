"""One Telegram Bot API call: a POST, a 429 retried once after its
retry_after hint, and errors that never carry the bot token -- it's in
the request URL, so neither the URL nor a requests exception's own str()
is ever used. Digest delivery (agent/deliver.py) and Telegram approval
(agent/telegram_review.py) both call through here."""

from __future__ import annotations

import time

import requests

API_URL = "https://api.telegram.org/bot{token}/{method}"
TIMEOUT_SECONDS = 10


class BotApiError(RuntimeError):
    """A failed call. str() is the HTTP status plus Telegram's JSON error
    body; .description is Telegram's own error text ("" when there is
    none). Neither contains the token."""

    def __init__(self, message: str, description: str = "") -> None:
        super().__init__(message)
        self.description = description


def call(token: str, method: str, payload: dict):
    url = API_URL.format(token=token, method=method)
    try:
        response = requests.post(url, json=payload, timeout=TIMEOUT_SECONDS)
        if response.status_code == 429:
            time.sleep(retry_after_seconds(response))
            response = requests.post(url, json=payload, timeout=TIMEOUT_SECONDS)
        response.raise_for_status()
    except requests.RequestException as exc:
        raise BotApiError(safe_error_message(exc), _description(exc.response)) from None
    body = _json(response)
    if not isinstance(body, dict) or body.get("ok") is not True:
        raise BotApiError(f"Telegram API error: {method} answered without ok", _description(response))
    return body.get("result")


def retry_after_seconds(response: requests.Response) -> float:
    try:
        return float(response.json()["parameters"]["retry_after"])
    except (ValueError, KeyError, TypeError):
        return 1.0


def safe_error_message(exc: requests.RequestException) -> str:
    """Only the parts of a requests exception that can't contain the
    token: the HTTP status and Telegram's JSON error body."""
    response = exc.response
    if response is not None:
        return f"Telegram API error: HTTP {response.status_code}: {response.text}"
    return "Telegram request failed"


def _json(response):
    try:
        return response.json()
    except ValueError:
        return None


def _description(response) -> str:
    body = _json(response) if response is not None else None
    description = body.get("description") if isinstance(body, dict) else None
    return description if isinstance(description, str) else ""
