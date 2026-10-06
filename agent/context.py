"""What one run hands to every stage: the preset, the mutable state and
queue, the adapters (ranker, approval, delivery) and the clock."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any

from agent.dedupe import StateEntry
from agent.pending import PendingQueue
from agent.preset import Preset


@dataclass
class Adapters:
    ranker: Any  # rank_topic(topic, items) -> list[RankedItem]
    approval: Any  # load() -> {url: "approve" | "reject"}; raises inbox.DecisionsUnavailable
    delivery: Any  # label: str; send(messages, run_id) -> None


@dataclass
class RunContext:
    preset: Preset
    state: dict[str, StateEntry]
    queue: PendingQueue
    adapters: Adapters
    now: datetime
    writer: Any  # events.EventWriter or events.MemoryWriter
