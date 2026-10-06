import json

import pytest
import yaml

from agent import engine, main, panel, report
from agent.paths import DataPaths
from agent.tests.conftest import TONY, url_hash
from agent.tests.test_preset import VALID, write_preset


@pytest.fixture
def calls(monkeypatch):
    seen = []
    for name in ("run_real", "run_preview", "run_dry"):
        monkeypatch.setattr(
            engine,
            name,
            lambda preset, paths, now, adapters, topic, name=name: seen.append((name, preset.slug, paths, topic)),
        )
    monkeypatch.setattr(main.config, "load_env", lambda path: None)
    return seen


def test_tony_is_the_default_preset_and_agent_the_default_data_dir(calls):
    main.main([])
    assert calls == [("run_real", "tony", DataPaths(main.AGENT_DIR), None)]


def test_data_dir_is_created_and_passed_to_every_mode(calls, tmp_path):
    data = tmp_path / "nested" / "data"
    main.main(["--preview", "--topic", "tooling", "--data-dir", str(data)])
    main.main(["--dry-run", "--data-dir", str(data)])
    assert data.is_dir()
    assert calls == [("run_preview", "tony", DataPaths(data), "tooling"), ("run_dry", "tony", DataPaths(data), None)]


def test_a_self_contained_preset_needs_a_data_dir(calls, tmp_path, capsys):
    preset_path = write_preset(tmp_path, VALID)
    with pytest.raises(SystemExit) as exit_info:
        main.main(["--preset", str(preset_path)])
    assert exit_info.value.code == 2
    assert "--data-dir is required for preset 'demo'" in capsys.readouterr().err
    main.main(["--preset", str(preset_path), "--data-dir", str(tmp_path / "demo-data")])
    assert calls == [("run_real", "demo", DataPaths(tmp_path / "demo-data"), None)]


def test_an_invalid_preset_exits_2_before_running(calls, tmp_path, capsys):
    broken = dict(VALID, extra=1)
    path = tmp_path / "broken.yaml"
    path.write_text(yaml.safe_dump(broken, allow_unicode=True), encoding="utf-8")
    with pytest.raises(SystemExit) as exit_info:
        main.main(["--preset", str(path), "--data-dir", str(tmp_path)])
    assert exit_info.value.code == 2
    assert "Preset error: extra: unknown key" in capsys.readouterr().err
    assert calls == []


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
