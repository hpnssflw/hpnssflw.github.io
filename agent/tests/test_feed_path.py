"""The preset-feed path end to end on a small offline preset: two preset
feeds (one with full text) and one feed under a topic."""

import json

import pytest

from agent import engine, main, summarize
from agent.dedupe import load_state, url_hash
from agent.paths import DataPaths
from agent.pending import load_pending
from agent.preset import load_preset
from agent.rank_cache import OFF_TOPIC

PRESET = """\
preset: {slug: mini, name: Mini, language: ru}
defaults: {max_age_days: 2, min_relevance: 6, max_items_per_day: 5}
sources:
  rss:
    - {id: agency, name: Агентство, url: "https://example-agency.ru/rss", full_text: true}
    - {id: city, name: Город, url: "https://example-city.ru/rss"}
topics:
  - {slug: incidents, name: Происшествия, description: ЧП., include: [ЧП], exclude: [], max_items_per_day: 1}
  - slug: power
    name: Власть
    description: Решения.
    include: [решения]
    exclude: []
    sources: {rss: [{id: ministry, name: Министерство, url: "https://example-ministry.ru/rss"}]}
ranking: {reader: Редактор.}
llm: {base_url: "https://api.deepseek.com", model: deepseek-v4-flash, api_key_env: DEEPSEEK_API_KEY}
approval: {type: file, path: decisions.json, expire_days: 3}
delivery: {type: file, title: Сводка, cadence_hours: 4}
offline: {now: "2026-10-06T09:00:00+00:00", http: http.yaml, llm: verdicts.json}
"""


def _rss(*items):
    body = "".join(
        f"<item><title>{title}</title><link>{link}</link>{f'<pubDate>{date}</pubDate>' if date else ''}"
        f"<description>{title}.</description></item>"
        for title, link, date in items
    )
    return f'<?xml version="1.0" encoding="utf-8"?><rss version="2.0"><channel><title>x</title>{body}</channel></rss>'


TODAY = "Mon, 06 Oct 2026 05:00:00 GMT"
FILES = {
    "agency.xml": _rss(
        ("Пожар на складе", "https://example-agency.ru/1", TODAY),
        ("ДТП на трассе", "https://example-agency.ru/2", TODAY),
        ("Розыгрыш призов", "https://example-agency.ru/3", TODAY),
        ("Совещание без решений", "https://example-agency.ru/4", TODAY),
        ("Утверждён бюджет", "https://example-agency.ru/5", TODAY),
    ),
    "city.xml": _rss(
        ("Пожар на складе", "https://example-agency.ru/1", TODAY),
        ("Старая новость", "https://example-city.ru/2", "Wed, 01 Oct 2026 05:00:00 GMT"),
        ("Без даты", "https://example-city.ru/3", None),
    ),
    "ministry.xml": _rss(("Назначен министр", "https://example-ministry.ru/1", TODAY)),
    "page1.html": "<html><body><article>"
    + "<p>Ночью загорелся склад на окраине города. Пожарные потушили огонь к утру, никто не пострадал.</p>" * 4
    + "</article></body></html>",
}
HTTP = {
    "https://example-agency.ru/rss": "agency.xml",
    "https://example-city.ru/rss": "city.xml",
    "https://example-ministry.ru/rss": "ministry.xml",
    "https://example-agency.ru/1": "page1.html",
}
VERDICTS = {
    "https://example-agency.ru/1": {"topic": "incidents", "score": 8, "summary": "Сгорел склад."},
    "https://example-agency.ru/2": {"topic": "incidents", "score": 7, "summary": "ДТП."},
    "https://example-agency.ru/3": {"topic": None, "score": 1, "summary": "Реклама."},
    "https://example-agency.ru/4": {"topic": "power", "score": 4, "summary": "Совещание."},
    "https://example-agency.ru/5": {"topic": "power", "score": 9, "summary": "Бюджет утверждён."},
    "https://example-ministry.ru/1": {"topic": "power", "score": 7, "summary": "Новый министр."},
}
DECISIONS = {
    "version": 1,
    "decisions": {
        "https://example-agency.ru/1": {"decision": "approve", "at": "2026-10-06T08:00:00Z"},
        "https://example-agency.ru/5": {"decision": "reject", "at": "2026-10-06T08:00:00Z"},
    },
}


@pytest.fixture
def mini(tmp_path):
    root = tmp_path / "mini"
    root.mkdir()
    (root / "preset.yaml").write_text(PRESET, encoding="utf-8")
    for name, content in FILES.items():
        (root / name).write_text(content, encoding="utf-8")
    (root / "http.yaml").write_text("".join(f'"{url}": {name}\n' for url, name in HTTP.items()), encoding="utf-8")
    (root / "verdicts.json").write_text(json.dumps(VERDICTS, ensure_ascii=False), encoding="utf-8")
    (root / "decisions.json").write_text(json.dumps(DECISIONS), encoding="utf-8")
    return root / "preset.yaml"


