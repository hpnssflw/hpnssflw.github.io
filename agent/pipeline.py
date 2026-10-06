"""The pipeline's two paths, shared by the real run and --preview:

- process_topic: one topic's query sources (HN, GitHub) and its own
  feeds -- collect, recency window, dedupe, verdict cache, full text,
  rank against the topic, daily cap, queue;
- process_feeds: the preset's own feeds, once per run -- the same stages,
  but classification picks each item's topic.

Both mutate the state and queue in the RunContext; the caller decides
whether to save them."""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass

from agent import date_guard, dedupe, pending, rank_cache, summarize
from agent.context import RunContext
from agent.item import Item
from agent.run_result import FEED_SCOPE
from agent.sources import fulltext, github_trending, hn, rss
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


@dataclass
class FeedResult:
    kept: dict[str, list[RankedItem]]  # topic slug -> queued this run
    over_cap: dict[str, list[RankedItem]]
    below: list[RankedItem]  # fresh, below their topic's min_relevance, or failed
    off_topic: list[RankedItem]  # fresh, no topic fits
    cached_below: list[Drop]  # already_ranked


def _collect_source(ctx: RunContext, scope: str, event_topic: str | None, source_id: str, fetch) -> tuple[list[Item], int]:
    """Run one source; record what it found (events, state, tally, the
    run's URL set). A failing source is recorded and yields nothing."""
    label = "preset feeds" if scope == FEED_SCOPE else scope
    try:
        items, drops = fetch()
    except Exception as exc:  # noqa: BLE001 — one source failing must not abort the topic or the run
        ctx.writer.emit("collect", "failed", topic=event_topic, source=source_id, detail={"error": str(exc)})
        ctx.tally.fail("collect", scope, source_id, exc)
        print(f"{source_id} collection failed for {label}: {exc}")
        return [], 0
    ctx.tally.count("collect", scope, len(items) + len(drops), len(items), drops)
    for item in items:
        ctx.writer.emit_candidate("collect", source_id, event_topic, item)
        dedupe.record_seen(ctx.state, item, ctx.now)
        ctx.seen_urls.add(item.url)
    for drop in drops:
        ctx.writer.emit_drop("collect", event_topic, drop)
    return items, len(items) + len(drops)


def collect_topic(topic: TopicConfig, ctx: RunContext) -> tuple[list[Item], int]:
    """Collect stage for one topic: its query sources, then its own feeds.
    Returns (items, everything found including drops)."""
    collected: list[Item] = []
    found = 0
    for source_name, connector in CONNECTORS.items():
        if source_name in topic.sources:
            items, n = _collect_source(ctx, topic.slug, topic.slug, source_name, lambda c=connector: c(topic, ctx.now))
            collected += items
            found += n
    for feed in topic.feeds:
        items, n = _collect_source(
            ctx, topic.slug, topic.slug, feed.id, lambda f=feed: rss.collect_feed(f, topic.slug, ctx.adapters.fetcher)
        )
        collected += items
        found += n
    return collected, found


def collect_feeds(ctx: RunContext) -> tuple[list[Item], int]:
    """Collect stage for the preset's own feeds (items without a topic)."""
    collected: list[Item] = []
    found = 0
    for feed in ctx.preset.feeds:
        items, n = _collect_source(
            ctx, FEED_SCOPE, None, feed.id, lambda f=feed: rss.collect_feed(f, None, ctx.adapters.fetcher)
        )
        collected += items
        found += n
    return collected, found


def _enrich(ctx: RunContext, scope: str, items: list[Item], full_text_feeds: set[str]) -> list[Item]:
    if not full_text_feeds:
        ctx.tally.count("enrich", scope, len(items), len(items))
        return items
    enriched, fetched, failed = fulltext.enrich(items, full_text_feeds, ctx.adapters.fetcher)
    ctx.tally.count("enrich", scope, len(items), len(enriched))
    ctx.tally.note("enrich", scope, "full_text", fetched)
    ctx.tally.note("enrich", scope, "full_text_failed", failed)
    return enriched


