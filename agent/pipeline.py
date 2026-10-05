"""One topic's pass through the pipeline -- collect, recency window,
dedupe, verdict cache, rank, daily cap, queue -- shared by the real run
and --preview. Mutates the state and queue it's given; the caller decides
whether to save them."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from agent import date_guard, dedupe, pending, rank_cache, summarize
from agent.config import Settings
from agent.dedupe import StateEntry
from agent.pending import PendingQueue
from agent.sources import github_trending, hn
from agent.sources.base import Drop, TopicConfig
from agent.summarize import RankedItem

CONNECTORS = {
    "hacker_news": hn.collect,
    "github_trending": github_trending.collect,
}


@dataclass
class TopicResult:
    kept: list[RankedItem]  # queued this run
    over_cap: list[RankedItem]  # at or above threshold, over the daily cap; eligible again next run
    below: list[RankedItem]  # freshly scored below min_relevance
    cached_below: list[Drop]  # already_ranked: a cached verdict below min_relevance
    queued_before: int  # this topic's items queued in the cap window (23h) before this pass


def process_topic(
    topic: TopicConfig,
    state: dict[str, StateEntry],
    queue: PendingQueue,
    settings: Settings,
    now: datetime,
    writer,
) -> TopicResult:
    all_candidates = []
    for source_name, connector in CONNECTORS.items():
        if source_name not in topic.sources:
            continue
        try:
            candidates, drops = connector(topic, now)
        except Exception as exc:  # noqa: BLE001 — one source failing must not abort the topic or the run
            writer.emit("collect", "failed", topic=topic.slug, source=source_name, detail={"error": str(exc)})
            print(f"{source_name} collection failed for {topic.slug}: {exc}")
            continue
        for candidate in candidates:
            writer.emit_candidate("collect", source_name, topic.slug, candidate)
            dedupe.record_seen(state, candidate, now)
        for drop in drops:
            writer.emit_drop("collect", topic.slug, drop)
        all_candidates.extend(candidates)

    kept, drops = date_guard.apply_recency_window(all_candidates, topic.max_age_days, now)
    for drop in drops:
        writer.emit_drop("date_guard", topic.slug, drop)

    kept, drops = dedupe.filter_seen(kept, state)
    for drop in drops:
        writer.emit_drop("dedupe", topic.slug, drop)

    kept, drops = pending.filter_already_pending(kept, queue)
    for drop in drops:
        writer.emit_drop("dedupe", topic.slug, drop)

    # The same URL can come from two sources or two keywords: keep the first.
    unique, seen_urls = [], set()
    for candidate in kept:
        if candidate.url in seen_urls:
            writer.emit_drop(
                "dedupe",
                topic.slug,
                Drop(url=candidate.url, title=candidate.title, reason="seen", detail={"duplicate_in_run": True}),
            )
        else:
            seen_urls.add(candidate.url)
            unique.append(candidate)
    kept = unique

    rubric = summarize.rubric_hash(topic, settings)
    to_rank, cached, cached_below = rank_cache.partition(kept, state, topic, rubric)
    for drop in cached_below:
        writer.emit_drop("dedupe", topic.slug, drop)

    fresh = summarize.rank_topic(topic, to_rank, settings)
    rank_cache.record(state, fresh, topic.slug, rubric, now)

    eligible = list(cached)
    below: list[RankedItem] = []
    for item in fresh:
        (eligible if item.score >= topic.min_relevance else below).append(item)
    for item in below:
        writer.emit_drop(
            "rank",
            topic.slug,
            Drop(
                url=item.candidate.url,
                title=item.candidate.title,
                reason="below_relevance",
                detail={"score": item.score, "min_relevance": topic.min_relevance},
            ),
        )

    queued_before = rank_cache.queued_in_last_24h(state, topic.slug, now)
    remaining = max(0, topic.max_items_per_day - queued_before)
    keep, over_cap = rank_cache.select(eligible, remaining)
    for item in over_cap:
        writer.emit_drop(
            "rank",
            topic.slug,
            Drop(
                url=item.candidate.url,
                title=item.candidate.title,
                reason="over_max_items",
                detail={"max_items_per_day": topic.max_items_per_day, "queued_last_24h": queued_before},
            ),
        )
    for item in keep:
        writer.emit(
            "rank",
            "kept",
            topic=topic.slug,
            source=item.candidate.source,
            url=item.candidate.url,
            title=item.candidate.title,
            score=item.score,
        )

    rank_cache.mark_queued(state, keep, topic.slug, now)
    pending.add_kept(queue, topic.name, keep, now)
    return TopicResult(
        kept=keep, over_cap=over_cap, below=below, cached_below=cached_below, queued_before=queued_before
    )


PREVIEW_TITLE_CHARS = 90


def format_preview(topic: TopicConfig, result: TopicResult) -> str:
    """One row per item and verdict, summaries indented below -- what a
    real run would queue, and why the rest wouldn't be."""
    lines = [
        f"\n== {topic.name} ({topic.slug}) -- cap {topic.max_items_per_day}/day, "
        f"{result.queued_before} queued in the last 23h"
    ]
    rows = (
        [("queue", item) for item in result.kept]
        + [("over cap", item) for item in result.over_cap]
        + [("below", item) for item in sorted(result.below, key=lambda i: i.score, reverse=True)]
    )
    for verdict, item in rows:
        lines.append(
            f"  {verdict:<12} {item.score:>2}  {item.candidate.source:<6}  "
            f"{item.candidate.title[:PREVIEW_TITLE_CHARS]}"
        )
        lines.append(f"  {'':<12}     {item.summary}")
    for drop in result.cached_below:
        lines.append(f"  {'cached-below':<12} {drop.detail['relevance']:>2}  {'':<6}  {drop.title[:PREVIEW_TITLE_CHARS]}")
    if len(lines) == 1:
        lines.append("  (nothing to score)")
    return "\n".join(lines)
