import pytest

from agent import inbox
from agent.dedupe import StateEntry, url_hash
from agent.pending import PendingItem, PendingQueue
from agent.tests.conftest import FROZEN_NOW


def _item(url, pending_since):
    return PendingItem(url, url, "hn", "tooling", "Tooling", "s", 7, pending_since)


def test_apply_decisions_approves_rejects_expires_and_keeps_undecided():
    approved = _item("https://example.com/approved", "2026-09-01T00:00:00+00:00")  # old, but approved never expires
    rejected = _item("https://example.com/rejected", "2026-10-06T00:00:00+00:00")
    expired = _item("https://example.com/expired", "2026-09-28T11:00:00+00:00")  # 8 days
    waiting = _item("https://example.com/waiting", "2026-10-01T00:00:00+00:00")  # 5.5 days
    queue = PendingQueue(last_email_at=None, items=[approved, rejected, expired, waiting])
    state = {url_hash(i.url): StateEntry("t", 1, 0) for i in queue.items}
    decisions = {approved.url: "approve", rejected.url: "reject", "https://example.com/gone": "approve"}

    result, drops = inbox.apply_decisions(queue, decisions, state, FROZEN_NOW, expire_days=7)

    assert result == [approved]
    assert queue.items == [approved, waiting]
    assert [(topic, d.url, d.reason) for topic, d in drops] == [
        ("tooling", rejected.url, "rejected"),
        ("tooling", expired.url, "expired"),
    ]
    assert state[url_hash(rejected.url)].dismissed == "rejected"
    assert state[url_hash(expired.url)].dismissed == "expired"
    assert state[url_hash(waiting.url)].dismissed is None


def test_parse_decisions_rejects_a_malformed_file():
    assert inbox.parse_decisions({"version": 1, "decisions": {"u": {"decision": "approve", "at": "x"}}}) == {"u": "approve"}
    for raw in (
        [],
        {"version": 2, "decisions": {}},
        {"version": True, "decisions": {}},
        {"version": 1, "decisions": []},
        {"version": 1, "decisions": {"u": {"decision": "maybe", "at": "x"}}},
        {"version": 1, "decisions": {"u": {"decision": "approve"}}},
    ):
        with pytest.raises(inbox.DecisionsUnavailable):
            inbox.parse_decisions(raw)
