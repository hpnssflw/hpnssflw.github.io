"""Builds agent/status.json -- the public aggregate the site's widget
fetches -- from a run's JSONL event log, the pending-email queue, and the
previous status.json's run history.

Deliberately never reads TopicConfig: this module's only entry point
accepts a plain dict[str, str] of slug -> display name, so topic source
config (keywords, subreddits, feed URLs, search queries) has no path into
the output. See docs/superpowers/specs/2026-08-15-agent-status-widget-design.md
§ Redaction."""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime
from typing import Any

from agent.pending import PendingQueue

RECENT_EVENTS_LIMIT = 15
RUN_HISTORY_LIMIT = 24


def build_status(
    run_events: list[dict[str, Any]],
    topic_names: dict[str, str],
    queue: PendingQueue,
    delivery_cadence_hours: int,
    cadence_hours: int,
    previous_status: dict[str, Any] | None,
    now: datetime,
) -> dict[str, Any]:
    funnel: dict[str, dict[str, int]] = {
        slug: {"collected": 0, "in_window": 0, "new": 0, "kept": 0} for slug in topic_names
    }
    recent_events: list[dict[str, Any]] = []
    dropped_by_stage: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))

    for event in run_events:
        topic = event.get("topic")
        if topic not in funnel:
            continue
        stage = event.get("stage")
        kind = event.get("event")

        if stage == "collect" and kind == "candidate":
            funnel[topic]["collected"] += 1
        elif kind == "drop":
            dropped_by_stage[topic][stage] += 1
            recent_events.append(
                {
                    "ts": event["ts"],
                    "verdict": "drop",
                    "topic": topic,
                    "title": event.get("title", ""),
                    "reason": event.get("reason", ""),
                }
            )
        elif stage == "rank" and kind == "kept":
            funnel[topic]["kept"] += 1
            recent_events.append(
                {
                    "ts": event["ts"],
                    "verdict": "kept",
                    "source": event.get("source", ""),
                    "topic": topic,
                    "title": event.get("title", ""),
                    "score": event.get("score"),
                }
            )

    for slug, counts in funnel.items():
        collected = counts["collected"]
        counts["in_window"] = collected - dropped_by_stage[slug].get("date_guard", 0)
        counts["new"] = counts["in_window"] - dropped_by_stage[slug].get("dedupe", 0)

    recent_events.sort(key=lambda e: e["ts"], reverse=True)
    recent_events = recent_events[:RECENT_EVENTS_LIMIT]

    completed = any(e.get("stage") == "run" and e.get("event") == "complete" for e in run_events)
    prev_streak = (previous_status or {}).get("streak", 0)
    streak = prev_streak + 1 if completed else 0

    prev_history = (previous_status or {}).get("run_history", [])
    this_run_kept = sum(counts["kept"] for counts in funnel.values())
    run_history = (prev_history + [{"ts": now.isoformat(), "kept": this_run_kept}])[-RUN_HISTORY_LIMIT:]

    return {
        "updated_at": now.isoformat(),
        "cadence_hours": cadence_hours,
        "streak": streak,
        "last_sent_at": queue.last_email_at,
        "delivery_cadence_hours": delivery_cadence_hours,
        "pending_count": len(queue.items),
        "topics": [
            {"slug": slug, "name": topic_names[slug], "collected": c["collected"], "kept": c["kept"]}
            for slug, c in funnel.items()
        ],
        "funnel": funnel,
        "recent_events": recent_events,
        "run_history": run_history,
    }
