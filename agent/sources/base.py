"""Shared types every source connector and pipeline stage depends on
(the collected record itself, Item, lives in agent/item.py)."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Drop:
    """An item (or would-be item) that a pipeline stage rejected,
    with enough detail to answer "why" without reading code."""

    url: str
    title: str
    reason: str  # undated | outside_window | below_min_points | seen | dismissed | already_ranked | below_relevance | over_max_items | rejected | expired
    detail: dict


@dataclass(frozen=True)
class FeedConfig:
    """One RSS/Atom feed from a preset: under the preset's `sources.rss`
    (its items get a topic from classification) or under a topic's
    `sources.rss` (its items belong to that topic)."""

    id: str
    name: str
    url: str
    full_text: bool = False  # fetch each article's full text before ranking


@dataclass(frozen=True)
class TopicConfig:
    """One topic's fully merged configuration — defaults.yaml with this
    topic's overrides from topics/<slug>.yaml applied on top."""

    slug: str
    name: str
    description: str
    keywords: list[str]
    include: list[str]  # ranker criteria: what fits this topic
    exclude: list[str]  # ranker criteria: what doesn't, even if the keywords match
    sources: dict
    max_age_days: int
    min_relevance: int
    max_items_per_day: int  # rolling 23h cap on items this topic adds to the queue
    attention_enabled: bool
    attention_min_score_gain: int
    feeds: tuple[FeedConfig, ...] = ()  # topic-scoped RSS feeds (a preset's topics only)
