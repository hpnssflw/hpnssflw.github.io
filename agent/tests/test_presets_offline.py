"""The two demo presets (sub-project A's test cases) end to end, offline:
the first run fills the queue, the second applies the fixture decisions
and delivers. Goldens: both run results and the outbox."""

import json

import pytest

from agent import engine, main
from agent.paths import DataPaths
from agent.preset import load_preset
from agent.tests.conftest import FIXTURES
from agent.tests.golden import assert_goldens


def _run_twice(name, tmp_path):
    preset_path = FIXTURES / name / "preset.yaml"
    data = tmp_path / "data"
    main.main(["--preset", str(preset_path), "--data-dir", str(data), "--offline"])
    first = (data / "run-result.json").read_text(encoding="utf-8")
    preset = load_preset(preset_path)
    paths = DataPaths(data)
    second_adapters = engine.offline_adapters(preset, paths)
    engine.run_real(preset, paths, preset.offline.now, second_adapters)
    second = paths.result.read_text(encoding="utf-8")
    run2 = json.loads(second)
    outbox = (paths.outbox / f"{run2['run']['id']}.html").read_text(encoding="utf-8")
    return json.loads(first), run2, second_adapters, first, second, outbox


@pytest.mark.parametrize("name", ["newsroom-demo", "agro-demo"])
def test_demo_preset_matches_its_goldens(name, tmp_path, no_network):
    _, _, _, first, second, outbox = _run_twice(name, tmp_path)
    golden = FIXTURES / name / "golden"
    assert_goldens({golden / "run1.json": first, golden / "run2.json": second, golden / "outbox.html": outbox})


@pytest.mark.parametrize("name", ["newsroom-demo", "agro-demo"])
def test_second_run_ranks_nothing_and_queues_nothing_new(name, tmp_path, no_network):
    run1, run2, second_adapters, *_ = _run_twice(name, tmp_path)
    assert run1["failures"] == [] and run2["failures"] == []
    assert second_adapters.ranker.calls == 0
    first_urls = {item["url"] for item in run1["queue"]["items"]}
    assert {item["url"] for item in run2["queue"]["items"]} <= first_urls
    assert run2["delivery"]["due"] is True and run2["delivery"]["sent_items"] == 3


def test_newsroom_demo(tmp_path, no_network):
    run1, run2, *_ = _run_twice("newsroom-demo", tmp_path)
    stages = {s["stage"]: s["scopes"] for s in run1["stages"]}
    assert run1["config"]["sources"]["telegram_public"]["status"] == "coming_soon"
    assert stages["collect"]["*"] == {"in": 21, "out": 19, "drops": {"undated": 2}}
    assert stages["window"]["*"]["drops"] == {"outside_window": 2}
    assert stages["dedupe"]["*"]["drops"] == {"seen": 1}
    assert stages["enrich"]["*"]["notes"] == {"full_text": 3, "full_text_failed": 4}
    assert stages["rank"]["*"]["drops"] == {"below_relevance": 3, "off_topic": 2}
    assert run1["queue"]["by_topic"] == {"incidents": 3, "power": 3, "economy": 2}
    assert {s["stage"]: s["scopes"] for s in run2["stages"]}["review"]["incidents"]["drops"] == {"rejected": 1}


def test_agro_demo_uses_both_scopes(tmp_path, no_network):
    run1, *_ = _run_twice("agro-demo", tmp_path)
    stages = {s["stage"]: s["scopes"] for s in run1["stages"]}
    assert stages["collect"]["prices"] == {"in": 3, "out": 3, "drops": {}}  # the topic's own exchange feed
    assert stages["cap"]["prices"] == {"in": 3, "out": 3, "drops": {}}  # 2 from its feed + 1 classified
    assert stages["cap"]["regulation"] == {"in": 3, "out": 2, "drops": {"over_max_items": 1}}
    assert run1["queue"]["by_topic"] == {"prices": 3, "regulation": 2, "market-players": 1, "season": 1}
