"""The approval stage's adapters: where a run's approve/reject decisions
come from. Each loads {url: DecisionEntry} or raises inbox.DecisionsUnavailable
(then nothing is dropped or delivered this run); merge_decisions folds in
Telegram's taps and inbox.apply_decisions does the rest."""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path

from agent import inbox
from agent.preset import Preset


class InboxApproval:
    """Tony's inbox: decisions.json in hpnssflw/tony-inbox, written by the
    site's /researcher/queue/ owner mode."""

    def __init__(self, decisions_url: str, token_env: str) -> None:
        self.decisions_url = decisions_url
        self.token_env = token_env

    def load_entries(self) -> dict[str, inbox.DecisionEntry]:
        return inbox.load_decision_entries(self.decisions_url, os.environ.get(self.token_env))

    def load(self) -> dict[str, str]:
        return inbox.decisions_of(self.load_entries())


class FileApproval:
    """A local decisions.json in the inbox's v1 format (the demo presets'
    fixture)."""

    def __init__(self, path: Path) -> None:
        self.path = path

    def load_entries(self) -> dict[str, inbox.DecisionEntry]:
        try:
            raw = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, ValueError) as exc:
            raise inbox.DecisionsUnavailable(f"{self.path.name}: {exc}") from exc
        return inbox.parse_decision_entries(raw)

    def load(self) -> dict[str, str]:
        return inbox.decisions_of(self.load_entries())


def approval_for(preset: Preset) -> InboxApproval | FileApproval:
    if preset.approval.type == "inbox":
        return InboxApproval(preset.approval.decisions_url, preset.approval.token_env)
    return FileApproval(preset.approval.path)


def merge_decisions(
    site: dict[str, inbox.DecisionEntry], telegram: dict[str, inbox.DecisionEntry]
) -> dict[str, str]:
    """The decisions a run applies: per URL, the later of the site's entry
    and Telegram's (a tie goes to the site); Telegram's "clear" (Undo)
    leaves the item undecided. lib/telegram-decisions.ts mirrors this, and
    agent/tests/fixtures/approval-merge.json pins both."""
    merged: dict[str, str] = {}
    for url in sorted(site.keys() | telegram.keys()):
        ours, theirs = site.get(url), telegram.get(url)
        winner = ours if theirs is None or (ours is not None and _when(ours.at) >= _when(theirs.at)) else theirs
        if winner.decision != "clear":
            merged[url] = winner.decision
    return merged


def _when(at: str) -> datetime:
    """An unparseable time counts as the oldest; one without an offset as UTC."""
    try:
        moment = datetime.fromisoformat(at)
    except ValueError:
        return datetime.min.replace(tzinfo=timezone.utc)
    return moment if moment.tzinfo is not None else moment.replace(tzinfo=timezone.utc)
