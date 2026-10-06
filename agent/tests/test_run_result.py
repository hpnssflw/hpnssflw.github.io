import json
import re
from pathlib import Path

from agent import run_result
from agent.pending import PendingItem, PendingQueue
from agent.preset import load_preset
from agent.run_result import FEED_SCOPE, STAGES, Tally, build_run_result, preset_config, write_run_result
from agent.sources.base import Drop
from agent.tests.conftest import FROZEN_NOW, TONY
from agent.tests.test_preset import VALID, write_preset
from agent.tests.test_summarize import PINNED_RUBRICS

AGENT = Path(__file__).resolve().parents[1]


def _drop(reason):
    return Drop(url="u", title="t", reason=reason, detail={})


def test_tally_accumulates_counts_and_drop_reasons():
    tally = Tally(["a", "b"], has_feeds=True)
    tally.count("collect", "a", 5, 4, [_drop("undated")])
    tally.count("collect", "a", 3, 2, [_drop("undated")])
    tally.count("rank", FEED_SCOPE, 6, 3, [_drop("off_topic"), _drop("below_relevance")])
    tally.assign("b")
    tally.note("enrich", FEED_SCOPE, "full_text", 2)
    stages = {s["stage"]: s for s in tally.stages()}
    assert [s["stage"] for s in tally.stages()] == [stage for stage, _ in STAGES]
    assert stages["collect"]["group"] == "sources"
    assert stages["collect"]["scopes"]["a"] == {"in": 8, "out": 6, "drops": {"undated": 2}}
    assert stages["collect"]["scopes"]["b"] == {"in": 0, "out": 0, "drops": {}}
    assert stages["rank"]["scopes"][FEED_SCOPE] == {
        "in": 6,
        "out": 3,
        "drops": {"off_topic": 1, "below_relevance": 1},
        "assigned": {"b": 1},
    }
    assert stages["enrich"]["scopes"][FEED_SCOPE]["notes"] == {"full_text": 2}
    assert set(stages["format"]["scopes"]) == {FEED_SCOPE}


def test_tally_without_feeds_has_no_feed_scope_except_run_wide_stages():
    stages = {s["stage"]: s for s in Tally(["a"], has_feeds=False).stages()}
    assert set(stages["collect"]["scopes"]) == {"a"}
    assert set(stages["deliver"]["scopes"]) == {FEED_SCOPE}


def test_failures_carry_the_exception_class_only():
    tally = Tally(["a"], has_feeds=False)
    tally.fail("collect", "a", "hacker_news", RuntimeError("https://secret.example/?token=abc"))
    assert tally.failures == [{"stage": "collect", "scope": "a", "source": "hacker_news", "error_type": "RuntimeError"}]


def test_tony_config_matches_the_code_and_names_secrets_only(monkeypatch):
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "do-not-leak-telegram")
    monkeypatch.setenv("DEEPSEEK_API_KEY", "do-not-leak-deepseek")
    config = preset_config(load_preset(AGENT / "presets" / "tony.yaml"))
    temperature = re.search(r"temperature=(\d+)", (AGENT / "summarize.py").read_text(encoding="utf-8")).group(1)
    assert config["ranking"]["temperature"] == int(temperature)
    assert (config["ranking"]["batch_size"], config["ranking"]["rank_prompt_version"]) == (40, 2)
    assert config["cap_window_hours"] == 23
    assert {t["slug"]: t["rubric_hash"] for t in config["topics"]} == PINNED_RUBRICS
    assert config["sources"] == {"rss": [], "telegram_public": None}
    assert config["delivery"] == {
        "type": "telegram",
        "title": "Research digest",
        "cadence_hours": 24,
        "chat": "@hypnosisflow",
        "bot_token_env": "TELEGRAM_BOT_TOKEN",
    }
    dumped = json.dumps(config)
    assert "do-not-leak" not in dumped


def test_self_contained_config_shows_telegram_as_coming_soon_and_relative_paths(tmp_path):
    config = preset_config(load_preset(write_preset(tmp_path, VALID)))
    assert config["sources"]["telegram_public"] == {
        "enabled": False,
        "status": "coming_soon",
        "channels": [{"handle": "example_agency", "name": "Агентство"}],
    }
    assert config["approval"] == {"type": "file", "path": "fixtures/decisions.json", "expire_days": 3}
    assert config["offline"] == {
        "now": "2026-10-06T09:00:00+00:00",
        "http": "fixtures/http.yaml",
        "llm": "fixtures/verdicts.json",
    }
    assert config["topics"][1]["rss"] == [
        {"id": "exchange", "name": "Биржа", "url": "https://example-exchange.ru/rss", "full_text": False}
    ]


def test_build_and_write_are_deterministic(tmp_path):
    preset = load_preset(write_preset(tmp_path, VALID))
    item = PendingItem("https://a", "A", "rss", "incidents", "Происшествия", "s", 7, FROZEN_NOW.isoformat())
    queue = PendingQueue(last_email_at=None, items=[item])
    kwargs = dict(
        preset=preset,
        mode="real",
        offline=True,
        run_id="2026-10-06T1200Z",
        now=FROZEN_NOW,
        tally=Tally(["incidents", "prices"], has_feeds=True),
        queue=queue,
        decisions={"https://a": "approve"},
        delivery={"target": "file", "due": False, "sent_items": 0, "messages": 0, "last_sent_at": None},
    )
    result = build_run_result(**kwargs)
    assert result["schema_version"] == run_result.SCHEMA_VERSION == 2
    assert result["run"] == {"id": "2026-10-06T1200Z", "mode": "real", "offline": True, "at": FROZEN_NOW.isoformat()}
    assert result["queue"]["count"] == 1 and result["queue"]["by_topic"] == {"incidents": 1}
    assert result["queue"]["items"][0]["decision"] == "approve"
    first, second = tmp_path / "a.json", tmp_path / "b.json"
    write_run_result(first, result)
    write_run_result(second, build_run_result(**kwargs))
    assert first.read_bytes() == second.read_bytes()
    assert first.read_text(encoding="utf-8").endswith("}\n")


def test_a_failed_run_result_write_does_not_fail_tonys_run(tony, capsys, monkeypatch):
    """The run-result write comes after delivery: if it raised, CI would
    skip pushing state and deliver the same items again next run."""
    from agent import engine

    def fail(path, result):
        raise OSError("disk full")

    monkeypatch.setattr(engine, "write_run_result", fail)
    tony.run_real()
    assert "Run result not written: disk full" in capsys.readouterr().out
    golden = TONY / "golden" / "real"
    for name in ("state.json", "pending.json", "status.json"):
        assert tony.read(name) == (golden / name).read_text(encoding="utf-8"), name
    assert not (tony.data / "run-result.json").exists()
