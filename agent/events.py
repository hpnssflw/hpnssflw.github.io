"""JSONL event emitter for pipeline runs — the substrate for --dry-run
output, the real-run log, and the future run panel."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from agent.sources.base import Candidate, Drop

RUNS_DIR = Path(__file__).parent / "runs"


def new_run_id(now: datetime) -> str:
    return now.strftime("%Y-%m-%dT%H%MZ")


class EventWriter:
    """Appends one JSON object per line to agent/runs/<run_id>.jsonl."""

    def __init__(self, run_id: str, runs_dir: Path = RUNS_DIR) -> None:
        runs_dir.mkdir(parents=True, exist_ok=True)
        self.path = runs_dir / f"{run_id}.jsonl"
        self._file = self.path.open("a", encoding="utf-8")

    def emit(self, stage: str, event: str, **fields: Any) -> None:
        record = {
            "ts": datetime.now(timezone.utc).isoformat(),
            "stage": stage,
            "event": event,
            **fields,
        }
        self._file.write(json.dumps(record, sort_keys=True) + "\n")
        self._file.flush()

    def emit_candidate(self, stage: str, source: str, topic: str, candidate: Candidate) -> None:
        self.emit(
            stage,
            "candidate",
            source=source,
            topic=topic,
            url=candidate.url,
            title=candidate.title,
        )

    def emit_drop(self, stage: str, topic: str, drop: Drop) -> None:
        self.emit(
            stage,
            "drop",
            topic=topic,
            url=drop.url,
            title=drop.title,
            reason=drop.reason,
            detail=drop.detail,
        )

    def close(self) -> None:
        self._file.close()


def read_events(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line]


class MemoryWriter(EventWriter):
    """Same interface as EventWriter, but keeps events in memory and never
    touches disk -- for --preview, which must write nothing."""

    def __init__(self) -> None:  # deliberately skips EventWriter.__init__: no file
        self.path = None
        self.events: list[dict] = []

    def emit(self, stage: str, event: str, **fields: Any) -> None:
        self.events.append(
            {"ts": datetime.now(timezone.utc).isoformat(), "stage": stage, "event": event, **fields}
        )

    def close(self) -> None:
        pass
