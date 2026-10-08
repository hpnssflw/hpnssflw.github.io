import pytest
import requests

from agent import bot_api
from agent.tests.conftest import FakeResponse

TOKEN = "123:secret"


def _post_returning(*responses, calls=None):
    queue = list(responses)

    def post(url, json=None, timeout=None):
        if calls is not None:
            calls.append((url, json, timeout))
        response = queue.pop(0)
        if isinstance(response, Exception):
            raise response
        return response

    return post


def test_call_posts_the_payload_and_returns_the_result(monkeypatch):
    calls = []
    monkeypatch.setattr(requests, "post", _post_returning(FakeResponse(200, {"ok": True, "result": {"message_id": 7}}), calls=calls))
    assert bot_api.call(TOKEN, "sendMessage", {"chat_id": 1, "text": "hi"}) == {"message_id": 7}
    assert calls == [("https://api.telegram.org/bot123:secret/sendMessage", {"chat_id": 1, "text": "hi"}, 10)]


def test_a_429_is_retried_once_after_retry_after(monkeypatch):
    slept = []
    monkeypatch.setattr(bot_api.time, "sleep", slept.append)
    monkeypatch.setattr(
        requests,
        "post",
        _post_returning(
            FakeResponse(429, {"ok": False, "parameters": {"retry_after": 3}}),
            FakeResponse(200, {"ok": True, "result": True}),
        ),
    )
    assert bot_api.call(TOKEN, "editMessageText", {}) is True
    assert slept == [3.0]


def test_errors_carry_status_and_description_but_never_the_token(monkeypatch):
    body = {"ok": False, "description": "Bad Request: message is not modified"}
    monkeypatch.setattr(requests, "post", _post_returning(FakeResponse(400, body)))
    with pytest.raises(bot_api.BotApiError) as error:
        bot_api.call(TOKEN, "editMessageText", {})
    assert "HTTP 400" in str(error.value)
    assert TOKEN not in str(error.value)
    assert error.value.description == "Bad Request: message is not modified"


def test_a_network_error_never_carries_the_url(monkeypatch):
    failure = requests.ConnectionError(f"https://api.telegram.org/bot{TOKEN}/getUpdates unreachable")
    monkeypatch.setattr(requests, "post", _post_returning(failure))
    with pytest.raises(bot_api.BotApiError) as error:
        bot_api.call(TOKEN, "getUpdates", {})
    assert str(error.value) == "Telegram request failed"
    assert error.value.description == ""


def test_a_200_without_ok_is_an_error(monkeypatch):
    monkeypatch.setattr(requests, "post", _post_returning(FakeResponse(200, {"ok": False, "description": "nope"})))
    with pytest.raises(bot_api.BotApiError, match="getUpdates"):
        bot_api.call(TOKEN, "getUpdates", {})
