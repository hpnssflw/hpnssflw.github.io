"""The feed path with stories, end to end offline (agent/tests/stories_mini.py)."""

import json
from datetime import datetime

from agent import engine, stories
from agent.paths import DataPaths
from agent.pending import load_pending
from agent.preset import load_preset
from agent.tests import stories_mini as mini

A, C, G = mini.A, mini.C, mini.G


def run1(tmp_path, fixture=None):
    preset = load_preset(mini.write(tmp_path / "mini", fixture))
    paths = DataPaths(tmp_path / "data")
    paths.root.mkdir(parents=True, exist_ok=True)
    adapters = engine.offline_adapters(preset, paths)
    engine.run_real(preset, paths, preset.offline.now, adapters)
    return preset, paths, adapters, json.loads(paths.result.read_text(encoding="utf-8"))


def stage(result, name):
    return next(s for s in result["stages"] if s["stage"] == name)["scopes"]


def test_run_one_groups_caps_and_queues_stories(tmp_path, no_network):
    preset, paths, adapters, result = run1(tmp_path)
    assert [s["stage"] for s in result["stages"]][4:9] == ["enrich", "rank", "group", "cap", "facts"]
    group = stage(result, "group")
    assert group["incidents"] == {"in": 5, "out": 3, "drops": {}}  # pipe (3 reports), fire, crash
    assert group["economy"] == {"in": 2, "out": 1, "drops": {}}  # the plant and its reprint
    assert group["*"]["notes"] == {"matched_text": 1, "matched_near": 1, "matched_llm": 1}
    assert stage(result, "cap")["incidents"] == {"in": 3, "out": 2, "drops": {"over_max_items": 1}}  # cap 2: the crash waits
    assert adapters.ranker.merge_calls == 1

    queue = load_pending(paths.pending)
    assert [(i.url, i.topic, i.score) for i in queue.items] == [(f"{A}/1", "incidents", 8), (f"{A}/3", "incidents", 7), (f"{A}/2", "economy", 9)]
    store = stories.load_store(paths.stories)
    assert {k: (s.status, len(s.reports)) for k, s in store.stories.items()} == {
        f"{A}/1": ("queued", 3),
        f"{A}/2": ("queued", 2),
        f"{A}/3": ("queued", 1),
        f"{A}/4": ("waiting", 1),
    }
    assert result["failures"] == []


def test_a_waiting_story_competes_again_without_a_new_merge(tmp_path, no_network):
    preset, paths, _, _ = run1(tmp_path)
    adapters = engine.offline_adapters(preset, paths)  # same feeds, same clock
    engine.run_real(preset, paths, preset.offline.now, adapters)
    assert adapters.ranker.merge_calls == 0  # every report is already in a story
    assert stories.load_store(paths.stories).stories[f"{A}/4"].status == "waiting"  # the cap is still full


def test_a_failed_merge_holds_the_lone_report_for_the_next_run(tmp_path, no_network):
    failing = {**mini.STORIES, "merge": None}
    preset, paths, _, result = run1(tmp_path, failing)
    assert [f["stage"] + ":" + f["error_type"] for f in result["failures"]] == ["group:MergeFailed"]
    assert stage(result, "group")["incidents"]["notes"] == {"held": 3}  # g1, fire and crash
    store = stories.load_store(paths.stories)
    assert [r.url for r in store.stories[f"{A}/1"].reports] == [f"{A}/1", f"{C}/c1"]  # the near-copy still joined
    assert f"{G}/g1" not in stories.member_index(store)

    mini.write(tmp_path / "mini")  # the merge works again
    preset = load_preset(tmp_path / "mini" / "preset.yaml")
    engine.run_real(preset, paths, preset.offline.now, engine.offline_adapters(preset, paths))
    assert [r.url for r in stories.load_store(paths.stories).stories[f"{A}/1"].reports] == [f"{A}/1", f"{C}/c1", f"{G}/g1"]


def test_presets_without_stories_keep_eleven_stages():
    from agent.run_result import STAGES, Tally

    assert len(STAGES) == 11
    assert [s["stage"] for s in Tally(["t"], has_feeds=True).stages()] == [s for s, _ in STAGES]
