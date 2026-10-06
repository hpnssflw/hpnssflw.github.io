import copy
from datetime import datetime, timezone
from pathlib import Path

import pytest
import yaml

from agent import config
from agent.preset import PresetError, load_preset, require_offline
from agent.sources.base import FeedConfig

AGENT = Path(__file__).resolve().parents[1]

VALID = {
    "preset": {"slug": "demo", "name": "Демо", "language": "ru"},
    "defaults": {"max_age_days": 2, "min_relevance": 6, "max_items_per_day": 5},
    "sources": {
        "rss": [{"id": "agency", "name": "Агентство", "url": "https://example-agency.ru/rss", "full_text": True}],
        "telegram_public": {"enabled": False, "channels": [{"handle": "example_agency", "name": "Агентство"}]},
    },
    "topics": [
        {"slug": "incidents", "name": "Происшествия", "description": "ЧП.\n", "include": ["ЧП"], "exclude": []},
        {
            "slug": "prices",
            "name": "Цены",
            "description": "Цены.",
            "include": ["цены"],
            "exclude": ["розница"],
            "max_items_per_day": 2,
            "sources": {"rss": [{"id": "exchange", "name": "Биржа", "url": "https://example-exchange.ru/rss"}]},
        },
    ],
    "ranking": {"reader": "Редактор.\n"},
    "llm": {"base_url": "https://api.deepseek.com", "model": "deepseek-v4-flash", "api_key_env": "DEEPSEEK_API_KEY"},
    "approval": {"type": "file", "path": "fixtures/decisions.json", "expire_days": 3},
    "delivery": {"type": "file", "title": "Сводка", "cadence_hours": 4},
    "offline": {"now": "2026-10-06T09:00:00+00:00", "http": "fixtures/http.yaml", "llm": "fixtures/verdicts.json"},
}


def write_preset(tmp_path: Path, raw: dict) -> Path:
    fixtures = tmp_path / "fixtures"
    fixtures.mkdir(exist_ok=True)
    for name in ("decisions.json", "http.yaml", "verdicts.json"):
        (fixtures / name).write_text("{}", encoding="utf-8")
    path = tmp_path / "preset.yaml"
    path.write_text(yaml.safe_dump(raw, allow_unicode=True, sort_keys=False), encoding="utf-8")
    return path


def test_tony_legacy_preset_reads_defaults_and_topics():
    preset = load_preset(AGENT / "presets" / "tony.yaml")
    settings = config.load_settings(AGENT / "defaults.yaml")
    assert (preset.slug, preset.name, preset.language, preset.legacy) == ("tony", "Tony Scraponi", "en", True)
    assert list(preset.topics) == config.load_topics(AGENT / "topics", AGENT / "defaults.yaml")
    assert preset.feeds == () and preset.telegram is None and preset.offline is None
    assert preset.reader == settings.ranking.reader
    assert (preset.llm.base_url, preset.llm.model, preset.llm.api_key_env) == (
        settings.llm.base_url,
        settings.llm.model,
        "DEEPSEEK_API_KEY",
    )
    assert (preset.approval.type, preset.approval.decisions_url, preset.approval.expire_days, preset.approval.token_env) == (
        "inbox",
        settings.inbox.decisions_url,
        settings.inbox.expire_days,
        "GITHUB_TOKEN",
    )
    assert (preset.delivery.type, preset.delivery.chat, preset.delivery.cadence_hours, preset.delivery.title) == (
        "telegram",
        "@hypnosisflow",
        24,
        "Research digest",
    )
    assert preset.delivery.bot_token_env == "TELEGRAM_BOT_TOKEN"
    assert preset.default_data_dir == AGENT
    assert preset.max_age_days == 10


def test_self_contained_preset_loads_every_section(tmp_path):
    preset = load_preset(write_preset(tmp_path, VALID))
    assert (preset.slug, preset.language, preset.legacy, preset.max_age_days) == ("demo", "ru", False, 2)
    assert preset.feeds == (FeedConfig("agency", "Агентство", "https://example-agency.ru/rss", True),)
    assert [c.handle for c in preset.telegram.channels] == ["example_agency"]
    assert preset.telegram.enabled is False
    incidents, prices = preset.topics
    assert (incidents.description, incidents.min_relevance, incidents.max_items_per_day, incidents.max_age_days) == ("ЧП.", 6, 5, 2)
    assert (incidents.keywords, incidents.sources, incidents.feeds, incidents.attention_enabled) == ([], {}, (), False)
    assert prices.max_items_per_day == 2
    assert prices.feeds == (FeedConfig("exchange", "Биржа", "https://example-exchange.ru/rss", False),)
    assert preset.reader == "Редактор."
    assert preset.approval.path == (tmp_path / "fixtures" / "decisions.json").resolve()
    assert (preset.delivery.type, preset.delivery.title, preset.delivery.cadence_hours) == ("file", "Сводка", 4)
    assert preset.offline.now == datetime(2026, 10, 6, 9, 0, tzinfo=timezone.utc)
    assert preset.default_data_dir is None
    require_offline(preset)


