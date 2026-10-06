"""Characterization of Tony: a real run, a preview and a dry run on fixed
inputs (tests/fixtures/tony), compared byte for byte with goldens
recorded on ec82c98, before the engine refactor. These goldens are never
re-recorded in sub-project A: one that would change is a regression."""

from __future__ import annotations

import json
from pathlib import Path

from agent.tests.conftest import TONY
from agent.tests.golden import assert_goldens

GOLDEN = TONY / "golden"


def _snapshot(directory: Path) -> dict[str, bytes]:
    return {str(p.relative_to(directory)): p.read_bytes() for p in sorted(directory.rglob("*")) if p.is_file()}


def test_real_run(tony, capsys):
    tony.run_real()
    stdout = tony.normalize(capsys.readouterr().out)
    assert_goldens(
        {
            GOLDEN / "real" / "stdout.txt": stdout,
            GOLDEN / "real" / "state.json": tony.read("state.json"),
            GOLDEN / "real" / "pending.json": tony.read("pending.json"),
            GOLDEN / "real" / "status.json": tony.read("status.json"),
            GOLDEN / "real" / "events.jsonl": tony.read("runs/2026-10-06T1200Z.jsonl"),
            GOLDEN / "real" / "telegram.json": json.dumps(tony.http.posts, indent=2, ensure_ascii=False) + "\n",
            GOLDEN / "real" / "prompts.txt": tony.llm.transcript(),
        }
    )


def test_real_run_result(tony, capsys):
    """run-result.json is new in sub-project A: recorded by Task 6, then
    held like the others."""
    tony.run_real()
    assert_goldens({GOLDEN / "real" / "run-result.json": tony.read("run-result.json")})


def test_preview_writes_nothing(tony, capsys):
    before = _snapshot(tony.data)
    tony.run_preview()
    stdout = tony.normalize(capsys.readouterr().out)
    assert _snapshot(tony.data) == before
    assert tony.http.posts == []
    assert_goldens(
        {
            GOLDEN / "preview" / "stdout.txt": stdout,
            GOLDEN / "preview" / "prompts.txt": tony.llm.transcript(),
        }
    )


def test_dry_run(tony, capsys):
    tony.run_dry()
    stdout = tony.normalize(capsys.readouterr().out)
    assert tony.llm.calls == []
    assert_goldens(
        {
            GOLDEN / "dry" / "stdout.txt": stdout,
            GOLDEN / "dry" / "state.json": tony.read("state.json"),
            GOLDEN / "dry" / "events.jsonl": tony.read("runs/2026-10-06T1200Z.jsonl"),
        }
    )


def test_dry_run_result(tony, capsys):
    tony.run_dry()
    assert_goldens({GOLDEN / "dry" / "run-result.json": tony.read("run-result.json")})
