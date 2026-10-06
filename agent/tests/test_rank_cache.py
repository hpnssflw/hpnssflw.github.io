from datetime import timedelta

from agent import rank_cache
from agent.dedupe import RankRecord, StateEntry, url_hash
from agent.summarize import RankedItem
from agent.tests.conftest import FROZEN_NOW, make_item, make_topic


def _record(relevance=7, rubric="r1", source_score=40, queued_at=None):
    return RankRecord(
        relevance=relevance,
        summary="cached",
        rubric=rubric,
        source_score=source_score,
        ranked_at="2026-10-05T00:00:00+00:00",
        queued_at=queued_at,
    )


def test_is_valid_needs_the_same_rubric():
    topic = make_topic()
    assert rank_cache.is_valid(_record(rubric="r1"), make_item(score=40), "r1", topic)
    assert not rank_cache.is_valid(_record(rubric="r0"), make_item(score=40), "r1", topic)


def test_is_valid_rescores_only_when_score_doubled_and_gained_enough():
    topic = make_topic(attention_min_score_gain=50)
    record = _record(source_score=35)
    assert not rank_cache.is_valid(record, make_item(score=85), "r1", topic)  # 2.4x and +50
    assert rank_cache.is_valid(record, make_item(score=60), "r1", topic)  # +25 only
    assert rank_cache.is_valid(_record(source_score=300), make_item(score=350), "r1", topic)  # +50, not 2x
    assert rank_cache.is_valid(record, make_item(score=None), "r1", topic)
    assert rank_cache.is_valid(record, make_item(score=500), "r1", make_topic(attention_enabled=False))


def test_partition_splits_uncached_cached_below_and_cached_eligible():
    topic = make_topic(min_relevance=6)
    new = make_item(url="https://example.com/new", title="New")
    below = make_item(url="https://example.com/below", title="Below", score=40)
    eligible = make_item(url="https://example.com/eligible", title="Eligible", score=40)
    state = {
        url_hash(below.url): StateEntry("t", 40, 0, ranks={"tooling": _record(relevance=3)}),
        url_hash(eligible.url): StateEntry("t", 40, 0, ranks={"tooling": _record(relevance=7)}),
    }

    to_rank, cached, drops = rank_cache.partition([new, below, eligible], state, topic, "r1")

    assert [item.url for item in to_rank] == [new.url]
    assert [(r.item.url, r.score, r.summary) for r in cached] == [(eligible.url, 7, "cached")]
    assert [(d.url, d.reason, d.detail) for d in drops] == [(below.url, "already_ranked", {"relevance": 3})]


def test_select_orders_by_relevance_then_source_score():
    a = RankedItem(make_item(url="https://example.com/a", score=10), "a", 7)
    b = RankedItem(make_item(url="https://example.com/b", score=90), "b", 7)
    c = RankedItem(make_item(url="https://example.com/c", score=5), "c", 9)
    keep, over = rank_cache.select([a, b, c], 2)
    assert [r.summary for r in keep] == ["c", "b"]
    assert [r.summary for r in over] == ["a"]


def test_queued_in_window_counts_only_the_last_23_hours():
    def entry(hours_ago):
        queued = (FROZEN_NOW - timedelta(hours=hours_ago)).isoformat()
        return StateEntry("t", 1, 0, ranks={"tooling": _record(queued_at=queued)})

    state = {"a": entry(1), "b": entry(22.9), "c": entry(23), "d": StateEntry("t", 1, 0)}
    assert rank_cache.queued_in_last_24h(state, "tooling", FROZEN_NOW) == 2


def test_record_skips_failed_and_mark_queued_stamps():
    item = make_item(url="https://example.com/x", score=12)
    failed = make_item(url="https://example.com/f")
    state = {url_hash(item.url): StateEntry("t", 12, 0), url_hash(failed.url): StateEntry("t", 1, 0)}
    rank_cache.record(
        state, [RankedItem(item, "s", 8), RankedItem(failed, "(ranking failed)", 1, failed=True)], "tooling", "r1", FROZEN_NOW
    )
    rank_cache.mark_queued(state, [RankedItem(item, "s", 8)], "tooling", FROZEN_NOW)
    record = state[url_hash(item.url)].ranks["tooling"]
    assert (record.relevance, record.rubric, record.source_score, record.queued_at) == (8, "r1", 12, FROZEN_NOW.isoformat())
    assert state[url_hash(failed.url)].ranks == {}