def _broken(change):
    raw = copy.deepcopy(VALID)
    change(raw)
    return raw


@pytest.mark.parametrize(
    ("change", "message"),
    [
        (lambda r: r.update(extra=1), "extra: unknown key"),
        (lambda r: r["topics"][1].update(incldue=["x"]), r"topics\[1\].incldue: unknown key"),
        (lambda r: r.pop("ranking"), "ranking: required"),
        (lambda r: r["preset"].update(language="de"), "preset.language: one of en, ru"),
        (lambda r: r["preset"].update(slug="Demo"), "preset.slug: lowercase"),
        (lambda r: r["sources"]["telegram_public"].update(enabled=True), "Telegram sources aren't supported yet"),
        (lambda r: r["topics"][1].update(slug="incidents"), "duplicate topic 'incidents'"),
        (lambda r: r["topics"][1]["sources"]["rss"][0].update(id="agency"), "duplicate feed id 'agency'"),
        (lambda r: r["topics"][0].update(sources={"hacker_news": {"min_points": 30}}), r"topics\[0\].keywords: required with hacker_news"),
        (lambda r: r["topics"][0].update(min_relevance=11), r"topics\[0\].min_relevance: expected 1-10"),
        (lambda r: r["sources"]["rss"][0].update(url="ftp://example.ru/rss"), r"sources.rss\[0\].url: must start with http"),
        (lambda r: r["approval"].update(type="buttons"), "approval.type: one of inbox, file"),
        (lambda r: r["approval"].update(path="fixtures/missing.json"), "approval.path: no such file"),
        (lambda r: r["delivery"].update(cadence_hours="4"), "delivery.cadence_hours: expected an integer"),
        (lambda r: r["offline"].update(now="2026-10-06T09:00:00"), "offline.now: expected an ISO 8601 timestamp with a UTC offset"),
        (lambda r: r["topics"].clear(), "topics: expected a non-empty list"),
    ],
)
def test_invalid_presets_name_the_key(tmp_path, change, message):
    with pytest.raises(PresetError, match=message):
        load_preset(write_preset(tmp_path, _broken(change)))


def test_legacy_preset_allows_nothing_else(tmp_path):
    path = tmp_path / "tony.yaml"
    path.write_text(
        "preset: {slug: tony, name: Tony, language: en}\n"
        f"legacy: {{defaults: {(AGENT / 'defaults.yaml').as_posix()}, topics: {(AGENT / 'topics').as_posix()}}}\n"
        "delivery: {type: file, title: x, cadence_hours: 1}\n",
        encoding="utf-8",
    )
    with pytest.raises(PresetError, match="delivery: unknown key"):
        load_preset(path)


def test_missing_preset_file(tmp_path):
    with pytest.raises(PresetError, match="no such preset file"):
        load_preset(tmp_path / "nope.yaml")


@pytest.mark.parametrize(
    ("change", "message"),
    [
        (lambda r: r.pop("offline"), "needs an `offline` section"),
        (
            lambda r: r.update(
                approval={"type": "inbox", "decisions_url": "https://x", "expire_days": 7, "token_env": "GITHUB_TOKEN"}
            ),
            "approval.type: --offline needs `file`",
        ),
        (
            lambda r: r.update(
                delivery={"type": "telegram", "chat": "@x", "bot_token_env": "T", "title": "x", "cadence_hours": 1}
            ),
            "delivery.type: --offline needs `file`",
        ),
        (
            lambda r: r["topics"][0].update(keywords=["x"], sources={"hacker_news": {"min_points": 1}}),
            r"topics\[0\].sources.hacker_news: has no offline mode",
        ),
    ],
)
def test_require_offline_rejects_anything_that_needs_the_network(tmp_path, change, message):
    preset = load_preset(write_preset(tmp_path, _broken(change)))
    with pytest.raises(PresetError, match=message):
        require_offline(preset)


def test_tony_cannot_run_offline():
    with pytest.raises(PresetError, match="needs an `offline` section"):
        require_offline(load_preset(AGENT / "presets" / "tony.yaml"))
