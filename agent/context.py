"""What one run hands to every stage: the preset, the mutable state and
queue, the adapters (ranker, approval, delivery) and the clock."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from agent.dedupe import StateEntry
from agent.pending import PendingQueue
from agent.preset import Preset
from agent.run_result import Tally
from agent.stories import StoryStore


@dataclass
class Adapters:
    ranker: Any  # rank_topic(topic, items) / classify(items, topics) -> list[RankedItem]
    approval: Any  # load() -> {url: "approve" | "reject"}; raises inbox.DecisionsUnavailable
    delivery: Any  # label: str; send(messages, run_id) -> None
    fetcher: Any = None  # get(url) -> fetch.Fetched; RSS feeds and full text
    offline: bool = False  # True when nothing above reaches the network


@dataclass
class RunContext:
    preset: Preset
    state: dict[str, StateEntry]
    queue: PendingQueue
    adapters: Adapters
    now: datetime
    writer: Any  # events.EventWriter or events.MemoryWriter
    tally: Tally
    seen_urls: set[str] = field(default_factory=set)  # every URL collected this run
    stories: StoryStore | None = None  # presets with `stories:` only
    preview: bool = False  # --preview: no facts calls, nothing saved
