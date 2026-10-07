import copy
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
import yaml

from agent.preset import PresetError, StoriesConfig, load_preset, require_offline
from agent.sources.base import FeedConfig
from agent.tests.conftest import STORIES_PRESET, write_stories_preset

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


def test_self_contained_preset_loads_every_section(tmp_path):
    preset = load_preset(write_preset(tmp_path, VALID))
    assert (preset.slug, preset.language, preset.status_json, preset.max_age_days) == ("demo", "ru", False, 2)
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
        (lambda r: r.update(data={"extra": 1}), "data.extra: unknown key"),
        (lambda r: r.update(data={"status_json": "yes"}), "data.status_json: expected true or false"),
        (lambda r: r.update(data={"default_dir": ""}), "data.default_dir: expected a non-empty string"),
        (lambda r: r.update(legacy={"defaults": "x", "topics": "y"}), "legacy: unknown key"),
    ],
)
def test_invalid_presets_name_the_key(tmp_path, change, message):
    with pytest.raises(PresetError, match=message):
        load_preset(write_preset(tmp_path, _broken(change)))


def test_data_section_sets_the_default_dir_and_status_json(tmp_path):
    preset = load_preset(write_preset(tmp_path, dict(VALID, data={"default_dir": "../data", "status_json": True})))
    assert preset.default_data_dir == (tmp_path.parent / "data").resolve()
    assert preset.status_json is True


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


def test_stories_defaults(tmp_path):
    preset = load_preset(write_stories_preset(tmp_path))
    assert preset.stories == StoriesConfig(window_hours=24, timezone="+00:00", near_text=0.6, llm_merge=True, max_facts=3)


def test_stories_values_and_offset(tmp_path):
    preset = load_preset(
        write_stories_preset(
            tmp_path, 'stories: {window_hours: 48, timezone: "+03:00", near_text: 0.5, llm_merge: false, max_facts: 2}\n'
        )
    )
    assert (preset.stories.window_hours, preset.stories.near_text, preset.stories.llm_merge) == (48, 0.5, False)
    assert preset.stories.tzinfo == timezone(timedelta(hours=3))
    assert StoriesConfig(timezone="-05:30").tzinfo == timezone(-timedelta(hours=5, minutes=30))


def test_no_stories_section_means_none(tmp_path):
    assert load_preset(write_stories_preset(tmp_path, stories="")).stories is None


@pytest.mark.parametrize(
    "stories, message",
    [
        ("stories: {windw_hours: 1}\n", "stories.windw_hours: unknown key"),
        ("stories: {window_hours: 0}\n", "stories.window_hours: expected an integer >= 1"),
        ("stories: {window_hours: 721}\n", "stories.window_hours: expected 1-720"),
        ('stories: {timezone: "Europe/Moscow"}\n', "stories.timezone: a UTC offset"),
        ('stories: {timezone: "+3:00"}\n', "stories.timezone: a UTC offset"),
        ("stories: {near_text: 0}\n", "stories.near_text: expected a number in (0, 1]"),
        ("stories: {near_text: 1.5}\n", "stories.near_text: expected a number in (0, 1]"),
        ("stories: {near_text: true}\n", "stories.near_text: expected a number in (0, 1]"),
        ("stories: {llm_merge: 1}\n", "stories.llm_merge: expected true or false"),
        ("stories: {max_facts: 7}\n", "stories.max_facts: expected 1-6"),
        ("stories: []\n", "stories: expected a mapping"),
    ],
)
def test_stories_validation(tmp_path, stories, message):
    with pytest.raises(PresetError, match=re.escape(message)):
        load_preset(write_stories_preset(tmp_path, stories))


def test_stories_reject_topic_sources(tmp_path):
    text = STORIES_PRESET.replace(
        "include: [ЧП], exclude: []}",
        'include: [ЧП], exclude: [], sources: {rss: [{id: own, name: Своя, url: "https://example-own.ru/rss"}]}}',
    )
    with pytest.raises(PresetError, match=re.escape("stories: stories group preset feeds only; topic `incidents` has its own sources")):
        load_preset(write_stories_preset(tmp_path, text=text))


def test_stories_need_preset_feeds(tmp_path):
    text = STORIES_PRESET.replace('sources:\n  rss:\n    - {id: agency, name: Агентство, url: "https://example-agency.ru/rss"}\n', "")
    with pytest.raises(PresetError, match=re.escape("stories: stories need preset feeds (sources.rss)")):
        load_preset(write_stories_preset(tmp_path, text=text))


def _offline_files(root):
    for name, content in (("http.yaml", "{}\n"), ("verdicts.json", "{}"), ("stories.json", '{"merge": [], "facts": []}')):
        (root / name).write_text(content, encoding="utf-8")


def test_offline_stories_file(tmp_path):
    _offline_files(tmp_path)
    offline = 'offline: {now: "2026-10-06T06:00:00+00:00", http: http.yaml, llm: verdicts.json, stories: stories.json}\n'
    preset = load_preset(write_stories_preset(tmp_path, extra=offline))
    require_offline(preset)
    assert preset.offline.stories == (tmp_path / "stories.json").resolve()


def test_offline_preset_with_stories_needs_the_stories_file(tmp_path):
    _offline_files(tmp_path)
    offline = 'offline: {now: "2026-10-06T06:00:00+00:00", http: http.yaml, llm: verdicts.json}\n'
    preset = load_preset(write_stories_preset(tmp_path, extra=offline))
    with pytest.raises(PresetError, match=re.escape("offline.stories: required for a preset with stories")):
        require_offline(preset)
