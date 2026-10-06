from agent import dedupe
from agent.dedupe import StateEntry, url_hash
from agent.tests.conftest import FROZEN_NOW, make_item


def test_filter_seen_drops_sent_and_dismissed_keeps_the_rest():
    sent = make_item(url="https://example.com/sent", title="Sent")
    dismissed = make_item(url="https://example.com/dismissed", title="Dismissed")
    collected_before = make_item(url="https://example.com/old", title="Collected before")
    fresh = make_item(url="https://example.com/fresh", title="Fresh")
    state = {
        url_hash(sent.url): StateEntry(first_seen="2026-10-01T00:00:00+00:00", last_score=5, times_sent=1),
        url_hash(dismissed.url): StateEntry(
            first_seen="2026-10-01T00:00:00+00:00", last_score=5, times_sent=0, dismissed="rejected"
        ),
        url_hash(collected_before.url): StateEntry(first_seen="2026-10-01T00:00:00+00:00", last_score=5, times_sent=0),
    }

    kept, drops = dedupe.filter_seen([sent, dismissed, collected_before, fresh], state)

    assert [item.url for item in kept] == [collected_before.url, fresh.url]
    assert [(d.url, d.reason, d.detail) for d in drops] == [
        (sent.url, "seen", {"times_sent": 1}),
        (dismissed.url, "dismissed", {"dismissed": "rejected"}),
    ]


def test_record_seen_creates_then_updates_the_score():
    state: dict[str, StateEntry] = {}
    item = make_item(score=10)
    dedupe.record_seen(state, item, FROZEN_NOW)
    dedupe.record_seen(state, make_item(score=25), FROZEN_NOW)
    entry = state[url_hash(item.url)]
    assert (entry.first_seen, entry.last_score, entry.times_sent) == (FROZEN_NOW.isoformat(), 25, 0)


def test_state_round_trips_through_disk(tmp_path):
    state = {"abc": StateEntry(first_seen="2026-10-01T00:00:00+00:00", last_score=None, times_sent=2)}
    path = tmp_path / "state.json"
    dedupe.save_state(path, state)
    assert dedupe.load_state(path) == state
