"""Per-(URL, topic) verdict cache and the rolling daily cap. A topic
scores an item once; the verdict is reused until the topic's rubric
changes or the item's points/stars grow enough to deserve a second look
(the preset's `attention` settings). Pure functions over the dedupe
state -- no I/O."""

from __future__ import annotations

from dataclasses import replace
from datetime import datetime, timedelta

from agent.dedupe import RankRecord, StateEntry, url_hash
from agent.item import Item
from agent.sources.base import Drop, TopicConfig
from agent.summarize import RankedItem

# Scheduled Actions start minutes late by varying amounts, so a 24h window frees a
# slot one 4-hour run later; 23h still allows one batch per day at a 4h cadence.
QUEUE_WINDOW = timedelta(hours=23)


def is_valid(record: RankRecord, candidate: Item, rubric: str, topic: TopicConfig) -> bool:
    """A verdict holds unless the rubric changed or the item grew: its
    score at least doubled and rose by attention_min_score_gain. Both
    conditions, so 35 -> 85 HN points counts and 300 -> 350 stars doesn't."""
    if record.rubric != rubric:
        return False
    if not topic.attention_enabled:
        return True
    previous, current = record.source_score, candidate.score
    if previous is None or current is None:
        return True
    grew = current >= 2 * previous and current - previous >= topic.attention_min_score_gain
    return not grew


def partition(
    candidates: list[Item], state: dict[str, StateEntry], topic: TopicConfig, rubric: str
) -> tuple[list[Item], list[RankedItem], list[Drop]]:
    """Split candidates into (to_rank, cached, drops): no valid verdict ->
    to_rank; a valid verdict below min_relevance -> an already_ranked
    drop; a valid verdict at or above it (it lost to the daily cap
    before) -> cached, reused as-is. min_relevance is read live, so
    changing it needs no re-scoring."""
    to_rank: list[Item] = []
    cached: list[RankedItem] = []
    drops: list[Drop] = []
    for candidate in candidates:
        entry = state.get(url_hash(candidate.url))
        verdict = entry.ranks.get(topic.slug) if entry is not None else None
        if verdict is None or not is_valid(verdict, candidate, rubric, topic):
            to_rank.append(candidate)
        elif verdict.relevance < topic.min_relevance:
            drops.append(
                Drop(
                    url=candidate.url,
                    title=candidate.title,
                    reason="already_ranked",
                    detail={"relevance": verdict.relevance},
                )
            )
        else:
            cached.append(RankedItem(item=candidate, summary=verdict.summary, score=verdict.relevance))
    return to_rank, cached, drops


def record(
    state: dict[str, StateEntry], ranked: list[RankedItem], slug: str, rubric: str, now: datetime
) -> None:
    """Cache fresh verdicts. Every ranked item was collected this run, so
    record_seen has already created its state entry. Failed rankings
    aren't cached -- they're retried next run."""
    for entry in ranked:
        if entry.failed:
            continue
        state[url_hash(entry.item.url)].ranks[slug] = RankRecord(
            relevance=entry.score,
            summary=entry.summary,
            rubric=rubric,
            source_score=entry.item.score,
            ranked_at=now.isoformat(),
        )


def queued_in_last_24h(state: dict[str, StateEntry], slug: str, now: datetime) -> int:
    """Items queued for this topic inside the cap window (QUEUE_WINDOW, 23h --
    the name predates the window change)."""
    count = 0
    for entry in state.values():
        verdict = entry.ranks.get(slug)
        if verdict is not None and verdict.queued_at is not None:
            if now - datetime.fromisoformat(verdict.queued_at) < QUEUE_WINDOW:
                count += 1
    return count


def select(eligible: list[RankedItem], remaining: int) -> tuple[list[RankedItem], list[RankedItem]]:
    """Best first -- relevance, then points/stars -- split at the cap."""
    ordered = sorted(eligible, key=lambda entry: (entry.score, entry.item.score or 0), reverse=True)
    return ordered[:remaining], ordered[remaining:]


def mark_queued(state: dict[str, StateEntry], items: list[RankedItem], slug: str, now: datetime) -> None:
    for entry in items:
        state[url_hash(entry.item.url)].ranks[slug].queued_at = now.isoformat()


def mark_queued_url(state: dict[str, StateEntry], url: str, slug: str, now: datetime) -> None:
    """mark_queued for a story's opener: the cap counts stories, not reports."""
    state[url_hash(url)].ranks[slug].queued_at = now.isoformat()


# --- classified verdicts (a preset feed's items) -------------------------
# Stored under ranks[<assigned topic slug>] with the classify rubric, so
# RankRecord and state.json keep their shape and the daily cap
# (queued_in_last_24h) counts them with the topic's other items. An
# off-topic verdict goes under OFF_TOPIC, which no topic slug can be.
OFF_TOPIC = "*"


def partition_classified(
    candidates: list[Item], state: dict[str, StateEntry], rubric: str, topics: dict[str, TopicConfig]
) -> tuple[list[Item], list[RankedItem], list[Drop]]:
    """(to_classify, cached, drops): no verdict with this classify rubric
    -> to_classify; an off-topic verdict, or one below its topic's
    min_relevance -> an already_ranked drop; otherwise cached, reused with
    its topic set on the item."""
    to_classify: list[Item] = []
    cached: list[RankedItem] = []
    drops: list[Drop] = []
    for candidate in candidates:
        entry = state.get(url_hash(candidate.url))
        found = None
        if entry is not None:
            found = next(((slug, r) for slug, r in entry.ranks.items() if r.rubric == rubric), None)
        if found is None:
            to_classify.append(candidate)
            continue
        slug, record = found
        if slug not in topics or record.relevance < topics[slug].min_relevance:
            drops.append(
                Drop(
                    url=candidate.url,
                    title=candidate.title,
                    reason="already_ranked",
                    detail={"relevance": record.relevance, "topic": None if slug == OFF_TOPIC else slug},
                )
            )
        else:
            cached.append(RankedItem(item=replace(candidate, topic=slug), summary=record.summary, score=record.relevance))
    return to_classify, cached, drops


def record_classified(state: dict[str, StateEntry], ranked: list[RankedItem], rubric: str, now: datetime) -> None:
    """Cache fresh classifications. Failed ones aren't cached."""
    for entry in ranked:
        if entry.failed:
            continue
        state[url_hash(entry.item.url)].ranks[entry.item.topic or OFF_TOPIC] = RankRecord(
            relevance=entry.score,
            summary=entry.summary,
            rubric=rubric,
            source_score=entry.item.score,
            ranked_at=now.isoformat(),
        )
