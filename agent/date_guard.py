"""Recency window enforcement — the single place max_age_days is checked,
independent of whether a connector already filtered server-side."""

from __future__ import annotations

from datetime import datetime, timedelta

from agent.item import Item
from agent.sources.base import Drop


def apply_recency_window(
    candidates: list[Item],
    max_age_days: int,
    now: datetime,
) -> tuple[list[Item], list[Drop]]:
    """Keep candidates published within max_age_days of now; drop the rest."""
    cutoff = now - timedelta(days=max_age_days)
    kept: list[Item] = []
    drops: list[Drop] = []
    for candidate in candidates:
        if candidate.published_at >= cutoff:
            kept.append(candidate)
        else:
            drops.append(
                Drop(
                    url=candidate.url,
                    title=candidate.title,
                    reason="outside_window",
                    detail={
                        "published_at": candidate.published_at.isoformat(),
                        "max_age_days": max_age_days,
                    },
                )
            )
    return kept, drops
