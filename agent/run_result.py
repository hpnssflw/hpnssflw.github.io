"""<data-dir>/run-result.json -- the engine's stable per-run contract for
the control room's future preset switcher (sub-project D): the assembled
config, numbers per stage and scope, drop reasons, failures, the queue
and delivery. Deterministic for a fixed clock; carries no secrets and no
error text, so it can be published as is. Schema: see
docs/superpowers/specs/2026-10-06-content-engine-core-design.md."""

from __future__ import annotations

import json
from collections import Counter
from dataclasses import asdict
from datetime import datetime
from pathlib import Path

from agent import rank_cache, summarize
from agent.pending import PendingQueue
from agent.preset import Preset
from agent.sources.base import Drop, FeedConfig

SCHEMA_VERSION = 2  # 2: config.preset lost "legacy" (sub-project D)
FEED_SCOPE = "*"  # a preset feed's items before classification

# Logical order -- the control room's rail plus enrich and format -- not
# execution order (review runs first).
STAGES = (
    ("collect", "sources"),
    ("window", "filter"),
    ("dedupe", "filter"),
    ("cache", "processing"),
    ("enrich", "processing"),
    ("rank", "processing"),
    ("cap", "processing"),
    ("queue", "approval"),
    ("review", "approval"),
    ("format", "formatting"),
    ("deliver", "delivery"),
)
RUN_WIDE_STAGES = ("format", "deliver")  # one digest per run: scope "*" only


class Tally:
    """Counts per (stage, scope) where each stage runs: items in and out,
    drops by reason, notes. Failures carry the exception's class name only."""

    def __init__(self, topic_slugs: list[str], has_feeds: bool) -> None:
        topic_scopes = [*topic_slugs, *([FEED_SCOPE] if has_feeds else [])]
        self._stages: dict[str, dict[str, dict]] = {
            stage: {scope: _empty() for scope in ([FEED_SCOPE] if stage in RUN_WIDE_STAGES else topic_scopes)}
            for stage, _ in STAGES
        }
        self.failures: list[dict] = []

    def count(self, stage: str, scope: str, n_in: int, n_out: int, drops: list[Drop] = ()) -> None:
        entry = self._entry(stage, scope)
        entry["in"] += n_in
        entry["out"] += n_out
        for drop in drops:
            entry["drops"][drop.reason] = entry["drops"].get(drop.reason, 0) + 1

    def note(self, stage: str, scope: str, key: str, n: int = 1) -> None:
        notes = self._entry(stage, scope).setdefault("notes", {})
        notes[key] = notes.get(key, 0) + n

    def assign(self, topic: str, n: int = 1) -> None:
        """Preset-feed items classified into `topic`, at or above its threshold."""
        assigned = self._entry("rank", FEED_SCOPE).setdefault("assigned", {})
        assigned[topic] = assigned.get(topic, 0) + n

    def fail(self, stage: str, scope: str, source: str | None, exc: BaseException) -> None:
        self.failures.append({"stage": stage, "scope": scope, "source": source, "error_type": type(exc).__name__})

    def stages(self) -> list[dict]:
        return [{"stage": stage, "group": group, "scopes": self._stages[stage]} for stage, group in STAGES]

    def _entry(self, stage: str, scope: str) -> dict:
        return self._stages[stage].setdefault(scope, _empty())


def _empty() -> dict:
    return {"in": 0, "out": 0, "drops": {}}


def build_run_result(
    *,
    preset: Preset,
    mode: str,
    offline: bool,
    run_id: str,
    now: datetime,
    tally: Tally,
    queue: PendingQueue,
    decisions: dict[str, str] | None,
    delivery: dict,
) -> dict:
    decisions = decisions or {}
    by_topic = Counter(item.topic for item in queue.items)
    return {
        "schema_version": SCHEMA_VERSION,
        "preset": {"slug": preset.slug, "name": preset.name, "language": preset.language},
        "run": {"id": run_id, "mode": mode, "offline": offline, "at": now.isoformat()},
        "config": preset_config(preset),
        "stages": tally.stages(),
        "failures": tally.failures,
        "queue": {
            "count": len(queue.items),
            "by_topic": dict(by_topic),
            "items": [{**asdict(item), "decision": decisions.get(item.url)} for item in queue.items],
        },
        "delivery": delivery,
    }


