"""The feed path with stories, end to end offline (agent/tests/stories_mini.py)."""

import json
from datetime import datetime, timedelta

from agent import engine, stories
from agent.dedupe import load_state, url_hash
from agent.fetch import OfflineFetcher
from agent.paths import DataPaths
from agent.pending import load_pending
from agent.preset import load_preset
from agent.stories import Fact
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


def run2(preset, paths, tmp_path):
    adapters = engine.offline_adapters(preset, paths)
    adapters.fetcher = OfflineFetcher(tmp_path / "mini" / "http-later.yaml")
    engine.run_real(preset, paths, datetime.fromisoformat(mini.LATER), adapters)
    return adapters, json.loads(paths.result.read_text(encoding="utf-8"))


def test_run_one_writes_facts_for_multi_report_stories(tmp_path, no_network):
    _, paths, adapters, result = run1(tmp_path)
    store = stories.load_store(paths.stories)
    assert store.stories[f"{A}/1"].facts == [
        Fact(text="Без холодной воды остались три квартала.", urls=[f"{A}/1", f"{C}/c1"]),
        Fact(text="Организован подвоз питьевой воды.", urls=[f"{G}/g1"]),
    ]  # the fact citing [4] was dropped
    assert store.stories[f"{A}/2"].facts == [Fact(text="Завод сократит 300 рабочих мест.", urls=[f"{A}/2", f"{C}/c2"])]
    assert store.stories[f"{A}/3"].facts == [] and store.stories[f"{A}/3"].facts_for is None  # one report: no facts
    assert stage(result, "facts")["incidents"] == {"in": 1, "out": 1, "drops": {}, "notes": {"facts": 2}}
    assert adapters.ranker.facts_calls == 1


def test_run_two_joins_drops_reviews_and_delivers(tmp_path, no_network):
    preset, paths, _, _ = run1(tmp_path)
    adapters, result = run2(preset, paths, tmp_path)

    store = stories.load_store(paths.stories)
    pipe = store.stories[f"{A}/1"]
    assert [r.url for r in stories.ordered(pipe, stories.feed_order(preset))][0] == f"{G}/g2"  # published first, collected late
    assert pipe.status == "queued" and pipe.facts == [Fact(text="Давление упало ночью.", urls=[f"{G}/g2"])]
    assert (store.stories[f"{A}/2"].status, store.stories[f"{A}/3"].status, store.stories[f"{A}/4"].status) == ("sent", "rejected", "waiting")

    group = stage(result, "group")
    assert group["incidents"]["notes"] == {"joined": 2}
    assert group["economy"]["drops"] == {"same_story": 1}  # c3 reprints the approved plant story
    assert adapters.ranker.merge_calls == 1 and adapters.ranker.facts_calls == 1

    state = load_state(paths.state)
    assert state[url_hash(f"{C}/c2")].times_sent == 1  # delivery marks every report of the story
    assert state[url_hash(f"{A}/3")].dismissed == "rejected"
    assert state[url_hash(f"{C}/c3")].dismissed == "same_story"  # never grouped again
    assert [i.url for i in load_pending(paths.pending).items] == [f"{A}/1"]


def test_facts_failure_keeps_the_story_unflagged(tmp_path, no_network):
    failing = json.loads(json.dumps(mini.STORIES))
    failing["facts"][0]["response"] = None
    _, paths, _, result = run1(tmp_path, failing)
    pipe = stories.load_store(paths.stories).stories[f"{A}/1"]
    assert (pipe.facts, pipe.facts_for, pipe.flagged) == ([], None, False)
    assert [f["stage"] + ":" + f["error_type"] for f in result["failures"]] == ["facts:FactsInvalid"]


def test_all_facts_invalid_flags_the_story(tmp_path, no_network):
    invalid = json.loads(json.dumps(mini.STORIES))
    invalid["facts"][0]["response"] = {"facts": [{"text": "Без ссылки.", "refs": []}]}
    _, paths, _, result = run1(tmp_path, invalid)
    pipe = stories.load_store(paths.stories).stories[f"{A}/1"]
    assert (pipe.facts, pipe.flagged) == ([], True) and pipe.facts_for is not None
    assert stage(result, "facts")["incidents"]["notes"] == {"facts": 0, "flagged": 1}


def test_a_rejected_story_dismisses_every_report(tmp_path, no_network):
    preset, paths, _, _ = run1(tmp_path)
    decisions = {**mini.DECISIONS["decisions"], f"{A}/1": {"decision": "reject", "at": "2026-10-06T07:00:00Z"}}
    (tmp_path / "mini" / "decisions.json").write_text(json.dumps({"version": 1, "decisions": decisions}), encoding="utf-8")
    run2(preset, paths, tmp_path)

    assert stories.load_store(paths.stories).stories[f"{A}/1"].status == "rejected"
    state = load_state(paths.state)
    assert {url: state[url_hash(url)].dismissed for url in mini.PIPE_RUN1} == dict.fromkeys(mini.PIPE_RUN1, "rejected")
    assert state[url_hash(f"{A}/5")].dismissed == state[url_hash(f"{G}/g2")].dismissed == "same_story"  # none comes back
    assert f"{A}/1" not in [i.url for i in load_pending(paths.pending).items]


def test_an_expired_story_dismisses_every_report(tmp_path, no_network, monkeypatch):
    preset, paths, _, _ = run1(tmp_path)
    monkeypatch.setattr(stories, "prune", lambda *args: None)  # a closed story past the window is pruned on save
    later = datetime.fromisoformat(mini.NOW) + timedelta(days=preset.approval.expire_days + 1)
    engine.run_real(preset, paths, later, engine.offline_adapters(preset, paths))

    assert stories.load_store(paths.stories).stories[f"{A}/1"].status == "expired"
    state = load_state(paths.state)
    assert {url: state[url_hash(url)].dismissed for url in mini.PIPE_RUN1} == dict.fromkeys(mini.PIPE_RUN1, "expired")


def test_a_facts_failure_keeps_the_previous_facts(tmp_path, no_network):
    preset, paths, _, _ = run1(tmp_path)
    before = stories.load_store(paths.stories).stories[f"{A}/1"]
    assert len(before.facts) == 2 and before.facts_for is not None
    failing = json.loads(json.dumps(mini.STORIES))
    next(f for f in failing["facts"] if f["reports"] == mini.PIPE_RUN2)["response"] = None
    mini.write(tmp_path / "mini", failing)
    adapters, result = run2(preset, paths, tmp_path)

    pipe = stories.load_store(paths.stories).stories[f"{A}/1"]
    assert len(pipe.reports) == 5 and adapters.ranker.facts_calls == 1
    assert (pipe.facts, pipe.facts_for, pipe.flagged) == (before.facts, before.facts_for, False)
    assert [f["stage"] + ":" + f["error_type"] for f in result["failures"]] == ["facts:FactsInvalid"]
    assert stage(result, "facts")["incidents"] == {"in": 1, "out": 0, "drops": {}}


def test_preview_prints_stories_and_writes_nothing(tmp_path, no_network, capsys):
    preset = load_preset(mini.write(tmp_path / "mini"))
    paths = DataPaths(tmp_path / "data")
    paths.root.mkdir(parents=True)
    adapters = engine.offline_adapters(preset, paths)
    engine.run_preview(preset, paths, preset.offline.now, adapters)
    out = capsys.readouterr().out
    assert "== stories" in out and "3 src" in out and "Прорыв трубы на Садовой" in out
    assert adapters.ranker.facts_calls == 0 and not paths.stories.exists()