def process_topic(topic: TopicConfig, ctx: RunContext) -> TopicResult:
    state, queue, now, writer, tally = ctx.state, ctx.queue, ctx.now, ctx.writer, ctx.tally
    scope = topic.slug
    all_candidates, _ = collect_topic(topic, ctx)

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
    to_rank = _enrich(ctx, scope, to_rank, {feed.id for feed in topic.feeds if feed.full_text})

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

    keep, over_cap, queued_before = _cap_and_queue(topic, eligible, ctx)
    return TopicResult(
        kept=keep, over_cap=over_cap, below=below, cached_below=cached_below, queued_before=queued_before
    )


def _cap_and_queue(topic: TopicConfig, eligible: list[RankedItem], ctx: RunContext):
    """The daily cap for one topic, then the queue. Returns (kept,
    over_cap, queued_before)."""
    state, now, writer, tally = ctx.state, ctx.now, ctx.writer, ctx.tally
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
    tally.count("cap", topic.slug, len(eligible), len(keep), over_drops)
    tally.count("queue", topic.slug, len(keep), 0)
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
    pending.add_kept(ctx.queue, topic.name, keep, now)
    return keep, over_cap, queued_before


def process_feeds(ctx: RunContext) -> FeedResult:
    """The preset's own feeds, once per run, after every topic: items are
    classified across all topics, then each topic's threshold and daily
    cap apply (the cap shared with that topic's own sources)."""
    preset, state, queue, now, writer, tally = ctx.preset, ctx.state, ctx.queue, ctx.now, ctx.writer, ctx.tally
    scope = FEED_SCOPE
    collected_by_topics = set(ctx.seen_urls)
    collected, _ = collect_feeds(ctx)

    kept, drops = date_guard.apply_recency_window(collected, preset.max_age_days, now)
    for drop in drops:
        writer.emit_drop("date_guard", None, drop)
    tally.count("window", scope, len(collected), len(kept), drops)

    in_window = len(kept)
    dedupe_drops: list[Drop] = []
    kept, drops = dedupe.filter_seen(kept, state)
    dedupe_drops += drops
    kept, drops = pending.filter_already_pending(kept, queue)
    dedupe_drops += drops
    unique, urls = [], set()
    for item in kept:
        if item.url in collected_by_topics or item.url in urls:
            dedupe_drops.append(Drop(url=item.url, title=item.title, reason="seen", detail={"duplicate_in_run": True}))
        else:
            urls.add(item.url)
            unique.append(item)
    kept = unique
    for drop in dedupe_drops:
        writer.emit_drop("dedupe", None, drop)
    tally.count("dedupe", scope, in_window, len(kept), dedupe_drops)

    topics = list(preset.topics)
    by_slug = {topic.slug: topic for topic in topics}
    rubric = summarize.classify_rubric_hash(topics, preset.reader, preset.language)
    to_rank, cached, cached_below = rank_cache.partition_classified(kept, state, rubric, by_slug)
    for drop in cached_below:
        writer.emit_drop("dedupe", None, drop)
    tally.count("cache", scope, len(kept), len(to_rank) + len(cached), cached_below)
    to_rank = _enrich(ctx, scope, to_rank, {feed.id for feed in preset.feeds if feed.full_text})

    fresh = ctx.adapters.ranker.classify(to_rank, topics) if to_rank else []
    rank_cache.record_classified(state, fresh, rubric, now)

    eligible: dict[str, list[RankedItem]] = defaultdict(list)
    for ranked in cached:
        eligible[ranked.item.topic].append(ranked)
    below: list[RankedItem] = []
    off_topic: list[RankedItem] = []
    for ranked in fresh:
        topic = by_slug.get(ranked.item.topic)
        if ranked.failed or (topic is not None and ranked.score < topic.min_relevance):
            below.append(ranked)
        elif topic is None:
            off_topic.append(ranked)
        else:
            eligible[topic.slug].append(ranked)
    rank_drops = [
        Drop(
            url=ranked.item.url,
            title=ranked.item.title,
            reason="below_relevance",
            detail={"score": ranked.score, "topic": ranked.item.topic, "failed": ranked.failed},
        )
        for ranked in below
    ] + [
        Drop(url=ranked.item.url, title=ranked.item.title, reason="off_topic", detail={"score": ranked.score})
        for ranked in off_topic
    ]
    for drop in rank_drops:
        writer.emit_drop("rank", drop.detail.get("topic"), drop)
    tally.count("rank", scope, len(to_rank) + len(cached), sum(len(v) for v in eligible.values()), rank_drops)
    for slug, entries in eligible.items():
        tally.assign(slug, len(entries))

    kept_by_topic: dict[str, list[RankedItem]] = {}
    over_by_topic: dict[str, list[RankedItem]] = {}
    for topic in topics:
        if eligible.get(topic.slug):
            kept_by_topic[topic.slug], over_by_topic[topic.slug], _ = _cap_and_queue(topic, eligible[topic.slug], ctx)
    return FeedResult(
        kept=kept_by_topic, over_cap=over_by_topic, below=below, off_topic=off_topic, cached_below=cached_below
    )


