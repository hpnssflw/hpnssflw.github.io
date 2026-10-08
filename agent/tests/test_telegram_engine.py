import json
from datetime import timedelta

import pytest
import requests

from agent import dedupe, engine, pending, summarize, telegram_review
from agent.dedupe import StateEntry, url_hash
from agent.paths import DataPaths
from agent.pending import PendingItem, PendingQueue
from agent.preset import load_preset
from agent.tests.conftest import FROZEN_NOW, OWNER, FakeBot, FakeDeepSeek, FakeResponse, tap

A, B = "https://example.com/a", "https://example.com/b"

PRESET = """\
preset: {slug: t, name: T, language: en}
defaults: {max_age_days: 2, min_relevance: 6, max_items_per_day: 3}
topics:
  - {slug: tooling, name: Tooling, description: Tools., include: [tools], exclude: []}
ranking: {reader: A builder.}
llm: {base_url: "https://api.deepseek.com", model: deepseek-v4-flash, api_key_env: DEEPSEEK_API_KEY}
approval:
  type: file
  path: decisions.json
  expire_days: 7
  telegram: {bot_token_env: T_TOKEN, owner_chat_env: T_OWNER, max_asks_per_run: 10}
delivery: {type: file, title: Digest, cadence_hours: 24}
"""


@pytest.fixture
def setup(tmp_path, monkeypatch):
    (tmp_path / "decisions.json").write_text('{"version": 1, "decisions": {}}', encoding="utf-8")
    (tmp_path / "preset.yaml").write_text(PRESET, encoding="utf-8")
    preset = load_preset(tmp_path / "preset.yaml")
    paths = DataPaths(tmp_path / "data")
    paths.root.mkdir()
    since = (FROZEN_NOW - timedelta(hours=1)).isoformat()
    queue = PendingQueue(None, [PendingItem(u, u[-1].upper(), "hn", "tooling", "Tooling", "S.", 8, since) for u in (A, B)])
    pending.save_pending(paths.pending, queue)
    dedupe.save_state(paths.state, {url_hash(u): StateEntry(since, 10, 0) for u in (A, B)})
    bot = FakeBot()
    llm = FakeDeepSeek({})
    monkeypatch.setattr(requests, "post", bot.post)
    monkeypatch.setattr(telegram_review.time, "sleep", lambda seconds: None)
    monkeypatch.setattr(summarize, "OpenAI", llm)
    monkeypatch.setenv("T_TOKEN", "123:secret")
    monkeypatch.setenv("T_OWNER", str(OWNER))
    monkeypatch.setenv("DEEPSEEK_API_KEY", "k")
    yield preset, paths, bot
    assert llm.calls == []


def _run(preset, paths, now):
    engine.run_real(preset, paths, now, engine.live_adapters(preset, paths))


def _store(paths):
    return json.loads(paths.telegram.read_text(encoding="utf-8"))


def test_ask_then_apply_taps_deliver_and_finish_the_messages(setup, capsys):
    preset, paths, bot = setup
    _run(preset, paths, FROZEN_NOW)
    assert [m["text"].split("\n")[1] for m in bot.sent("sendMessage")] == [
        '<a href="https://example.com/b">B</a>',
        '<a href="https://example.com/a">A</a>',
    ]
    assert _store(paths)["messages"] == {A: {"message_id": 2, "shown": "waiting"}, B: {"message_id": 1, "shown": "waiting"}}
    assert "Telegram: 0 tap(s) picked up, 2 item(s) asked." in capsys.readouterr().out

    bot.updates = [
        tap(10, f"a:{url_hash(A)}", message_id=2),
        tap(11, f"r:{url_hash(B)}", message_id=1),
        tap(12, f"a:{url_hash(B)}", user=999),
    ]
    later = FROZEN_NOW + timedelta(hours=1)
    _run(preset, paths, later)
    out = capsys.readouterr().out
    assert "Sent 1 approved items across 1 topics." in out
    assert "Telegram: 2 tap(s) picked up, 0 item(s) asked." in out
    assert (paths.outbox / f"{engine.events.new_run_id(later)}.html").read_text(encoding="utf-8").count("example.com/a") == 1
    edits = {e["message_id"]: e["text"].rsplit("\n", 1)[-1] for e in bot.sent("editMessageText")}
    assert edits == {2: "📤 Sent 06.10", 1: "❌ Rejected"}
    assert _store(paths) == {"version": 1, "offset": 13, "decisions": {}, "messages": {}}
    state = dedupe.load_state(paths.state)
    assert (state[url_hash(A)].times_sent, state[url_hash(B)].dismissed) == (1, "rejected")
    review = next(s for s in json.loads(paths.result.read_text(encoding="utf-8"))["stages"] if s["stage"] == "review")
    assert review["scopes"]["tooling"]["notes"]["telegram_taps"] == 2


