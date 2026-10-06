"""One topic's pass through the pipeline -- collect, recency window,
dedupe, verdict cache, rank, daily cap, queue -- shared by the real run
and --preview. Mutates the state and queue it's given; the caller decides
whether to save them."""

from __future__ import annotations

from dataclasses import dataclass

from agent import date_guard, dedupe, pending, rank_cache, summarize
from agent.context import RunContext
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


def process_topic(topic: TopicConfig, ctx: RunContext) -> TopicResult:
    state, queue, now, writer, tally = ctx.state, ctx.queue, ctx.now, ctx.writer, ctx.tally
    scope = topic.slug
    all_candidates = []
    for source_name, connector in CONNECTORS.items():
        if source_name not in topic.sources:
            continue
        try:
            candidates, drops = connector(topic, now)
        except Exception as exc:  # noqa: BLE001 — one source failing must not abort the topic or the run
            writer.emit("collect", "failed", topic=topic.slug, source=source_name, detail={"error": str(exc)})
            tally.fail("collect", scope, source_name, exc)
            print(f"{source_name} collection failed for {topic.slug}: {exc}")
            continue
        tally.count("collect", scope, len(candidates) + len(drops), len(candidates), drops)
        for candidate in candidates:
            writer.emit_candidate("collect", source_name, topic.slug, candidate)
            dedupe.record_seen(state, candidate, now)
        for drop in drops:
            writer.emit_drop("collect", topic.slug, drop)
        all_candidates.extend(candidates)

    kept, drops = date_guard.apply_recency_window(all_candidates, topic.max_age_days, now)
    for drop in drops:
        writer.emit_drop("date_guard", topic.slug, drop)
    tally.count("window", scope, len(all_candidates), len(kept), drops)

    in_window = len(kept)
    dedupe_drops: list[Drop] = []
    kept, drops = dedupe.filter_seen(kept, state)
    dedupe_drops += drops
    for drop in drops:
        writer.emit_drop("dedupe", topic.slug, drop)

    kept, drops = pending.filter_already_pending(kept, queue)
    dedupe_drops += drops
    for drop in drops:
        writer.emit_drop("dedupe", topic.slug, drop)

    # The same URL can come from two sources or two keywords: keep the first.
    unique, seen_urls = [], set()
    for candidate in kept:
        if candidate.url in seen_urls:
            drop = Drop(url=candidate.url, title=candidate.title, reason="seen", detail={"duplicate_in_run": True})
            dedupe_drops.append(drop)
            writer.emit_drop("dedupe", topic.slug, drop)
        else:
            seen_urls.add(candidate.url)
            unique.append(candidate)
    kept = unique
    tally.count("dedupe", scope, in_window, len(kept), dedupe_drops)

    rubric = summarize.rubric_hash(topic, ctx.preset.reader)
    to_rank, cached, cached_below = rank_cache.partition(kept, state, topic, rubric)
    for drop in cached_below:
        writer.emit_drop("dedupe", topic.slug, drop)
    tally.count("cache", scope, len(kept), len(to_rank) + len(cached), cached_below)
    tally.count("enrich", scope, len(to_rank), len(to_rank))

    fresh = ctx.adapters.ranker.rank_topic(topic, to_rank)
    rank_cache.record(state, fresh, topic.slug, rubric, now)

    eligible = list(cached)
    below: list[RankedItem] = []
    for ranked in fresh:
        (eligible if ranked.score >= topic.min_relevance else below).append(ranked)
    below_drops = [
        Drop(
            url=ranked.item.url,
            title=ranked.item.title,
            reason="below_relevance",
            detail={"score": ranked.score, "min_relevance": topic.min_relevance},
        )
        for ranked in below
    ]
    for drop in below_drops:
        writer.emit_drop("rank", topic.slug, drop)
    tally.count("rank", scope, len(to_rank) + len(cached), len(eligible), below_drops)

    queued_before = rank_cache.queued_in_last_24h(state, topic.slug, now)
    remaining = max(0, topic.max_items_per_day - queued_before)
    keep, over_cap = rank_cache.select(eligible, remaining)
    over_drops = [
        Drop(
            url=ranked.item.url,
            title=ranked.item.title,
            reason="over_max_items",
            detail={"max_items_per_day": topic.max_items_per_day, "queued_last_24h": queued_before},
        )
        for ranked in over_cap
    ]
    for drop in over_drops:
        writer.emit_drop("rank", topic.slug, drop)
    tally.count("cap", scope, len(eligible), len(keep), over_drops)
    tally.count("queue", scope, len(keep), 0)
    for ranked in keep:
        writer.emit(
            "rank",
            "kept",
            topic=topic.slug,
            source=ranked.item.kind,
            url=ranked.item.url,
            title=ranked.item.title,
            score=ranked.score,
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
        [("queue", ranked) for ranked in result.kept]
        + [("over cap", ranked) for ranked in result.over_cap]
        + [("below", ranked) for ranked in sorted(result.below, key=lambda r: r.score, reverse=True)]
    )
    for verdict, ranked in rows:
        lines.append(
            f"  {verdict:<12} {ranked.score:>2}  {ranked.item.kind:<6}  "
            f"{ranked.item.title[:PREVIEW_TITLE_CHARS]}"
        )
        lines.append(f"  {'':<12}     {ranked.summary}")
    for drop in result.cached_below:
        lines.append(f"  {'cached-below':<12} {drop.detail['relevance']:>2}  {'':<6}  {drop.title[:PREVIEW_TITLE_CHARS]}")
    if len(lines) == 1:
        lines.append("  (nothing to score)")
    return "\n".join(lines)