PREVIEW_TITLE_CHARS = 90


def _rows(lines: list[str], rows: list[tuple[str, RankedItem]]) -> None:
    for verdict, ranked in rows:
        lines.append(
            f"  {verdict:<12} {ranked.score:>2}  {ranked.item.kind:<6}  "
            f"{ranked.item.title[:PREVIEW_TITLE_CHARS]}"
        )
        lines.append(f"  {'':<12}     {ranked.summary}")


def format_preview(topic: TopicConfig, result: TopicResult) -> str:
    """One row per item and verdict, summaries indented below -- what a
    real run would queue, and why the rest wouldn't be."""
    lines = [
        f"\n== {topic.name} ({topic.slug}) -- cap {topic.max_items_per_day}/day, "
        f"{result.queued_before} queued in the last 23h"
    ]
    _rows(
        lines,
        [("queue", ranked) for ranked in result.kept]
        + [("over cap", ranked) for ranked in result.over_cap]
        + [("below", ranked) for ranked in sorted(result.below, key=lambda r: r.score, reverse=True)],
    )
    for drop in result.cached_below:
        lines.append(f"  {'cached-below':<12} {drop.detail['relevance']:>2}  {'':<6}  {drop.title[:PREVIEW_TITLE_CHARS]}")
    if len(lines) == 1:
        lines.append("  (nothing to score)")
    return "\n".join(lines)


def format_feed_preview(topics: list[TopicConfig], result: FeedResult) -> str:
    """The preset feeds' verdicts, one section per assigned topic, then
    what fit no topic."""
    lines: list[str] = []
    for topic in topics:
        below = [r for r in result.below if r.item.topic == topic.slug]
        rows = (
            [("queue", ranked) for ranked in result.kept.get(topic.slug, [])]
            + [("over cap", ranked) for ranked in result.over_cap.get(topic.slug, [])]
            + [("below", ranked) for ranked in sorted(below, key=lambda r: r.score, reverse=True)]
        )
        if rows:
            lines.append(f"\n== {topic.name} ({topic.slug}) -- feeds")
            _rows(lines, rows)
    unplaced = [("off topic", r) for r in result.off_topic] + [("failed", r) for r in result.below if r.item.topic is None]
    if unplaced or result.cached_below:
        lines.append("\n== off topic -- feeds")
        _rows(lines, unplaced)
        for drop in result.cached_below:
            lines.append(f"  {'cached':<12} {drop.detail['relevance']:>2}  {'':<6}  {drop.title[:PREVIEW_TITLE_CHARS]}")
    if not lines:
        lines.append("\n== preset feeds -- (nothing to classify)")
    return "\n".join(lines)
