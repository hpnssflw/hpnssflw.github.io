"""status.json's `drops` and `failures` (docs/superpowers/specs/2026-10-06-tony-control-room-design.md):
the control room's rail reads drop reasons per topic and stage, and which
stages failed -- never the error text, since status.json is public."""

import json

import pytest

from agent.pending import PendingQueue
from agent.status_export import build_status
from agent.tests.conftest import FROZEN_NOW

SECRETS = ("boom", "secret", "deepseek down", "telegram 500")


def _ev(stage, event, **fields):
    return {"ts": FROZEN_NOW.isoformat(), "stage": stage, "event": event, **fields}


@pytest.fixture
def status():
    events = [
        _ev("inbox", "drop", topic="tooling", reason="rejected", title="r"),
        _ev("inbox", "failed", detail={"error": "boom"}),
        *[_ev("collect", "candidate", topic="tooling", source="hn", title=f"t{i}") for i in range(3)],
        _ev("collect", "failed", topic="tooling", source="github_trending",
            detail={"error": "HTTPError https://api.github.com/search?q=secret"}),
        _ev("date_guard", "drop", topic="tooling", reason="outside_window", title="old"),
        _ev("dedupe", "drop", topic="tooling", reason="seen", title="s"),
        _ev("dedupe", "drop", topic="tooling", reason="already_ranked", title="a"),
        _ev("rank", "failed", topic="ai-engineering", detail={"error": "deepseek down"}),
        _ev("collect", "failed", topic="retired", source="hacker_news", detail={"error": "x"}),
        _ev("dedupe", "drop", topic="retired", reason="seen", title="gone"),
        _ev("deliver", "failed", detail={"error": "telegram 500"}),
        _ev("run", "complete", detail={"delivered": False, "pending_total": 0}),
    ]
    return build_status(
        events,
        {"tooling": "Tooling", "ai-engineering": "AI Engineering"},
        PendingQueue(last_email_at=None, items=[]),
        24,
        4,
        None,
        FROZEN_NOW,
    )


def test_drops_count_reasons_per_topic_and_stage_and_skip_retired_topics(status):
    assert status["drops"] == {
        "tooling": {
            "inbox": {"rejected": 1},
            "date_guard": {"outside_window": 1},
            "dedupe": {"seen": 1, "already_ranked": 1},
        },
        "ai-engineering": {},
    }


def test_failures_keep_run_order_with_only_stage_topic_and_source(status):
    # Run-wide failures (no topic) stay; a retired topic's failure does not.
    assert status["failures"] == [
        {"stage": "inbox", "topic": None, "source": None},
        {"stage": "collect", "topic": "tooling", "source": "github_trending"},
        {"stage": "rank", "topic": "ai-engineering", "source": None},
        {"stage": "deliver", "topic": None, "source": None},
    ]


def test_no_error_text_reaches_status_json(status):
    dumped = json.dumps(status)
    for secret in SECRETS:
        assert secret not in dumped, secret


def test_funnel_and_streak_are_unchanged(status):
    assert status["funnel"]["tooling"] == {"collected": 3, "in_window": 2, "new": 0, "kept": 0}
    assert status["streak"] == 1
