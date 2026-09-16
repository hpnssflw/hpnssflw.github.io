"""Shared types every source connector and pipeline stage depends on."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime


@dataclass(frozen=True)
class Candidate:
    """One item a source connector found. published_at is mandatory —
    a connector that cannot determine a date drops the item instead of
    inventing one."""

    url: str
    title: str
    source: str  # hn | github | reddit | rss | releases | web
    topic: str  # topic slug
    published_at: datetime  # timezone-aware UTC
    score: int | None  # HN points, Reddit ups; None where the source has no score
    excerpt: str | None


@dataclass(frozen=True)
class Drop:
    """A candidate (or would-be candidate) that a pipeline stage rejected,
    with enough detail to answer "why" without reading code."""

    url: str
    title: str
    reason: str  # undated | outside_window | below_min_points | seen | below_relevance | over_max_items
    detail: dict


@dataclass(frozen=True)
class TopicConfig:
    """One topic's fully merged configuration — defaults.yaml with this
    topic's overrides from topics/<slug>.yaml applied on top."""

    slug: str
    name: str
    description: str
    keywords: list[str]
    sources: dict
    max_age_days: int
    min_relevance: int
    max_items: int
    attention_enabled: bool
    attention_min_score_gain: int
