"""Entry point: python -m agent [--dry-run | --preview] [--topic SLUG] | panel | report [--days N]"""

from __future__ import annotations

import argparse
import json
import os
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

from agent import config, dedupe, date_guard, deliver, digest, events, inbox, pending, pipeline, status_export

AGENT_DIR = Path(__file__).parent
DEFAULTS_PATH = AGENT_DIR / "defaults.yaml"
TOPICS_DIR = AGENT_DIR / "topics"
STATE_PATH = AGENT_DIR / "state.json"
PENDING_PATH = AGENT_DIR / "pending.json"
STATUS_PATH = AGENT_DIR / "status.json"


def _load_topics(topic_filter: str | None) -> list:
    topics = config.load_topics(TOPICS_DIR, DEFAULTS_PATH)
    if topic_filter:
        topics = [t for t in topics if t.slug == topic_filter]
        if not topics:
            print(f"No topic named {topic_filter!r}", file=sys.stderr)
            sys.exit(1)
    return topics


def run_dry(topic_filter: str | None) -> None:
    now = datetime.now(timezone.utc)
    run_id = events.new_run_id(now)
    writer = events.EventWriter(run_id)

    topics = _load_topics(topic_filter)

    state = dedupe.load_state(STATE_PATH)

    for topic in topics:
        counts: Counter[str] = Counter()
        all_candidates = []
        for source_name, connector in pipeline.CONNECTORS.items():
            if source_name not in topic.sources:
                continue
            try:
                candidates, drops = connector(topic, now)
            except Exception as exc:  # noqa: BLE001 — one source failing must not abort the topic or the run
                writer.emit("collect", "failed", topic=topic.slug, source=source_name, detail={"error": str(exc)})
                print(f"{source_name} collection failed for {topic.slug}: {exc}")
                continue
            counts["collected"] += len(candidates) + len(drops)
            for candidate in candidates:
                writer.emit_candidate("collect", source_name, topic.slug, candidate)
                dedupe.record_seen(state, candidate, now)
            for drop in drops:
                writer.emit_drop("collect", topic.slug, drop)
            all_candidates.extend(candidates)
        counts["dated"] = len(all_candidates)

        kept, drops = date_guard.apply_recency_window(all_candidates, topic.max_age_days, now)
        for drop in drops:
            writer.emit_drop("date_guard", topic.slug, drop)
        counts["in_window"] = len(kept)

        kept, drops = dedupe.filter_seen(kept, state)
        for drop in drops:
            writer.emit_drop("dedupe", topic.slug, drop)
        counts["new"] = len(kept)

        _print_funnel(topic.name, counts)

    dedupe.save_state(STATE_PATH, state)
    writer.close()
    print(f"\nRun recorded: {writer.path}")


def run_real(topic_filter: str | None) -> None:
    now = datetime.now(timezone.utc)
    run_id = events.new_run_id(now)
    writer = events.EventWriter(run_id)

    settings = config.load_settings(DEFAULTS_PATH)
    topics = _load_topics(topic_filter)

    state = dedupe.load_state(STATE_PATH)
    queue = pending.load_pending(PENDING_PATH)

    try:
        decisions = inbox.load_decisions(settings.inbox.decisions_url, os.environ.get("GITHUB_TOKEN"))
    except inbox.DecisionsUnavailable as exc:
        writer.emit("inbox", "failed", detail={"error": str(exc)})
        print(f"Inbox decisions unavailable; nothing is dropped or delivered this run: {exc}")
        approved: list[pending.PendingItem] = []
    else:
        approved, inbox_drops = inbox.apply_decisions(
            queue, decisions, state, now, settings.inbox.expire_days
        )
        for topic_slug, drop in inbox_drops:
            writer.emit_drop("inbox", topic_slug, drop)

    for topic in topics:
        pipeline.process_topic(topic, state, queue, settings, now, writer)

    delivered = False
    if pending.is_email_due(approved, queue.last_email_at, now, settings.delivery.delivery_cadence_hours):
        grouped = pending.group_by_topic(approved)
        messages = digest.build(grouped)
        try:
            deliver.send(messages, settings)
        except Exception as exc:  # noqa: BLE001 — delivery must never crash a scheduled run; retried once due again next time
            writer.emit("deliver", "failed", detail={"error": str(exc), "items": len(approved)})
            print(f"Telegram delivery failed, will retry next run: {exc}")
        else:
            for item in approved:
                dedupe.mark_sent_url(state, item.url)
            sent_urls = {item.url for item in approved}
            queue.items = [item for item in queue.items if item.url not in sent_urls]
            queue.last_email_at = now.isoformat()
            writer.emit("deliver", "sent", detail={"items": len(approved), "topics": len(grouped)})
            delivered = True
            print(f"Sent {len(approved)} approved items across {len(grouped)} topics.")
    else:
        print(
            f"Nothing delivered this run. Pending queue: {len(queue.items)} item(s), "
            f"{len(approved)} approved."
        )

    dedupe.save_state(STATE_PATH, state)
    pending.save_pending(PENDING_PATH, queue)
    writer.emit("run", "complete", detail={"delivered": delivered, "pending_total": len(queue.items)})
    writer.close()

    all_topics = config.load_topics(TOPICS_DIR, DEFAULTS_PATH)
    topic_names = {t.slug: t.name for t in all_topics}
    previous_status = json.loads(STATUS_PATH.read_text(encoding="utf-8")) if STATUS_PATH.exists() else None
    run_events = events.read_events(writer.path)
    status = status_export.build_status(
        run_events, topic_names, queue, settings.delivery.delivery_cadence_hours, 4, previous_status, now
    )
    STATUS_PATH.write_text(json.dumps(status, indent=2, sort_keys=True), encoding="utf-8")

    print(f"Run recorded: {writer.path}")
    print(f"Status written: {STATUS_PATH}")


def run_preview(topic_filter: str | None) -> None:
    """Collect and rank exactly like a real run, against in-memory copies
    of state.json and pending.json, and print what would be queued.
    Writes nothing, reads no inbox, delivers nothing. Copy state.json and
    pending.json from the agent-data branch first for a realistic run."""
    now = datetime.now(timezone.utc)
    settings = config.load_settings(DEFAULTS_PATH)
    topics = _load_topics(topic_filter)
    state = dedupe.load_state(STATE_PATH)
    queue = pending.load_pending(PENDING_PATH)
    writer = events.MemoryWriter()
    for topic in topics:
        result = pipeline.process_topic(topic, state, queue, settings, now, writer)
        print(pipeline.format_preview(topic, result))
    print("\nPreview only: nothing was written.")


def _print_funnel(topic_name: str, counts: Counter[str]) -> None:
    print(f"\n{topic_name}")
    print(
        f"  collected {counts['collected']} -> dated {counts['dated']} "
        f"-> in-window {counts['in_window']} -> new {counts['new']}"
    )


def main() -> None:
    if len(sys.argv) > 1 and sys.argv[1] == "panel":
        from agent.panel import run_panel

        run_panel()
        return
    if len(sys.argv) > 1 and sys.argv[1] == "report":
        from agent.report import run_report

        run_report(sys.argv[2:])
        return

    parser = argparse.ArgumentParser(prog="python -m agent")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--dry-run", action="store_true")
    mode.add_argument("--preview", action="store_true")
    parser.add_argument("--topic", default=None)
    args = parser.parse_args()

    config.load_env(AGENT_DIR / ".env")

    if args.dry_run:
        run_dry(args.topic)
    elif args.preview:
        run_preview(args.topic)
    else:
        run_real(args.topic)


if __name__ == "__main__":
    main()