def _stage(result, name):
    return next(stage for stage in result["stages"] if stage["stage"] == name)["scopes"]


def test_offline_run_classifies_preset_feeds_and_shares_the_cap(mini, tmp_path, no_network, capsys):
    data = tmp_path / "data"
    main.main(["--preset", str(mini), "--data-dir", str(data), "--offline"])
    assert f"Run result: {data / 'run-result.json'}" in capsys.readouterr().out

    queue = load_pending(data / "pending.json")
    assert [(item.url, item.topic, item.source) for item in queue.items] == [
        ("https://example-ministry.ru/1", "power", "rss"),  # the topic's own feed, ranked against the topic
        ("https://example-agency.ru/1", "incidents", "rss"),  # incidents' cap is 1: /2 is over it
        ("https://example-agency.ru/5", "power", "rss"),
    ]

    preset = load_preset(mini)
    classify_rubric = summarize.classify_rubric_hash(list(preset.topics), preset.reader, preset.language)
    state = load_state(data / "state.json")
    assert state[url_hash("https://example-agency.ru/1")].ranks["incidents"].rubric == classify_rubric
    assert state[url_hash("https://example-agency.ru/3")].ranks[OFF_TOPIC].relevance == 1
    assert state[url_hash("https://example-ministry.ru/1")].ranks["power"].rubric == summarize.rubric_hash(
        preset.topics[1], preset.reader
    )

    result = json.loads((data / "run-result.json").read_text(encoding="utf-8"))
    assert result["run"]["offline"] is True and result["failures"] == []
    assert _stage(result, "collect")["*"] == {"in": 8, "out": 7, "drops": {"undated": 1}}
    assert _stage(result, "window")["*"] == {"in": 7, "out": 6, "drops": {"outside_window": 1}}
    assert _stage(result, "dedupe")["*"] == {"in": 6, "out": 5, "drops": {"seen": 1}}
    assert _stage(result, "enrich")["*"] == {"in": 5, "out": 5, "drops": {}, "notes": {"full_text": 1, "full_text_failed": 4}}
    assert _stage(result, "rank")["*"] == {
        "in": 5,
        "out": 3,
        "drops": {"below_relevance": 1, "off_topic": 1},
        "assigned": {"incidents": 2, "power": 1},
    }
    assert _stage(result, "cap")["incidents"] == {"in": 2, "out": 1, "drops": {"over_max_items": 1}}
    assert _stage(result, "cap")["power"] == {"in": 2, "out": 2, "drops": {}}
    assert result["queue"]["by_topic"] == {"power": 2, "incidents": 1}


def test_second_run_ranks_nothing_and_delivers_the_approved(mini, tmp_path, no_network):
    data = DataPaths(tmp_path / "data")
    data.root.mkdir()
    preset = load_preset(mini)
    engine.run_real(preset, data, preset.offline.now, engine.offline_adapters(preset, data))
    second = engine.offline_adapters(preset, data)
    engine.run_real(preset, data, preset.offline.now, second)

    assert second.ranker.calls == 0
    assert [item.url for item in load_pending(data.pending).items] == ["https://example-ministry.ru/1"]
    outbox = (data.outbox / "2026-10-06T0900Z.html").read_text(encoding="utf-8")
    assert outbox.startswith("<b>Сводка — материалов: 1</b>\n\n<b>Происшествия</b>\n")
    assert '<a href="https://example-agency.ru/1">Пожар на складе</a>\nСгорел склад.' in outbox
    result = json.loads(data.result.read_text(encoding="utf-8"))
    assert _stage(result, "review")["power"]["drops"] == {"rejected": 1}
    assert result["delivery"] == {
        "target": "file",
        "due": True,
        "sent_items": 1,
        "messages": 1,
        "last_sent_at": "2026-10-06T09:00:00+00:00",
    }


def test_preview_and_dry_run_cover_preset_feeds(mini, tmp_path, no_network, capsys):
    data = DataPaths(tmp_path / "data")
    data.root.mkdir()
    preset = load_preset(mini)
    engine.run_preview(preset, data, preset.offline.now, engine.offline_adapters(preset, data))
    out = capsys.readouterr().out
    assert "== Происшествия (incidents) -- feeds\n  queue         8  rss     Пожар на складе" in out
    assert "  over cap      7  rss     ДТП на трассе" in out
    assert "== off topic -- feeds\n  off topic     1  rss     Розыгрыш призов" in out
    assert list(data.root.iterdir()) == []

    engine.run_dry(preset, data, preset.offline.now, engine.offline_adapters(preset, data))
    out = capsys.readouterr().out
    assert "\nPreset feeds\n  collected 8 -> dated 7 -> in-window 6 -> new 6\n" in out
    assert json.loads(data.result.read_text(encoding="utf-8"))["run"]["mode"] == "dry-run"


def test_offline_refuses_a_preset_without_fixtures(capsys):
    with pytest.raises(SystemExit) as exit_info:
        main.main(["--offline"])
    assert exit_info.value.code == 2
    assert "needs an `offline` section" in capsys.readouterr().err
