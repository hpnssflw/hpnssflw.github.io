"""Pending delivery queue: items ranked above threshold that haven't been
delivered yet, plus when delivery last actually went out. Exists because
collection/ranking now run every 4 hours but delivery stays on a
coarser cadence — see docs/superpowers/specs/2026-08-15-agent-status-widget-design.md
§ Email delivery decoupling.

(Some field/function names below -- e.g. last_email_at, is_email_due --
keep their "email" spelling on purpose, from before delivery moved to
Telegram; only the prose here describes delivery neutrally.)"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from datetime import datetime
from pathlib import Path

from agent.sources.base import Candidate, Drop
from agent.summarize import RankedItem


@dataclass
class PendingItem:
    url: str
    title: str
    source: str
    topic: str
    topic_name: str
    summary: str
    score: int
    pending_since: str  # ISO 8601 -- when this item first entered the queue


@dataclass
class PendingQueue:
    last_email_at: str | None  # ISO 8601, None if delivery has never gone out
    items: list[PendingItem]


def load_pending(path: Path) -> PendingQueue:
    if not path.exists():
        return PendingQueue(last_email_at=None, items=[])
    raw = json.loads(path.read_text(encoding="utf-8"))
    return PendingQueue(
        last_email_at=raw.get("last_email_at"),
        items=[PendingItem(**item) for item in raw.get("items", [])],
    )


def save_pending(path: Path, queue: PendingQueue) -> None:
    raw = {
        "last_email_at": queue.last_email_at,
        "items": [asdict(item) for item in queue.items],
    }
    path.write_text(json.dumps(raw, indent=2, sort_keys=True), encoding="utf-8")


def add_kept(queue: PendingQueue, topic_name: str, ranked: list[RankedItem], now: datetime) -> None:
    for item in ranked:
        queue.items.append(
            PendingItem(
                url=item.candidate.url,
                title=item.candidate.title,
                source=item.candidate.source,
                topic=item.candidate.topic,
                topic_name=topic_name,
                summary=item.summary,
                score=item.score,
                pending_since=now.isoformat(),
            )
        )


def filter_already_pending(candidates: list[Candidate], queue: PendingQueue) -> tuple[list[Candidate], list[Drop]]:
    """Drop candidates already sitting in the queue, awaiting the delivery
    cadence. Without this, an item that survived ranking once but hasn't
    been delivered yet (times_sent still 0, so dedupe.filter_seen lets it
    through) gets re-collected and re-sent to DeepSeek for ranking on
    every subsequent 4h cycle until the delivery gate finally fires."""
    pending_since_by_url = {item.url: item.pending_since for item in queue.items}
    kept: list[Candidate] = []
    drops: list[Drop] = []
    for candidate in candidates:
        since = pending_since_by_url.get(candidate.url)
        if since is not None:
            drops.append(
                Drop(url=candidate.url, title=candidate.title, reason="seen", detail={"pending_since": since})
            )
        else:
            kept.append(candidate)
    return kept, drops


def is_email_due(queue: PendingQueue, now: datetime, cadence_hours: int) -> bool:
    if not queue.items:
        return False
    if queue.last_email_at is None:
        return True
    last = datetime.fromisoformat(queue.last_email_at)
    return (now - last).total_seconds() >= cadence_hours * 3600


def group_by_topic(queue: PendingQueue) -> dict[str, list[PendingItem]]:
    grouped: dict[str, list[PendingItem]] = {}
    for item in queue.items:
        grouped.setdefault(item.topic_name, []).append(item)
    for items in grouped.values():
        items.sort(key=lambda i: i.score, reverse=True)
    return grouped
