import json
from datetime import timedelta

import pytest
import requests

from agent import telegram_review
from agent.dedupe import url_hash
from agent.inbox import DecisionEntry, DecisionsUnavailable
from agent.pending import PendingItem
from agent.preset import TelegramApprovalConfig
from agent.run_result import Tally
from agent.telegram_review import AskMessage, TelegramReview, TelegramStore, load_store, render, save_store
from agent.tests.conftest import FROZEN_NOW, OWNER, FakeBot, FakeResponse, tap

CONFIG = TelegramApprovalConfig(bot_token_env="T_TOKEN", owner_chat_env="T_OWNER", max_asks_per_run=2)
A, B, C, D = (f"https://example.com/{x}" for x in "abcd")
NOW = FROZEN_NOW.isoformat()


def item(url: str, hours_ago: int = 1, title: str = "Title", topic: str = "tooling") -> PendingItem:
    since = (FROZEN_NOW - timedelta(hours=hours_ago)).isoformat()
    return PendingItem(url, title, "hn", topic, "Tooling", "Summary.", 8, since)


@pytest.fixture
def bot(monkeypatch):
    fake = FakeBot()
    monkeypatch.setattr(requests, "post", fake.post)
    monkeypatch.setattr(telegram_review.time, "sleep", lambda seconds: None)
    monkeypatch.setenv("T_TOKEN", "123:secret")
    monkeypatch.setenv("T_OWNER", str(OWNER))
    return fake


def new_review(tmp_path) -> TelegramReview:
    return TelegramReview(CONFIG, "en", tmp_path / "telegram.json")


def new_tally() -> Tally:
    return Tally(["tooling"], has_feeds=False)


# --- store -------------------------------------------------------------------


def test_a_missing_store_is_empty_and_a_saved_one_round_trips(tmp_path):
    path = tmp_path / "telegram.json"
    assert load_store(path) == TelegramStore()
    store = TelegramStore(12, {A: DecisionEntry("clear", NOW)}, {A: AskMessage(3, "waiting"), B: AskMessage(4, "gone")})
    save_store(path, store)
    assert load_store(path) == store
    assert json.loads(path.read_text(encoding="utf-8"))["version"] == 1


@pytest.mark.parametrize(
    "content",
    [
        "not json",
        '{"version": 2, "offset": 0, "decisions": {}, "messages": {}}',
        '{"version": 1, "offset": -1, "decisions": {}, "messages": {}}',
        '{"version": 1, "offset": 0, "decisions": {"u": {"decision": "maybe", "at": "x"}}, "messages": {}}',
        '{"version": 1, "offset": 0, "decisions": {}, "messages": {"u": {"message_id": 1, "shown": "lost"}}}',
        '{"version": 1, "offset": 0, "decisions": [], "messages": {}}',
    ],
)
def test_a_malformed_store_makes_telegram_unavailable(tmp_path, content):
    path = tmp_path / "telegram.json"
    path.write_text(content, encoding="utf-8")
    with pytest.raises(DecisionsUnavailable, match="telegram.json"):
        load_store(path)


# --- collect -------------------------------------------------------------------


def test_collect_counts_only_the_owners_taps_and_advances_the_offset(tmp_path, bot):
    bot.updates = [
        tap(5, f"a:{url_hash(A)}"),
        tap(6, f"r:{url_hash(A)}", user=999),  # someone else
        tap(7, f"r:{url_hash(B)}", chat=-100),  # another chat
        tap(8, "a:ffffffffffffffff"),  # no such queue item
        tap(9, f"x:{url_hash(A)}"),  # unknown action
        {"update_id": 10, "message": {"text": "/start"}},  # not a callback
        tap(11, f"u:{url_hash(B)}"),
    ]
    review = new_review(tmp_path)
    decisions, tapped = review.collect([item(A), item(B)], FROZEN_NOW)
    assert decisions == {A: DecisionEntry("approve", NOW), B: DecisionEntry("clear", NOW)}
    assert [i.url for i in tapped] == [A, B]
    assert bot.sent("getUpdates") == [{"offset": 0, "limit": 100, "timeout": 0, "allowed_updates": ["callback_query"]}]
    review.save()
    assert load_store(tmp_path / "telegram.json").offset == 12


def test_the_last_tap_wins_and_rereading_an_unsaved_batch_gives_the_same_decisions(tmp_path, bot):
    bot.updates = [tap(1, f"a:{url_hash(A)}"), tap(2, f"r:{url_hash(A)}")]
    first, _ = new_review(tmp_path).collect([item(A)], FROZEN_NOW)  # not saved: as if the push failed
    again, _ = new_review(tmp_path).collect([item(A)], FROZEN_NOW)
    assert first == again == {A: DecisionEntry("reject", NOW)}


