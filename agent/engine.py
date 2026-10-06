"""The engine: one preset's run -- approval, topics, format, delivery,
save -- plus --preview and --dry-run. Everything specific to a client
comes from the Preset and the Adapters; see
docs/superpowers/specs/2026-10-06-content-engine-core-design.md."""

from __future__ import annotations

import json
import sys
from collections import Counter, defaultdict
from datetime import datetime

from agent import dedupe, date_guard, digest, events, inbox, pending, pipeline, status_export
from agent.approval import approval_for
from agent.context import Adapters, RunContext
from agent.deliver import delivery_for
from agent.paths import DataPaths
from agent.preset import Preset
from agent.ranker import LiveRanker
from agent.run_result import FEED_SCOPE, Tally, build_run_result, write_run_result
from agent.sources.base import TopicConfig

# Tony's collection cadence as agent-run.yml schedules it; status.json
# shows it on the site.
LEGACY_RUN_CADENCE_HOURS = 4


def live_adapters(preset: Preset, paths: DataPaths) -> Adapters:
    return Adapters(
        ranker=LiveRanker(preset.llm, preset.reader, preset.language),
        approval=approval_for(preset),
        delivery=delivery_for(preset, paths),
    )


def select_topics(preset: Preset, topic_filter: str | None) -> list[TopicConfig]:
    topics = list(preset.topics)
    if topic_filter:
        topics = [t for t in topics if t.slug == topic_filter]
        if not topics:
            print(f"No topic named {topic_filter!r}", file=sys.stderr)
            sys.exit(1)
    return topics


def _context(preset: Preset, paths: DataPaths, now: datetime, adapters: Adapters, writer) -> RunContext:
    return RunContext(
        preset=preset,
        state=dedupe.load_state(paths.state),
        queue=pending.load_pending(paths.pending),
        adapters=adapters,
        now=now,
        writer=writer,
        tally=Tally([t.slug for t in preset.topics], has_feeds=bool(preset.feeds)),
    )


def run_real(
    preset: Preset, paths: DataPaths, now: datetime, adapters: Adapters, topic_filter: str | None = None
) -> None:
    run_id = events.new_run_id(now)
    writer = events.EventWriter(run_id, paths.runs)
    topics = select_topics(preset, topic_filter)
    ctx = _context(preset, paths, now, adapters, writer)
    state, queue, tally = ctx.state, ctx.queue, ctx.tally

    queued_before_review = Counter(item.topic for item in queue.items)
    decisions: dict[str, str] | None = None
    inbox_drops: list = []
    try:
        decisions = adapters.approval.load()
    except inbox.DecisionsUnavailable as exc:
        writer.emit("inbox", "failed", detail={"error": str(exc)})
        tally.fail("review", FEED_SCOPE, None, exc)
        print(f"Inbox decisions unavailable; nothing is dropped or delivered this run: {exc}")
        approved: list[pending.PendingItem] = []
    else:
        approved, inbox_drops = inbox.apply_decisions(queue, decisions, state, now, preset.approval.expire_days)
        for topic_slug, drop in inbox_drops:
            writer.emit_drop("inbox", topic_slug, drop)
    _tally_review(tally, queued_before_review, queue, inbox_drops, approved)

    for topic in topics:
        try:
            pipeline.process_topic(topic, ctx)
        except Exception as exc:  # noqa: BLE001 — one topic failing (e.g. DeepSeek) must not skip delivery of approved items
            writer.emit("rank", "failed", topic=topic.slug, detail={"error": str(exc)})
            tally.fail("rank", topic.slug, None, exc)
            print(f"Topic {topic.slug} failed: {exc}")

    delivered = False
    due = pending.is_email_due(approved, queue.last_email_at, now, preset.delivery.cadence_hours)
    messages: list[str] = []
    if due:
        grouped = pending.group_by_topic(approved)
        messages = digest.build(grouped, preset.delivery.title, preset.language)
        tally.count("format", FEED_SCOPE, len(approved), len(messages))
        try:
            adapters.delivery.send(messages, run_id)
        except Exception as exc:  # noqa: BLE001 — delivery must never crash a scheduled run; retried once due again next time
            writer.emit("deliver", "failed", detail={"error": str(exc), "items": len(approved)})
            tally.count("deliver", FEED_SCOPE, len(messages), 0)
            tally.fail("deliver", FEED_SCOPE, None, exc)
            print(f"{adapters.delivery.label} delivery failed, will retry next run: {exc}")
        else:
            for item in approved:
                dedupe.mark_sent_url(state, item.url)
            sent_urls = {item.url for item in approved}
            queue.items = [item for item in queue.items if item.url not in sent_urls]
            queue.last_email_at = now.isoformat()
            writer.emit("deliver", "sent", detail={"items": len(approved), "topics": len(grouped)})
            tally.count("deliver", FEED_SCOPE, len(messages), len(messages))
            delivered = True
            print(f"Sent {len(approved)} approved items across {len(grouped)} topics.")
    else:
        print(
            f"Nothing delivered this run. Pending queue: {len(queue.items)} item(s), "
            f"{len(approved)} approved."
        )

    for slug, count in Counter(item.topic for item in queue.items).items():
        tally.count("queue", slug, 0, count)

    dedupe.save_state(paths.state, state)
    pending.save_pending(paths.pending, queue)
    writer.emit("run", "complete", detail={"delivered": delivered, "pending_total": len(queue.items)})
    writer.close()

    write_run_result(
        paths.result,
        build_run_result(
            preset=preset,
            mode="real",
            offline=adapters.offline,
            run_id=run_id,
            now=now,
            tally=tally,
            queue=queue,
            decisions=decisions,
            delivery={
                "target": preset.delivery.type,
                "due": due,
                "sent_items": len(approved) if delivered else 0,
                "messages": len(messages),
                "last_sent_at": queue.last_email_at,
            },
        ),
    )
    if preset.legacy:
        _write_status(preset, paths, writer, queue, now)
    print(f"Run recorded: {writer.path}")
    if preset.legacy:
        print(f"Status written: {paths.status}")


