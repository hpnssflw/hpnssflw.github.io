"""Queue outcomes and score distribution per topic, from state.json --
python -m agent report [--preset PATH] [--data-dir DIR] [--days N]. For
tuning min_relevance and the daily caps against what Artem actually
approves. Reads <data-dir>/state.json (Tony's default: agent/state.json):
copy it from the agent-data branch first. Only items
queued since sub-project #6 carry a topic (ranks[slug].queued_at), so
older ones don't appear."""

from __future__ import annotations

import argparse
from collections import Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path

from agent import dedupe, paths
from agent.dedupe import StateEntry
from agent.preset import load_preset

AGENT_DIR = Path(__file__).parent


def build_report(state: dict[str, StateEntry], topic_names: dict[str, str], now: datetime, days: int) -> str:
    since = now - timedelta(days=days)
    lines = [f"Last {days} days (since {since.date().isoformat()})"]
    for slug, name in topic_names.items():
        outcomes: Counter[str] = Counter()
        histogram: Counter[int] = Counter()
        scored_per_day: Counter[str] = Counter()
        for entry in state.values():
            verdict = entry.ranks.get(slug)
            if verdict is None:
                continue
            ranked_at = datetime.fromisoformat(verdict.ranked_at)
            if ranked_at >= since:
                histogram[verdict.relevance] += 1
                # ranked_at is set only when DeepSeek actually scores an item
                scored_per_day[ranked_at.astimezone(timezone.utc).date().isoformat()] += 1
            if verdict.queued_at is not None and datetime.fromisoformat(verdict.queued_at) >= since:
                outcomes["queued"] += 1
                if entry.times_sent > 0:
                    outcomes["sent"] += 1
                elif entry.dismissed is not None:
                    outcomes[entry.dismissed] += 1  # "rejected" | "expired"
                else:
                    outcomes["pending"] += 1
        lines.append("")
        lines.append(f"{name} ({slug})")
        lines.append(
            f"  queued {outcomes['queued']}: sent {outcomes['sent']}, rejected {outcomes['rejected']}, "
            f"expired {outcomes['expired']}, pending {outcomes['pending']}"
        )
        lines.append("  relevance " + " ".join(f"{score}:{histogram[score]}" for score in range(1, 11)))
        per_day = " ".join(f"{day}:{scored_per_day[day]}" for day in sorted(scored_per_day))
        lines.append(f"  scored per day (sent to DeepSeek) {per_day or '-'}")
    return "\n".join(lines)


def run_report(argv: list[str]) -> None:
    parser = argparse.ArgumentParser(prog="python -m agent report")
    parser.add_argument("--days", type=int, default=14)
    parser.add_argument("--preset", type=Path, default=AGENT_DIR / "presets" / "tony.yaml")
    parser.add_argument("--data-dir", type=Path, default=None)
    args = parser.parse_args(argv)
    preset = load_preset(args.preset)
    state_path = paths.for_preset(preset, args.data_dir).state
    if not state_path.exists():
        raise SystemExit(f"{state_path} not found -- copy it from the agent-data branch first")
    state = dedupe.load_state(state_path)
    print(build_report(state, {t.slug: t.name for t in preset.topics}, datetime.now(timezone.utc), args.days))
