"""Golden files. A missing golden is recorded and the test fails, asking
for a look and a rerun; an existing one is compared byte for byte. To
re-record, delete the file -- which shows in `git status`, so it's never
silent."""

from __future__ import annotations

from pathlib import Path

import pytest


def assert_goldens(expected_files: dict[Path, str]) -> None:
    recorded = []
    for path, actual in expected_files.items():
        if not path.exists():
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(actual, encoding="utf-8", newline="\n")
            recorded.append(str(path))
    if recorded:
        pytest.fail("recorded new goldens; inspect them, then rerun:\n" + "\n".join(recorded))
    for path, actual in expected_files.items():
        assert actual == path.read_text(encoding="utf-8"), f"output differs from golden {path}"