def test_a_failed_poll_drops_and_delivers_nothing_and_writes_no_store(setup, capsys):
    preset, paths, bot = setup
    (preset.approval.path).write_text(
        json.dumps({"version": 1, "decisions": {A: {"decision": "approve", "at": "2026-10-06T11:00:00Z"}}}), encoding="utf-8"
    )
    bot.fail["getUpdates"] = [FakeResponse(409, {"ok": False, "description": "Conflict: can't use getUpdates while webhook is active"})]
    _run(preset, paths, FROZEN_NOW)
    out = capsys.readouterr().out
    assert "Inbox decisions unavailable; nothing is dropped or delivered this run" in out
    assert "123:secret" not in out
    assert bot.sent("sendMessage") == [] and not paths.telegram.exists()
    assert not paths.outbox.exists()
    result = json.loads(paths.result.read_text(encoding="utf-8"))
    assert result["failures"] == [{"stage": "review", "scope": "*", "source": "telegram", "error_type": "DecisionsUnavailable"}]


def test_a_failed_poll_leaves_an_existing_store_untouched(setup, capsys):
    preset, paths, bot = setup
    paths.telegram.write_text('{"version": 1, "offset": 9, "decisions": {}, "messages": {}}', encoding="utf-8")
    before = paths.telegram.read_bytes()
    bot.fail["getUpdates"] = [FakeResponse(409, {"ok": False, "description": "Conflict"})]
    _run(preset, paths, FROZEN_NOW)
    assert paths.telegram.read_bytes() == before
    assert bot.sent("sendMessage") == []


def test_a_failed_site_still_collects_taps_and_asks(setup, capsys):
    preset, paths, bot = setup
    preset.approval.path.write_text("not json", encoding="utf-8")
    bot.updates = [tap(3, f"a:{url_hash(A)}")]
    _run(preset, paths, FROZEN_NOW)
    assert "nothing is dropped or delivered" in capsys.readouterr().out
    assert len(bot.sent("sendMessage")) == 2 and bot.sent("editMessageText") == []
    store = _store(paths)
    assert store["offset"] == 4 and store["decisions"][A]["decision"] == "approve"
    assert not paths.outbox.exists()


def test_preview_and_dry_run_never_touch_telegram(setup, capsys):
    preset, paths, bot = setup
    adapters = engine.live_adapters(preset, paths)
    engine.run_preview(preset, paths, FROZEN_NOW, adapters)
    engine.run_dry(preset, paths, FROZEN_NOW, adapters)
    assert bot.calls == [] and not paths.telegram.exists()


def test_a_crashing_telegram_step_does_not_fail_the_run_or_repeat_the_digest(setup, capsys, monkeypatch):
    preset, paths, bot = setup
    preset.approval.path.write_text(
        json.dumps({"version": 1, "decisions": {A: {"decision": "approve", "at": "2026-10-06T11:00:00Z"}}}), encoding="utf-8"
    )

    def boom(self, *args, **kwargs):
        raise RuntimeError("secret detail")

    monkeypatch.setattr(telegram_review.TelegramReview, "ask", boom)
    bot.updates = [tap(3, f"a:{url_hash(A)}", message_id=7)]
    _run(preset, paths, FROZEN_NOW)
    assert _store(paths)["offset"] == 4  # the crash still saves what the poll confirmed
    out = capsys.readouterr().out
    assert "Telegram review failed: RuntimeError" in out and "secret detail" not in out
    assert [p.read_text(encoding="utf-8").count("example.com/a") for p in paths.outbox.iterdir()] == [1]
    assert dedupe.load_state(paths.state)[url_hash(A)].times_sent == 1
    assert [item.url for item in pending.load_pending(paths.pending).items] == [B]
    result = json.loads(paths.result.read_text(encoding="utf-8"))
    assert {"stage": "review", "scope": "*", "source": "telegram", "error_type": "RuntimeError"} in result["failures"]
