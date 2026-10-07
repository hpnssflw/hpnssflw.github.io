"""Where one preset's run data lives -- the --data-dir, or the preset's data.default_dir (Tony: agent/, where agent-run.yml expects it)."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from agent.preset import Preset, PresetError


def for_preset(preset: Preset, data_dir: Path | None) -> DataPaths:
    """--data-dir if given; otherwise the preset's data.default_dir. A preset without one (the demos) needs --data-dir, so it can't overwrite Tony's local state."""
    root = data_dir if data_dir is not None else preset.default_data_dir
    if root is None:
        raise PresetError(f"--data-dir is required for preset {preset.slug!r}")
    root.mkdir(parents=True, exist_ok=True)
    return DataPaths(root)


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

    @property
    def stories(self) -> Path:
        return self.root / "stories.json"
