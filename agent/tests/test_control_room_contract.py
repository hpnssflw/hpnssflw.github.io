"""The control room (/researcher/queue/) reads one thing from this repo at
site build time: the workflow's cron line (lib/agent-schedule.ts). It
must exist exactly once; a failure here would also fail the site build.
Everything else it shows comes from run-result.json (test_run_result.py)."""

import re
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]


def test_cron_line_in_the_workflow():
    workflow = REPO / ".github" / "workflows" / "agent-run.yml"
    matches = re.findall(r'^\s*- cron: "([^"]+)"$', workflow.read_text(encoding="utf-8"), flags=re.MULTILINE)
    assert matches == ["0 */4 * * *"]
