"""Where one preset's run data lives -- the --data-dir. Tony's default is
agent/ itself, where agent-run.yml expects state.json, pending.json and
status.json."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class DataPaths:
    root: Path

    @property
    def state(self) -> Path:
        return self.root / "state.json"

    @property
    def pending(self) -> Path:
        return self.root / "pending.json"

    @property
    def status(self) -> Path:
        return self.root / "status.json"

    @property
    def runs(self) -> Path:
        return self.root / "runs"

    @property
    def result(self) -> Path:
        return self.root / "run-result.json"

    @property
    def outbox(self) -> Path:
        return self.root / "outbox"