def write_run_result(path: Path, result: dict) -> None:
    path.write_text(
        json.dumps(result, indent=2, sort_keys=True, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n"
    )


def preset_config(preset: Preset) -> dict:
    """The assembled preset: everything that decides what reaches the
    queue, with environment variables by name only."""
    config = _base_config(preset)
    if preset.feeds:
        config["ranking"]["classify_prompt_version"] = summarize.CLASSIFY_PROMPT_VERSION
        config["ranking"]["classify_rubric_hash"] = summarize.classify_rubric_hash(
            list(preset.topics), preset.reader, preset.language
        )
    return config


def _base_config(preset: Preset) -> dict:
    return {
        "preset": {"slug": preset.slug, "name": preset.name, "language": preset.language},
        "max_age_days": preset.max_age_days,
        "sources": {
            "rss": [_feed(feed) for feed in preset.feeds],
            "telegram_public": (
                None
                if preset.telegram is None
                else {
                    "enabled": False,
                    "status": "coming_soon",
                    "channels": [{"handle": c.handle, "name": c.name} for c in preset.telegram.channels],
                }
            ),
        },
        "topics": [
            {
                "slug": topic.slug,
                "name": topic.name,
                "description": topic.description,
                "keywords": list(topic.keywords),
                "include": list(topic.include),
                "exclude": list(topic.exclude),
                "sources": topic.sources,
                "rss": [_feed(feed) for feed in topic.feeds],
                "max_age_days": topic.max_age_days,
                "min_relevance": topic.min_relevance,
                "max_items_per_day": topic.max_items_per_day,
                "attention": {"enabled": topic.attention_enabled, "min_score_gain": topic.attention_min_score_gain},
                "rubric_hash": summarize.rubric_hash(topic, preset.reader),
            }
            for topic in preset.topics
        ],
        "ranking": {
            "reader": preset.reader,
            "base_url": preset.llm.base_url,
            "model": preset.llm.model,
            "api_key_env": preset.llm.api_key_env,
            "temperature": 0,  # the completion call's; test_run_result checks they match
            "batch_size": summarize.RANK_BATCH_SIZE,
            "rank_prompt_version": summarize.RANK_PROMPT_VERSION,
        },
        "cap_window_hours": int(rank_cache.QUEUE_WINDOW.total_seconds() // 3600),
        "approval": _approval(preset),
        "delivery": _delivery(preset),
        "offline": (
            None
            if preset.offline is None
            else {
                "now": preset.offline.now.isoformat(),
                "http": _relative(preset, preset.offline.http),
                "llm": _relative(preset, preset.offline.llm),
            }
        ),
    }


def _feed(feed: FeedConfig) -> dict:
    return {"id": feed.id, "name": feed.name, "url": feed.url, "full_text": feed.full_text}


def _approval(preset: Preset) -> dict:
    approval = preset.approval
    if approval.type == "inbox":
        return {
            "type": "inbox",
            "decisions_url": approval.decisions_url,
            "token_env": approval.token_env,
            "expire_days": approval.expire_days,
        }
    return {"type": "file", "path": _relative(preset, approval.path), "expire_days": approval.expire_days}


def _delivery(preset: Preset) -> dict:
    delivery = preset.delivery
    out = {"type": delivery.type, "title": delivery.title, "cadence_hours": delivery.cadence_hours}
    if delivery.type == "telegram":
        out.update(chat=delivery.chat, bot_token_env=delivery.bot_token_env)
    return out


def _relative(preset: Preset, path: Path) -> str:
    """Relative to the preset file, so the result doesn't depend on where
    the repo is checked out."""
    try:
        return path.relative_to(preset.path.parent).as_posix()
    except ValueError:
        return path.as_posix()
