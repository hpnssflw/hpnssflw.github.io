"""The approval stage's adapters: where a run's approve/reject decisions
come from. Each returns {url: "approve" | "reject"} or raises
inbox.DecisionsUnavailable (then nothing is dropped or delivered this
run); inbox.apply_decisions does the rest, whichever adapter it was."""

from __future__ import annotations

import json
import os
from pathlib import Path

from agent import inbox
from agent.preset import Preset


class InboxApproval:
    """Tony's inbox: decisions.json in hpnssflw/tony-inbox, written by the
    site's /researcher/queue/ owner mode."""

    def __init__(self, decisions_url: str, token_env: str) -> None:
        self.decisions_url = decisions_url
        self.token_env = token_env

    def load(self) -> dict[str, str]:
        return inbox.load_decisions(self.decisions_url, os.environ.get(self.token_env))


class FileApproval:
    """A local decisions.json in the inbox's v1 format (the demo presets'
    fixture)."""

    def __init__(self, path: Path) -> None:
        self.path = path

    def load(self) -> dict[str, str]:
        try:
            raw = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, ValueError) as exc:
            raise inbox.DecisionsUnavailable(f"{self.path.name}: {exc}") from exc
        return inbox.parse_decisions(raw)


def approval_for(preset: Preset) -> InboxApproval | FileApproval:
    if preset.approval.type == "inbox":
        return InboxApproval(preset.approval.decisions_url, preset.approval.token_env)
    return FileApproval(preset.approval.path)
