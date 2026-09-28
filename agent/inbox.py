"""Artem's approve/reject decisions for the pending queue. The site's
/researcher/queue/ owner mode is the only writer of decisions.json (in
the hpnssflw/tony-inbox repo); the agent only reads it, at the start of
every real run. See
docs/superpowers/specs/2026-09-28-tony-scraponi-inbox-design.md."""

from __future__ import annotations

from datetime import datetime

import requests

from agent import dedupe
from agent.pending import PendingItem, PendingQueue
from agent.sources.base import Drop

DECISION_VALUES = ("approve", "reject")
TIMEOUT_SECONDS = 15


class DecisionsUnavailable(Exception):
    """decisions.json couldn't be fetched or failed validation. The run
    then treats every item as undecided: nothing is dropped or delivered."""


def parse_decisions(raw: object) -> dict[str, str]:
    """Validate a decoded decisions.json payload and return {url: decision}.
    Any shape problem fails the whole file -- no partial application."""
    if not isinstance(raw, dict) or raw.get("version") != 1:
        raise DecisionsUnavailable("decisions.json: missing or unsupported version")
    entries = raw.get("decisions")
    if not isinstance(entries, dict):
        raise DecisionsUnavailable("decisions.json: 'decisions' is not an object")
    result: dict[str, str] = {}
    for url, entry in entries.items():
        if (
            not isinstance(entry, dict)
            or entry.get("decision") not in DECISION_VALUES
            or not isinstance(entry.get("at"), str)
        ):
            raise DecisionsUnavailable(f"decisions.json: invalid entry for {url}")
        result[url] = entry["decision"]
    return result


def load_decisions(url: str, token: str | None) -> dict[str, str]:
    """GET decisions.json through the GitHub Contents API (raw media type).
    The token is optional -- the repo is public -- but authenticated reads
    dodge the 60/h anonymous limit that Actions runners share by IP."""
    headers = {
        "Accept": "application/vnd.github.raw+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    if token:
        headers["Authorization"] = f"Bearer {token}"
    try:
        response = requests.get(url, headers=headers, timeout=TIMEOUT_SECONDS)
    except requests.RequestException as exc:
        raise DecisionsUnavailable(f"decisions.json fetch failed: {exc}") from exc
    if response.status_code != 200:
        raise DecisionsUnavailable(f"decisions.json fetch failed: HTTP {response.status_code}")
    try:
        raw = response.json()
    except ValueError as exc:
        raise DecisionsUnavailable("decisions.json is not valid JSON") from exc
    return parse_decisions(raw)


def apply_decisions(
    queue: PendingQueue,
    decisions: dict[str, str],
    state: dict[str, dedupe.StateEntry],
    now: datetime,
    expire_days: int,
) -> tuple[list[PendingItem], list[tuple[str, Drop]]]:
    """Drop rejected and expired items from the queue (marking them
    dismissed in state so they're never re-queued) and return the approved
    items plus the drops, each paired with its topic slug for the event
    log. Approved items never expire; undecided ones wait up to
    expire_days. Decisions for URLs not in the queue are ignored."""
    approved: list[PendingItem] = []
    drops: list[tuple[str, Drop]] = []
    remaining: list[PendingItem] = []
    for item in queue.items:
        decision = decisions.get(item.url)
        if decision == "reject":
            dedupe.dismiss_url(state, item.url, "rejected")
            drops.append((item.topic, Drop(url=item.url, title=item.title, reason="rejected", detail={})))
            continue
        if decision == "approve":
            approved.append(item)
            remaining.append(item)
            continue
        age_days = (now - datetime.fromisoformat(item.pending_since)).total_seconds() / 86400
        if age_days > expire_days:
            dedupe.dismiss_url(state, item.url, "expired")
            drops.append(
                (
                    item.topic,
                    Drop(
                        url=item.url,
                        title=item.title,
                        reason="expired",
                        detail={"pending_since": item.pending_since},
                    ),
                )
            )
            continue
        remaining.append(item)
    queue.items = remaining
    return approved, drops