def _tally_review(tally: Tally, before: Counter, queue: pending.PendingQueue, inbox_drops: list, approved: list) -> None:
    after = Counter(item.topic for item in queue.items)
    drops_by_topic = defaultdict(list)
    for slug, drop in inbox_drops:
        drops_by_topic[slug].append(drop)
    approved_by_topic = Counter(item.topic for item in approved)
    for slug in sorted(set(before) | set(after)):
        tally.count("review", slug, before[slug], after[slug], drops_by_topic[slug])
        if approved_by_topic[slug]:
            tally.note("review", slug, "approved", approved_by_topic[slug])


def _write_status(preset: Preset, paths: DataPaths, writer, queue: pending.PendingQueue, now: datetime) -> None:
    """status.json: the public widget's aggregate. Tony's only."""
    topic_names = {t.slug: t.name for t in preset.topics}
    previous_status = json.loads(paths.status.read_text(encoding="utf-8")) if paths.status.exists() else None
    status = status_export.build_status(
        events.read_events(writer.path),
        topic_names,
        queue,
        preset.delivery.cadence_hours,
        LEGACY_RUN_CADENCE_HOURS,
        previous_status,
        now,
    )
    paths.status.write_text(json.dumps(status, indent=2, sort_keys=True), encoding="utf-8")


def run_preview(
    preset: Preset, paths: DataPaths, now: datetime, adapters: Adapters, topic_filter: str | None = None
) -> None:
    """Collect and rank exactly like a real run, against in-memory copies
    of state.json and pending.json, and print what would be queued.
    Writes nothing, reads no approvals, delivers nothing. Copy state.json
    and pending.json from the agent-data branch first for a realistic run."""
    topics = select_topics(preset, topic_filter)
    ctx = _context(preset, paths, now, adapters, events.MemoryWriter())
    for topic in topics:
        try:
            result = pipeline.process_topic(topic, ctx)
        except Exception as exc:  # noqa: BLE001 — a preview of the other topics should still print
            print(f"\n== {topic.name} ({topic.slug}) -- failed: {exc}")
            continue
        print(pipeline.format_preview(topic, result))
    print("\nPreview only: nothing was written.")


def run_dry(
    preset: Preset, paths: DataPaths, now: datetime, adapters: Adapters, topic_filter: str | None = None
) -> None:
    """Collect, window and dedupe with no LLM; saves state.json (score
    history), the run's events and run-result.json."""
    run_id = events.new_run_id(now)
    writer = events.EventWriter(run_id, paths.runs)
    topics = select_topics(preset, topic_filter)
    ctx = _context(preset, paths, now, adapters, writer)
    state, tally = ctx.state, ctx.tally

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
                tally.fail("collect", topic.slug, source_name, exc)
                print(f"{source_name} collection failed for {topic.slug}: {exc}")
                continue
            counts["collected"] += len(candidates) + len(drops)
            tally.count("collect", topic.slug, len(candidates) + len(drops), len(candidates), drops)
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
        tally.count("window", topic.slug, len(all_candidates), len(kept), drops)
        counts["in_window"] = len(kept)

        in_window = len(kept)
        kept, drops = dedupe.filter_seen(kept, state)
        for drop in drops:
            writer.emit_drop("dedupe", topic.slug, drop)
        tally.count("dedupe", topic.slug, in_window, len(kept), drops)
        counts["new"] = len(kept)

        _print_funnel(topic.name, counts)

    dedupe.save_state(paths.state, state)
    writer.close()
    write_run_result(
        paths.result,
        build_run_result(
            preset=preset,
            mode="dry-run",
            offline=adapters.offline,
            run_id=run_id,
            now=now,
            tally=tally,
            queue=ctx.queue,
            decisions=None,
            delivery={
                "target": preset.delivery.type,
                "due": False,
                "sent_items": 0,
                "messages": 0,
                "last_sent_at": ctx.queue.last_email_at,
            },
        ),
    )
    print(f"\nRun recorded: {writer.path}")


def _print_funnel(name: str, counts: Counter[str]) -> None:
    print(f"\n{name}")
    print(
        f"  collected {counts['collected']} -> dated {counts['dated']} "
        f"-> in-window {counts['in_window']} -> new {counts['new']}"
    )
