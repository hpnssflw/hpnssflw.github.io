"""Environment for local runs: agent/.env, loaded without overriding the
real environment. Tony's settings live in agent/presets/tony.yaml."""

from __future__ import annotations

import os
from pathlib import Path


def load_env(path: Path) -> None:
    """Load KEY=VALUE lines from path into os.environ, without overwriting
    variables the real environment already set."""
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip())
