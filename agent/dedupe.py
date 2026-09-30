"""Persistent seen-URL state: hashes, first-seen dates, score history,
send counts, inbox dismissals, and per-topic ranking verdicts (`ranks`,
read and written by agent/rank_cache.py). filter_seen drops items that were
actually delivered before, or that the inbox dismissed (rejected by
Artem, or expired undecided) — a candidate that was collected and
dropped in a past run for any other reason is not a duplicate, and stays
eligible."""

from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, dataclass, field
from datetime import datetime
from pathlib import Path

from agent.sources.base import Candidate, Drop


@dataclass
class RankRecord:
    """One topic's cached verdict on one URL — see agent/rank_cache.py."""

    relevance: int  # 1-10
    summary: str
    rubric: str  # summarize.rubric_hash at scoring time
    source_score: int | None  # HN points / GitHub stars at scoring time
    ranked_at: str  # ISO 8601
    queued_at: str | None = None  # set when this topic put the item in the pending queue


@dataclass
class StateEntry:
    first_seen: str  # ISO 8601
    last_score: int | None
    times_sent: int
    dismissed: str | None = None  # "rejected" | "expired" -- set by the inbox, never cleared
    ranks: dict[str, RankRecord] = field(default_factory=dict)  # topic slug -> verdict


def url_hash(url: str) -> str:
    return hashlib.sha256(url.encode("utf-8")).hexdigest()[:16]


def _entry_from_raw(value: dict) -> StateEntry:
    ranks = {slug: RankRecord(**record) for slug, record in value.get("ranks", {}).items()}
    return StateEntry(**{**value, "ranks": ranks})


def load_state(path: Path) -> dict[str, StateEntry]:
    if not path.exists():
        return {}
    raw = json.loads(path.read_text(encoding="utf-8"))
    return {key: _entry_from_raw(value) for key, value in raw.items()}


def save_state(path: Path, state: dict[str, StateEntry]) -> None:
    raw = {key: asdict(entry) for key, entry in state.items()}
    path.write_text(json.dumps(raw, indent=2, sort_keys=True), encoding="utf-8")


def record_seen(state: dict[str, StateEntry], candidate: Candidate, now: datetime) -> None:
    """Update (or create) the state entry for a candidate. Called for
    every candidate collected this run, whether or not it survives later
    filters — this is how score history accumulates for items that are
    outside the window or below threshold today but might not be next
    week."""
    key = url_hash(candidate.url)
    entry = state.get(key)
    if entry is None:
        state[key] = StateEntry(first_seen=now.isoformat(), last_score=candidate.score, times_sent=0)
    else:
        entry.last_score = candidate.score


def mark_sent_url(state: dict[str, StateEntry], url: str) -> None:
    """Called once an item has actually been delivered. Requires
    record_seen to have already run for this URL in some prior run — a
    KeyError here means the pipeline sent something it never recorded,
    which is a bug worth surfacing loudly rather than papering over.
    Takes a bare URL (not a Candidate) because the pending queue stores
    items as flat PendingItem records, not Candidates."""
    state[url_hash(url)].times_sent += 1


def dismiss_url(state: dict[str, StateEntry], url: str, reason: str) -> None:
    """Called when the inbox drops a queued item for good -- rejected by
    Artem, or expired undecided. Like mark_sent_url, a KeyError means the
    queue held something record_seen never saw, which is a bug worth
    surfacing loudly. filter_seen reads this so a dismissed item still
    inside the recency window isn't re-collected, re-ranked and re-queued."""
    state[url_hash(url)].dismissed = reason


def filter_seen(
    candidates: list[Candidate],
    state: dict[str, StateEntry],
) -> tuple[list[Candidate], list[Drop]]:
    kept: list[Candidate] = []
    drops: list[Drop] = []
    for candidate in candidates:
        entry = state.get(url_hash(candidate.url))
        if entry is not None and entry.times_sent > 0:
            drops.append(
                Drop(
                    url=candidate.url,
                    title=candidate.title,
                    reason="seen",
                    detail={"times_sent": entry.times_sent},
                )
            )
        elif entry is not None and entry.dismissed is not None:
            drops.append(
                Drop(
                    url=candidate.url,
                    title=candidate.title,
                    reason="dismissed",
                    detail={"dismissed": entry.dismissed},
                )
            )
        else:
            kept.append(candidate)
    return kept, drops
