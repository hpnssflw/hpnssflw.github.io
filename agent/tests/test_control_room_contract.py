"""The control room (docs/superpowers/specs/2026-10-06-tony-control-room-design.md)
reads these lines at site build time. Each must exist exactly once, with
these values; a failure here would also fail the site build."""

import re
from pathlib import Path

AGENT = Path(__file__).resolve().parents[1]
REPO = AGENT.parent


def _single(pattern: str, path: Path) -> str:
    matches = re.findall(pattern, path.read_text(encoding="utf-8"), flags=re.MULTILINE)
    assert len(matches) == 1, f"{path.name}: expected one match for {pattern!r}, got {matches}"
    return matches[0]


def test_ranking_constants_in_summarize():
    source = AGENT / "summarize.py"
    assert _single(r"^RANK_BATCH_SIZE = (\d+)$", source) == "40"
    assert _single(r"^RANK_PROMPT_VERSION = (\d+)$", source) == "2"
    assert _single(r"temperature=(\d+)", source) == "0"


def test_queue_window_in_rank_cache():
    assert _single(r"^QUEUE_WINDOW = timedelta\(hours=(\d+)\)$", AGENT / "rank_cache.py") == "23"


def test_cron_line_in_the_workflow():
    workflow = REPO / ".github" / "workflows" / "agent-run.yml"
    assert _single(r'^\s*- cron: "([^"]+)"$', workflow) == "0 */4 * * *"
