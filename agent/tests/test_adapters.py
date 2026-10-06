import json

import pytest
import requests

from agent import approval, deliver, digest, inbox
from agent.pending import PendingItem
from agent.tests.conftest import FakeResponse


def test_file_approval_reads_a_v1_decisions_file(tmp_path):
    path = tmp_path / "decisions.json"
    path.write_text(
        json.dumps({"version": 1, "decisions": {"https://a": {"decision": "reject", "at": "2026-10-06T00:00:00Z"}}}),
        encoding="utf-8",
    )
    assert approval.FileApproval(path).load() == {"https://a": "reject"}


@pytest.mark.parametrize("content", [None, "not json", '{"version": 2, "decisions": {}}'])
def test_file_approval_unavailable(tmp_path, content):
    path = tmp_path / "decisions.json"
    if content is not None:
        path.write_text(content, encoding="utf-8")
    with pytest.raises(inbox.DecisionsUnavailable):
        approval.FileApproval(path).load()


def test_inbox_approval_reads_the_token_from_the_named_variable(monkeypatch):
    seen = {}
    monkeypatch.setattr(inbox, "load_decisions", lambda url, token: seen.update(url=url, token=token) or {})
    monkeypatch.setenv("INBOX_TOKEN", "t0k")
    approval.InboxApproval("https://api.github.com/repos/x/y/contents/decisions.json", "INBOX_TOKEN").load()
    assert seen == {"url": "https://api.github.com/repos/x/y/contents/decisions.json", "token": "t0k"}


def test_file_delivery_writes_the_outbox(tmp_path):
    deliver.FileDelivery(tmp_path / "outbox").send(["<b>one</b>", "two"], "2026-10-06T0900Z")
    assert (tmp_path / "outbox" / "2026-10-06T0900Z.html").read_text(encoding="utf-8") == "<b>one</b>\n\n<hr>\n\ntwo\n"


def test_telegram_delivery_posts_to_the_chat_with_the_named_token(monkeypatch):
    posts = []

    def fake_post(url, json=None, timeout=None):
        posts.append((url, json["chat_id"], json["text"]))
        return FakeResponse(200, {"ok": True})

    monkeypatch.setattr(requests, "post", fake_post)
    monkeypatch.setattr(deliver.time, "sleep", lambda seconds: None)
    monkeypatch.setenv("NEWSROOM_BOT_TOKEN", "123:abc")
    deliver.TelegramDelivery("@newsroom", "NEWSROOM_BOT_TOKEN").send(["a", "b"], "run")
    assert posts == [
        ("https://api.telegram.org/bot123:abc/sendMessage", "@newsroom", "a"),
        ("https://api.telegram.org/bot123:abc/sendMessage", "@newsroom", "b"),
    ]


def test_telegram_errors_never_carry_the_token(monkeypatch):
    monkeypatch.setattr(requests, "post", lambda url, json=None, timeout=None: FakeResponse(400, {"ok": False}))
    monkeypatch.setenv("NEWSROOM_BOT_TOKEN", "123:abc")
    with pytest.raises(RuntimeError) as error:
        deliver.TelegramDelivery("@newsroom", "NEWSROOM_BOT_TOKEN").send(["a"], "run")
    assert "123:abc" not in str(error.value)
    assert "HTTP 400" in str(error.value)


def _pending(title):
    return PendingItem("https://example.ru/1", title, "rss", "power", "Власть", "Итог.", 7, "2026-10-06T00:00:00+00:00")


def test_digest_header_follows_the_preset_title_and_language():
    messages = digest.build({"Власть": [_pending("Решение"), _pending("Назначение")]}, "Сводка <редакции>", "ru")
    assert messages[0].startswith("<b>Сводка &lt;редакции&gt; — материалов: 2</b>\n\n<b>Власть</b>\n")
