"""Pure aggregation over a run's JSONL events into per-topic funnel
counts. Counts only what the agent's pipeline already decided — never
recomputes a filter. `scored`/`kept` only mean anything for a real run
(no rank stage exists in a dry run), so `is_real_run` tells the caller
whether those two columns are meaningful."""

from __future__ import annotations


def compute_funnel(events: list[dict]) -> dict:
    is_real_run = any(event.get("stage") == "deliver" for event in events)
    topics: dict[str, dict] = {}

    def topic_entry(slug: str) -> dict:
        return topics.setdefault(
            slug,
            {
                "collected": 0,
                "dated": 0,
                "in_window": 0,
                "new": 0,
                "scored": 0,
                "kept": 0,
                "drops": {},
            },
        )

    for event in events:
        topic = event.get("topic")
        if topic is None:
            continue
        entry = topic_entry(topic)
        stage = event.get("stage")
        kind = event.get("event")
        if kind == "candidate" and stage == "collect":
            entry["collected"] += 1
            entry["dated"] += 1
        elif kind == "drop":
            reason = event["reason"]
            entry["drops"][reason] = entry["drops"].get(reason, 0) + 1
            if stage == "collect":
                entry["collected"] += 1  # undated candidates were still collected

    for entry in topics.values():
        drops = entry["drops"]
        entry["in_window"] = entry["dated"] - drops.get("outside_window", 0)
        entry["new"] = (
            entry["in_window"]
            - drops.get("seen", 0)
            - drops.get("dismissed", 0)
            - drops.get("already_ranked", 0)
        )
        entry["scored"] = entry["new"] - drops.get("below_relevance", 0)
        entry["kept"] = entry["scored"] - drops.get("over_max_items", 0)

    return {"is_real_run": is_real_run, "topics": topics}