def test_a_saved_offset_skips_taps_already_handled(tmp_path, bot):
    bot.updates = [tap(1, f"a:{url_hash(A)}")]
    review = new_review(tmp_path)
    review.collect([item(A)], FROZEN_NOW)
    review.save()
    later = FROZEN_NOW + timedelta(hours=4)
    decisions, tapped = new_review(tmp_path).collect([item(A)], later)
    assert tapped == [] and decisions == {A: DecisionEntry("approve", NOW)}
    assert bot.sent("getUpdates")[-1]["offset"] == 2


@pytest.mark.parametrize(
    "setup",
    [
        lambda bot, mp: mp.delenv("T_TOKEN"),
        lambda bot, mp: mp.setenv("T_OWNER", "not-a-number"),
        lambda bot, mp: bot.fail.setdefault("getUpdates", []).append(FakeResponse(409, {"ok": False, "description": "Conflict"})),
        lambda bot, mp: bot.fail.setdefault("getUpdates", []).append(FakeResponse(200, {"ok": True, "result": {}})),
    ],
)
def test_collect_is_unavailable_without_token_owner_or_updates(tmp_path, bot, monkeypatch, setup):
    setup(bot, monkeypatch)
    with pytest.raises(DecisionsUnavailable) as error:
        new_review(tmp_path).collect([item(A)], FROZEN_NOW)
    assert "123:secret" not in str(error.value)


# --- render --------------------------------------------------------------------


def test_render_a_waiting_item():
    text, markup = render(item(A, title="Tools & <tricks>"), "waiting", "en", FROZEN_NOW)
    assert text == '<b>Tooling</b> · 8/10 · hn\n<a href="https://example.com/a">Tools &amp; &lt;tricks&gt;</a>\nSummary.'
    assert markup == {
        "inline_keyboard": [
            [
                {"text": "✅ Approve", "callback_data": f"a:{url_hash(A)}"},
                {"text": "❌ Reject", "callback_data": f"r:{url_hash(A)}"},
            ]
        ]
    }


def test_render_status_lines_and_buttons():
    text, markup = render(item(A), "approved", "en", FROZEN_NOW)
    assert text.endswith("\n\n✅ Approved — goes out with the next digest")
    assert markup == {"inline_keyboard": [[{"text": "↩ Undo", "callback_data": f"u:{url_hash(A)}"}]]}
    text, markup = render(item(A), "sent", "ru", FROZEN_NOW)
    assert text.endswith("\n\n📤 Отправлено 06.10") and markup == {"inline_keyboard": []}
    assert render(item(A), "rejected", "en", FROZEN_NOW)[0].endswith("\n\n❌ Rejected")
    assert render(item(A), "expired", "ru", FROZEN_NOW)[0].endswith("\n\n⌛ Истекло")


def test_render_links_only_http_urls():
    text, _ = render(item("javascript:alert(1)", title="T"), "waiting", "en", FROZEN_NOW)
    assert "<a " not in text and "\nT\n" in text


# --- ask -----------------------------------------------------------------------


def test_ask_sends_the_newest_first_up_to_the_cap(tmp_path, bot):
    review = new_review(tmp_path)
    items = [item(A, hours_ago=3), item(B, hours_ago=1), item(C, hours_ago=2)]
    review.collect(items, FROZEN_NOW)
    tally = new_tally()
    assert review.ask(items, {}, FROZEN_NOW, tally) == 2
    sent = bot.sent("sendMessage")
    assert [m["chat_id"] for m in sent] == [OWNER, OWNER]
    assert [m["reply_markup"]["inline_keyboard"][0][0]["callback_data"] for m in sent] == [f"a:{url_hash(B)}", f"a:{url_hash(C)}"]
    assert all(m["parse_mode"] == "HTML" and m["disable_web_page_preview"] is True for m in sent)
    assert review.ask(items, {}, FROZEN_NOW, tally) == 1  # A, next time round
    review.save()
    assert load_store(tmp_path / "telegram.json").messages == {
        B: AskMessage(1, "waiting"),
        C: AskMessage(2, "waiting"),
        A: AskMessage(3, "waiting"),
    }
    review_stage = next(s for s in tally.stages() if s["stage"] == "review")
    assert review_stage["scopes"]["tooling"]["notes"]["asked"] == 3


