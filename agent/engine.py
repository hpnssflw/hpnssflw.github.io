"""The engine: one preset's run -- approval, topics, format, delivery,
save -- plus --preview and --dry-run. Everything specific to a client
comes from the Preset and the Adapters; see
docs/superpowers/specs/2026-10-06-content-engine-core-design.md."""

from __future__ import annotations

import json
import sys
from collections import Counter, defaultdict
from datetime import datetime

from agent import dedupe, date_guard, digest, events, inbox, pending, pipeline, status_export, stories
from agent.approval import approval_for
from agent.context import Adapters, RunContext
from agent.deliver import delivery_for
from agent.fetch import LiveFetcher, OfflineFetcher
from agent.paths import DataPaths
from agent.preset import Preset
from agent.ranker import FixtureRanker, LiveRanker
from agent.run_result import FEED_SCOPE, Tally, build_run_result, write_run_result
from agent.sources.base import TopicConfig

# agent-run.yml's collection cadence (every 4 h); status.json shows it on
# the site.
RUN_CADENCE_HOURS = 4


def live_adapters(preset: Preset, paths: DataPaths) -> Adapters:
    return Adapters(
        ranker=LiveRanker(preset.llm, preset.reader, preset.language),
        approval=approval_for(preset),
        delivery=delivery_for(preset, paths),
        fetcher=LiveFetcher(),
    )


def offline_adapters(preset: Preset, paths: DataPaths) -> Adapters:
    """Fixtures instead of the network (preset.require_offline has
    checked that approval and delivery are files)."""
    return Adapters(
        ranker=FixtureRanker(preset.offline.llm, preset.offline.stories),
        approval=approval_for(preset),
        delivery=delivery_for(preset, paths),
        fetcher=OfflineFetcher(preset.offline.http),
        offline=True,
    )


def select_topics(preset: Preset, topic_filter: str | None) -> list[TopicConfig]:
    topics = list(preset.topics)
    if topic_filter:
        topics = [t for t in topics if t.slug == topic_filter]
        if not topics:
            print(f"No topic named {topic_filter!r}", file=sys.stderr)
            sys.exit(1)
    return topics


def _context(
    preset: Preset, paths: DataPaths, now: datetime, adapters: Adapters, writer, preview: bool = False
) -> RunContext:
    return RunContext(
        preset=preset,
        state=dedupe.load_state(paths.state),
        queue=pending.load_pending(paths.pending),
        adapters=adapters,
        now=now,
        writer=writer,
        tally=Tally([t.slug for t in preset.topics], has_feeds=bool(preset.feeds), stories=preset.stories is not None),
        stories=stories.load_store(paths.stories) if preset.stories is not None else None,
        preview=preview,
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
    if preset.feeds and topic_filter is None:
        try:
            pipeline.process_feeds(ctx)
        except Exception as exc:  # noqa: BLE001 — failing feeds must not skip delivery either
            writer.emit("rank", "failed", topic=None, detail={"error": str(exc)})
            tally.fail("rank", FEED_SCOPE, None, exc)
            print(f"Preset feeds failed: {exc}")

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
    if ctx.stories is not None:
        stories.save_store(paths.stories, ctx.stories, now, preset.stories.window_hours, preset.max_age_days)
    writer.emit("run", "complete", detail={"delivered": delivered, "pending_total": len(queue.items)})
    writer.close()

    try:
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
    except Exception as exc:  # noqa: BLE001 — items may be sent already: a failed run record must not fail the run (CI would skip pushing state and deliver them again)
        print(f"Run result not written: {exc}")
    if preset.status_json:
        _write_status(preset, paths, writer, queue, now)
    print(f"Run recorded: {writer.path}")
    if preset.status_json:
        print(f"Status written: {paths.status}")
    print(f"Run result: {paths.result}")


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
    """status.json: the public widget's aggregate, for presets with data.status_json."""
    topic_names = {t.slug: t.name for t in preset.topics}
    previous_status = json.loads(paths.status.read_text(encoding="utf-8")) if paths.status.exists() else None
    status = status_export.build_status(
        events.read_events(writer.path),
        topic_names,
        queue,
        preset.delivery.cadence_hours,
        RUN_CADENCE_HOURS,
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
    ctx = _context(preset, paths, now, adapters, events.MemoryWriter(), preview=True)
    for topic in topics:
        try:
            result = pipeline.process_topic(topic, ctx)
        except Exception as exc:  # noqa: BLE001 — a preview of the other topics should still print
            print(f"\n== {topic.name} ({topic.slug}) -- failed: {exc}")
            continue
        print(pipeline.format_preview(topic, result))
    if preset.feeds and topic_filter is None:
        try:
            print(pipeline.format_feed_preview(list(preset.topics), pipeline.process_feeds(ctx)))
        except Exception as exc:  # noqa: BLE001 — the topics' preview above still stands
            print(f"\n== preset feeds -- failed: {exc}")
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
    state = ctx.state

    for topic in topics:
        collected, found = pipeline.collect_topic(topic, ctx)
        _dry_funnel(ctx, topic.name, topic.slug, topic.slug, collected, found, topic.max_age_days)
    if preset.feeds and topic_filter is None:
        collected, found = pipeline.collect_feeds(ctx)
        _dry_funnel(ctx, "Preset feeds", FEED_SCOPE, None, collected, found, preset.max_age_days)

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
            tally=ctx.tally,
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
    print(f"Run result: {paths.result}")


def _dry_funnel(
    ctx: RunContext, name: str, scope: str, event_topic: str | None, collected: list, found: int, max_age_days: int
) -> None:
    """--dry-run's window and seen/dismissed filter for one scope, and its
    printed funnel line."""
    kept, drops = date_guard.apply_recency_window(collected, max_age_days, ctx.now)
    for drop in drops:
        ctx.writer.emit_drop("date_guard", event_topic, drop)
    ctx.tally.count("window", scope, len(collected), len(kept), drops)
    in_window = len(kept)
    kept, drops = dedupe.filter_seen(kept, ctx.state)
    for drop in drops:
        ctx.writer.emit_drop("dedupe", event_topic, drop)
    ctx.tally.count("dedupe", scope, in_window, len(kept), drops)
    print(f"\n{name}")
    print(f"  collected {found} -> dated {len(collected)} -> in-window {in_window} -> new {len(kept)}")
