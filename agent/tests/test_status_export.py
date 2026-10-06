import json

from agent.pending import PendingQueue
from agent.status_export import build_status
from agent.tests.conftest import FROZEN_NOW

TOPIC_NAMES = {"tooling": "Tooling", "ai-engineering": "AI Engineering"}
SECRETS = ("boom", "secret", "deepseek down", "telegram 500")


def _ev(stage, event, **fields):
    return {"ts": FROZEN_NOW.isoformat(), "stage": stage, "event": event, **fields}


EVENTS = [
    _ev("inbox", "drop", topic="tooling", reason="rejected", title="r"),
    _ev("inbox", "failed", detail={"error": "boom"}),
    *[_ev("collect", "candidate", topic="tooling", source="hn", title=f"t{i}") for i in range(3)],
    _ev(
        "collect",
        "failed",
        topic="tooling",
        source="github_trending",
        detail={"error": "HTTPError https://api.github.com/search?q=secret"},
    ),
    _ev("date_guard", "drop", topic="tooling", reason="outside_window", title="old"),
    _ev("dedupe", "drop", topic="tooling", reason="seen", title="s"),
    _ev("dedupe", "drop", topic="tooling", reason="already_ranked", title="a"),
    _ev("rank", "failed", topic="ai-engineering", detail={"error": "deepseek down"}),
    # A topic retired since the run: neither its failure nor its drops show.
    _ev("collect", "failed", topic="retired", source="hacker_news", detail={"error": "x"}),
    _ev("dedupe", "drop", topic="retired", reason="seen", title="gone"),
    _ev("deliver", "failed", detail={"error": "telegram 500"}),
    _ev("run", "complete", detail={"delivered": False, "pending_total": 0}),
]


def _status():
    return build_status(EVENTS, TOPIC_NAMES, PendingQueue(last_email_at=None, items=[]), 24, 4, None, FROZEN_NOW)


def test_drops_count_each_reason_by_topic_and_stage():
    assert _status()["drops"] == {
        "tooling": {
            "inbox": {"rejected": 1},
            "date_guard": {"outside_window": 1},
            "dedupe": {"seen": 1, "already_ranked": 1},
        },
        "ai-engineering": {},
    }


def test_failures_name_the_stage_never_the_error_text():
    status = _status()
    assert status["failures"] == [
        {"stage": "inbox", "topic": None, "source": None},
        {"stage": "collect", "topic": "tooling", "source": "github_trending"},
        {"stage": "rank", "topic": "ai-engineering", "source": None},
        {"stage": "deliver", "topic": None, "source": None},
    ]
    dumped = json.dumps(status)
    for secret in SECRETS:
        assert secret not in dumped, secret


def test_drops_and_failures_leave_the_funnel_and_streak_alone():
    status = _status()
    assert status["funnel"]["tooling"] == {"collected": 3, "in_window": 2, "new": 0, "kept": 0}
    assert status["streak"] == 1