def test_a_failed_ask_is_retried_and_a_site_approval_is_shown(tmp_path, bot):
    bot.fail["sendMessage"] = [FakeResponse(500, {"ok": False})]
    review = new_review(tmp_path)
    items = [item(A, hours_ago=1), item(B, hours_ago=2)]
    review.collect(items, FROZEN_NOW)
    tally = new_tally()
    assert review.ask(items, {A: "approve"}, FROZEN_NOW, tally) == 1  # A failed, B asked
    assert tally.failures == [{"stage": "review", "scope": "*", "source": "telegram", "error_type": "BotApiError"}]
    assert review.ask(items, {A: "approve"}, FROZEN_NOW, tally) == 1
    last = bot.sent("sendMessage")[-1]
    assert last["reply_markup"] == {"inline_keyboard": [[{"text": "↩ Undo", "callback_data": f"u:{url_hash(A)}"}]]}


# --- update --------------------------------------------------------------------


def _seed(tmp_path, messages: dict, decisions: dict | None = None) -> None:
    save_store(tmp_path / "telegram.json", TelegramStore(0, decisions or {}, messages))


def test_update_edits_changed_statuses_and_finishes_items_that_left(tmp_path, bot):
    _seed(
        tmp_path,
        {A: AskMessage(1, "waiting"), B: AskMessage(2, "waiting"), C: AskMessage(3, "approved"), D: AskMessage(4, "gone")},
        {B: DecisionEntry("reject", NOW)},
    )
    review = new_review(tmp_path)
    before = {i.url: i for i in [item(A), item(B), item(C), item(D)]}
    queued = [item(A), item(C)]
    review.collect(list(before.values()), FROZEN_NOW)
    review.update(before, queued, {A: "approve", C: "approve"}, sent=set(), rejected={B}, now=FROZEN_NOW, tally=new_tally())
    edits = bot.sent("editMessageText")
    assert [(e["message_id"], e["text"].rsplit("\n", 1)[-1]) for e in edits] == [
        (1, "✅ Approved — goes out with the next digest"),
        (2, "❌ Rejected"),
    ]
    assert edits[1]["reply_markup"] == {"inline_keyboard": []}
    review.save()
    store = load_store(tmp_path / "telegram.json")
    assert store.messages == {A: AskMessage(1, "approved"), C: AskMessage(3, "approved")}
    assert store.decisions == {}  # B left the queue


def test_update_marks_sent_and_expired(tmp_path, bot):
    _seed(tmp_path, {A: AskMessage(1, "approved"), B: AskMessage(2, "waiting")})
    review = new_review(tmp_path)
    before = {i.url: i for i in [item(A), item(B)]}
    review.collect(list(before.values()), FROZEN_NOW)
    review.update(before, [], {A: "approve"}, sent={A}, rejected=set(), now=FROZEN_NOW, tally=new_tally())
    assert [e["text"].rsplit("\n", 1)[-1] for e in bot.sent("editMessageText")] == ["📤 Sent 06.10", "⌛ Expired"]


def test_not_modified_counts_as_done_a_gone_message_is_tombstoned_and_other_errors_retry(tmp_path, bot):
    _seed(tmp_path, {A: AskMessage(1, "waiting"), B: AskMessage(2, "waiting"), C: AskMessage(3, "waiting")})
    bot.fail["editMessageText"] = [
        FakeResponse(400, {"ok": False, "description": "Bad Request: message is not modified: specified new message content"}),
        FakeResponse(400, {"ok": False, "description": "Bad Request: message to edit not found"}),
        FakeResponse(500, {"ok": False, "description": "Internal Server Error"}),
    ]
    review = new_review(tmp_path)
    items = [item(A), item(B), item(C)]
    review.collect(items, FROZEN_NOW)
    tally = new_tally()
    review.update({i.url: i for i in items}, items, {A: "approve", B: "approve", C: "approve"}, set(), set(), FROZEN_NOW, tally)
    review.save()
    store = load_store(tmp_path / "telegram.json")
    assert store.messages == {A: AskMessage(1, "approved"), B: AskMessage(2, "gone"), C: AskMessage(3, "waiting")}
    assert [f["source"] for f in tally.failures] == ["telegram"]
    assert review.ask(items, {}, FROZEN_NOW, tally) == 0  # a gone message isn't asked again


def test_a_failed_final_edit_still_drops_the_entry(tmp_path, bot):
    _seed(tmp_path, {A: AskMessage(1, "approved")})
    bot.fail["editMessageText"] = [FakeResponse(500, {"ok": False})]
    review = new_review(tmp_path)
    review.collect([item(A)], FROZEN_NOW)
    review.update({A: item(A)}, [], {}, sent={A}, rejected=set(), now=FROZEN_NOW, tally=new_tally())
    review.save()
    assert load_store(tmp_path / "telegram.json").messages == {}
