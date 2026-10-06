import json

import pytest

from agent import main, panel, report
from agent.paths import DataPaths
from agent.tests.conftest import TONY, url_hash


@pytest.fixture
def calls(monkeypatch):
    seen = []
    for name in ("run_real", "run_preview", "run_dry"):
        monkeypatch.setattr(main, name, lambda topic, paths, name=name: seen.append((name, topic, paths)))
    monkeypatch.setattr(main.config, "load_env", lambda path: None)
    return seen


def test_data_dir_defaults_to_the_agent_directory(calls):
    main.main([])
    assert calls == [("run_real", None, DataPaths(main.AGENT_DIR))]


def test_data_dir_is_created_and_passed_to_every_mode(calls, tmp_path):
    data = tmp_path / "nested" / "data"
    main.main(["--preview", "--topic", "tooling", "--data-dir", str(data)])
    main.main(["--dry-run", "--data-dir", str(data)])
    assert data.is_dir()
    assert calls == [("run_preview", "tooling", DataPaths(data)), ("run_dry", None, DataPaths(data))]


def test_report_reads_state_from_the_data_dir(tmp_path, capsys):
    state = {
        url_hash(url): entry
        for url, entry in json.loads((TONY / "seed_state.json").read_text(encoding="utf-8")).items()
    }
    (tmp_path / "state.json").write_text(json.dumps(state), encoding="utf-8")
    report.run_report(["--data-dir", str(tmp_path), "--days", "36500"])  # run_report reads the wall clock
    out = capsys.readouterr().out
    assert "Tooling (tooling)\n  queued 3: sent 0, rejected 0, expired 0, pending 3" in out


def test_report_without_state_names_the_missing_file(tmp_path):
    with pytest.raises(SystemExit, match="state.json not found"):
        report.run_report(["--data-dir", str(tmp_path)])


def test_panel_serves_runs_from_the_data_dir(tmp_path):
    assert panel.handler_for(DataPaths(tmp_path).runs).runs_dir == tmp_path / "runs"
