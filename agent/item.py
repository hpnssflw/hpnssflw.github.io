"""The record every source produces and every pipeline stage passes on."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime


@dataclass(frozen=True)
class Item:
    """One collected item. published_at is mandatory -- a source that
    cannot determine a date drops the item instead of inventing one."""

    url: str  # the original; state.json keys on its hash
    title: str
    kind: str  # hn | github | rss
    source_id: str  # hacker_news | github_trending | a feed id from the preset
    source_name: str  # Hacker News | GitHub | a feed name from the preset
    topic: str | None  # topic slug; None for a preset feed's item until classified
    published_at: datetime  # timezone-aware UTC
    score: int | None  # HN points, GitHub stars; None where the source has none
    text: str | None  # excerpt, feed text or full text
