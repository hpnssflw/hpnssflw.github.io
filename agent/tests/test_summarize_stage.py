"""The summarize stage (docs/superpowers/specs/2026-10-14-queued-summaries-design.md):
items the daily cap keeps get a summary from their page text; anything
going wrong keeps the ranker's summary."""

from __future__ import annotations

from dataclasses import replace

import pytest

from agent import dedupe, events, pipeline, rank_cache
from agent.context import Adapters, RunContext
from agent.pending import PendingQueue
from agent.preset import load_preset
from agent.run_result import Tally
from agent.sources import fulltext
from agent.summarize import RankedItem
from agent.tests.conftest import FROZEN_NOW, make_item
from agent.tests.test_preset import VALID, write_preset


class FakeRanker:
    def __init__(self, answers=None, error: Exception | None = None):
        self.answers = answers or {}
        self.error = error
        self.calls: list[list[tuple[str, str]]] = []

    def summarize(self, entries):
        self.calls.append([(item.url, text) for item, text in entries])
        if self.error is not None:
            raise self.error
        return [self.answers.get(item.url) for item, _ in entries]


def _ctx(tmp_path, ranker, on=True):
    raw = dict(VALID, ranking={"reader": "Редактор.", "summarize_queued": on})
    preset = load_preset(write_preset(tmp_path, raw))
    return RunContext(
        preset=preset,
        state={},
        queue=PendingQueue(last_email_at=None, items=[]),
        adapters=Adapters(ranker=ranker, approval=None, delivery=None),
        now=FROZEN_NOW,
        writer=events.MemoryWriter(),
        tally=Tally([t.slug for t in preset.topics], has_feeds=True, summarize=on),
    )


@pytest.fixture
def pages(monkeypatch):
    """url -> page text (None: the fetch failed); records every fetch."""
    texts: dict[str, str | None] = {}
    fetched: list[str] = []

    def fetch_text(url, fetcher):
        fetched.append(url)
        return texts.get(url)

    monkeypatch.setattr(fulltext, "fetch_text", fetch_text)
    return texts, fetched


def _notes(ctx, scope="incidents"):
    stage = next(s for s in ctx.tally.stages() if s["stage"] == "summarize")
    return stage["scopes"][scope]


def _ranked(url, summary="Ranker line.", **item):
    return RankedItem(item=make_item(url=url, topic="incidents", **item), summary=summary, score=8)


def test_kept_items_get_the_page_summary(tmp_path, pages):
    texts, _ = pages
    texts["https://a"] = "Page a."
    ranker = FakeRanker({"https://a": "What a is."})
    ctx = _ctx(tmp_path, ranker)
    out = pipeline._summarize(ctx, "incidents", [_ranked("https://a")])
    assert [r.summary for r in out] == ["What a is."]
    assert ranker.calls == [[("https://a", "Page a.")]]
    assert _notes(ctx) == {"in": 1, "out": 1, "drops": {}, "notes": {"summarized": 1}}


def test_any_failure_keeps_the_ranker_summary(tmp_path, pages):
    texts, _ = pages
    texts["https://b"] = "Page b."  # answered null
    ranker = FakeRanker({"https://b": None})
    ctx = _ctx(tmp_path, ranker)
    out = pipeline._summarize(ctx, "incidents", [_ranked("https://a"), _ranked("https://b")])  # a: fetch fails
    assert [r.summary for r in out] == ["Ranker line.", "Ranker line."]
    assert _notes(ctx)["notes"] == {"fetch_failed": 1, "kept_rank_summary": 2}
    assert ctx.tally.failures == []


def test_a_raising_page_fetch_keeps_the_ranker_summary(tmp_path, monkeypatch):
    def fetch_text(url, fetcher):
        if url == "https://a":
            raise RuntimeError("https://a/?token=secret")
        return "Page b."

    monkeypatch.setattr(fulltext, "fetch_text", fetch_text)
    ranker = FakeRanker({"https://b": "What b is."})
    ctx = _ctx(tmp_path, ranker)
    out = pipeline._summarize(ctx, "incidents", [_ranked("https://a"), _ranked("https://b")])
    assert [r.summary for r in out] == ["Ranker line.", "What b is."]
    assert _notes(ctx)["notes"] == {"fetch_failed": 1, "kept_rank_summary": 1, "summarized": 1}
    assert ctx.tally.failures == []


def test_a_raising_ranker_is_a_failure_not_a_lost_item(tmp_path, pages):
    texts, _ = pages
    texts["https://a"] = "Page a."
    ctx = _ctx(tmp_path, FakeRanker(error=RuntimeError("https://api/?key=secret")))
    out = pipeline._summarize(ctx, "incidents", [_ranked("https://a")])
    assert [r.summary for r in out] == ["Ranker line."]
    assert ctx.tally.failures == [{"stage": "summarize", "scope": "incidents", "source": None, "error_type": "RuntimeError"}]


def test_full_text_feed_items_are_not_fetched_again(tmp_path, pages):
    _, fetched = pages
    ranker = FakeRanker({"https://f": "From the feed text."})
    ctx = _ctx(tmp_path, ranker)
    item = replace(make_item(url="https://f", kind="rss", topic="incidents", text="Full article."), source_id="agency")
    out = pipeline._summarize(ctx, "incidents", [RankedItem(item=item, summary="Ranker line.", score=8)])
    assert fetched == []
    assert ranker.calls == [[("https://f", "Full article.")]]
    assert out[0].summary == "From the feed text."


def test_no_texts_means_no_call(tmp_path, pages):
    ranker = FakeRanker()
    ctx = _ctx(tmp_path, ranker)
    pipeline._summarize(ctx, "incidents", [_ranked("https://a")])
    assert ranker.calls == []


def _seed(ctx, ranked: list[RankedItem]):
    for r in ranked:
        dedupe.record_seen(ctx.state, r.item, ctx.now)
    rank_cache.record(ctx.state, ranked, "incidents", "rubric", ctx.now)


def test_cap_and_queue_summarizes_only_what_the_cap_keeps(tmp_path, pages):
    texts, fetched = pages
    texts.update({"https://a": "Page a.", "https://b": "Page b."})
    ranker = FakeRanker({"https://a": "What a is.", "https://b": "What b is."})
    ctx = _ctx(tmp_path, ranker)
    topic = replace(ctx.preset.topics[0], max_items_per_day=1)
    eligible = [_ranked("https://a", score=50), _ranked("https://b", score=10)]
    _seed(ctx, eligible)
    keep, over, _ = pipeline._cap_and_queue(topic, eligible, ctx)
    assert [r.item.url for r in keep] == ["https://a"] and [r.item.url for r in over] == ["https://b"]
    assert fetched == ["https://a"]
    assert [(i.url, i.summary) for i in ctx.queue.items] == [("https://a", "What a is.")]


def test_cap_and_queue_without_the_key_never_fetches(tmp_path, pages):
    _, fetched = pages
    ctx = _ctx(tmp_path, FakeRanker(), on=False)
    eligible = [_ranked("https://a")]
    _seed(ctx, eligible)
    pipeline._cap_and_queue(ctx.preset.topics[0], eligible, ctx)
    assert fetched == []
    assert [i.summary for i in ctx.queue.items] == ["Ranker line."]
