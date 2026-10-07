"""A small offline preset with stories, for the engine tests: three
preset feeds, two topics, one pipe-burst event told three ways (an
agency report, a near-copy, an official notice only the LLM can match),
a plant reprint (identical text), and two lone incidents. `later` adds
what run 2 sees four hours on. Times are UTC; the preset shows +03:00."""

from __future__ import annotations

import json
from pathlib import Path

PRESET = """\
preset: {slug: mini-stories, name: Мини, language: ru}
defaults: {max_age_days: 2, min_relevance: 6, max_items_per_day: 2}
sources:
  rss:
    - {id: agency, name: Агентство, url: "https://example-agency.ru/rss"}
    - {id: city, name: Город, url: "https://example-city.ru/rss"}
    - {id: gov, name: Правительство, url: "https://example-gov.ru/rss"}
topics:
  - {slug: incidents, name: Происшествия, description: ЧП., include: [ЧП], exclude: []}
  - {slug: economy, name: Экономика, description: Деньги., include: [предприятия], exclude: []}
stories: {window_hours: 24, timezone: "+03:00", near_text: 0.6, llm_merge: true, max_facts: 3}
ranking: {reader: Редактор.}
llm: {base_url: "https://api.deepseek.com", model: deepseek-v4-flash, api_key_env: DEEPSEEK_API_KEY}
approval: {type: file, path: decisions.json, expire_days: 3}
delivery: {type: file, title: Сводка, cadence_hours: 4}
offline: {now: "2026-10-06T06:00:00+00:00", http: http.yaml, llm: verdicts.json, stories: stories.json}
"""

PIPE = (
    "В ночь на понедельник на улице Садовой произошёл прорыв магистрального водопровода. Без холодной воды "
    "остались жители трёх кварталов, около четырёх тысяч человек. Аварийные бригады водоканала прибыли на место "
    "через сорок минут. По словам диспетчера, повреждённый участок трубы был проложен в 1974 году и давно требовал замены."
)
PIPE_REWRITE = (
    "Ночью на улице Садовой произошёл прорыв магистрального водопровода. Без холодной воды остались жители трёх "
    "кварталов, около четырёх тысяч человек. Аварийные бригады водоканала прибыли на место через сорок минут. По "
    "словам диспетчера, повреждённый участок трубы был проложен в 1974 году."
)
PIPE_OFFICIAL = (
    "Министерство ЖКХ области сообщает: из-за повреждения водовода на улице Садовой временно прекращена подача воды "
    "в три квартала. Организован подвоз питьевой воды. Восстановительные работы ведёт МУП «Водоканал», срок — до вечера 7 октября."
)
PLANT = (
    "Завод «Металлист» объявил о сокращении 300 рабочих мест. Сокращения пройдут до конца года и затронут прежде всего "
    "литейный и механический цеха. Профсоюз завода требует от руководства программу переобучения и выплаты сверх положенных по закону."
)
FIRE = (
    "Вечером в общежитии на улице Ленина загорелась комната на третьем этаже. Пожарные эвакуировали сорок человек и "
    "потушили огонь за полчаса. Пострадавших нет, причину пожара устанавливают дознаватели МЧС."
)
CRASH = (
    "На трассе Р-22 столкнулись грузовик и рейсовый автобус. Пострадали шесть пассажиров, их доставили в районную "
    "больницу. Движение на участке было перекрыто на два часа, сейчас оно восстановлено."
)
PIPE_FOLLOWUP = (
    "Водоканал сообщил, что ремонт трубы на Садовой завершится к вечеру вторника. До этого времени подвоз питьевой "
    "воды продолжится у школы и поликлиники."
)
PIPE_EARLY = "Диспетчерская служба области зафиксировала резкое падение давления в водопроводе на Садовой. На место направлена аварийная бригада."

A, C, G = "https://example-agency.ru", "https://example-city.ru", "https://example-gov.ru"
NOW = "2026-10-06T06:00:00+00:00"
LATER = "2026-10-06T10:00:00+00:00"


def _rss(*items: tuple[str, str, str, str]) -> str:
    body = "".join(
        f"<item><title>{title}</title><link>{link}</link><pubDate>{date}</pubDate><description>{text}</description></item>"
        for title, link, date, text in items
    )
    return f'<?xml version="1.0" encoding="utf-8"?><rss version="2.0"><channel><title>x</title>{body}</channel></rss>'


RUN1 = {
    "agency.xml": _rss(
        ("Прорыв трубы на Садовой", f"{A}/1", "Mon, 06 Oct 2026 03:10:00 +0000", PIPE),
        ("Металлист сокращает 300 мест", f"{A}/2", "Sun, 05 Oct 2026 12:00:00 +0000", PLANT),
        ("Пожар в общежитии", f"{A}/3", "Mon, 06 Oct 2026 02:00:00 +0000", FIRE),
        ("ДТП на трассе Р-22", f"{A}/4", "Mon, 06 Oct 2026 01:00:00 +0000", CRASH),
    ),
    "city.xml": _rss(
        ("На Садовой прорвало трубу", f"{C}/c1", "Mon, 06 Oct 2026 03:52:00 +0000", PIPE_REWRITE),
        ("Металлист: 300 мест под сокращение", f"{C}/c2", "Sun, 05 Oct 2026 12:25:00 +0000", PLANT),
    ),
    "gov.xml": _rss(("Об аварии на водопроводе", f"{G}/g1", "Mon, 06 Oct 2026 04:40:00 +0000", PIPE_OFFICIAL)),
}
# Run 2 (LATER): the same items, plus a follow-up, an earlier official
# report collected late, and another plant reprint.
LATER_FILES = {
    "agency-later.xml": RUN1["agency.xml"].replace(
        "</channel>", f"<item><title>Ремонт на Садовой</title><link>{A}/5</link><pubDate>Mon, 06 Oct 2026 08:00:00 +0000</pubDate><description>{PIPE_FOLLOWUP}</description></item></channel>"
    ),
    "city-later.xml": RUN1["city.xml"].replace(
        "</channel>", f"<item><title>Металлист сокращает рабочих</title><link>{C}/c3</link><pubDate>Mon, 06 Oct 2026 07:00:00 +0000</pubDate><description>{PLANT}</description></item></channel>"
    ),
    "gov-later.xml": RUN1["gov.xml"].replace(
        "</channel>", f"<item><title>Падение давления на Садовой</title><link>{G}/g2</link><pubDate>Mon, 06 Oct 2026 02:55:00 +0000</pubDate><description>{PIPE_EARLY}</description></item></channel>"
    ),
}
VERDICTS = {
    f"{A}/1": ("incidents", 8),
    f"{C}/c1": ("incidents", 7),
    f"{G}/g1": ("incidents", 7),
    f"{A}/3": ("incidents", 7),
    f"{A}/4": ("incidents", 6),
    f"{A}/2": ("economy", 9),
    f"{C}/c2": ("economy", 8),
    f"{A}/5": ("incidents", 7),
    f"{C}/c3": ("economy", 8),
    f"{G}/g2": ("incidents", 6),
}
PIPE_RUN1 = [f"{A}/1", f"{C}/c1", f"{G}/g1"]
PIPE_RUN2 = [f"{A}/1", f"{C}/c1", f"{G}/g1", f"{A}/5", f"{G}/g2"]
STORIES = {
    "merge": [[f"{A}/1", f"{G}/g1", f"{A}/5", f"{G}/g2"]],
    "facts": [
        {
            "reports": PIPE_RUN1,
            "response": {
                "facts": [
                    {"text": "Без холодной воды остались три квартала.", "refs": [1, 2]},
                    {"text": "Организован подвоз питьевой воды.", "refs": [3]},
                    {"text": "Трубу проложили в 1974 году.", "refs": [4]},
                ]
            },
        },
        {"reports": [f"{A}/2", f"{C}/c2"], "response": {"facts": [{"text": "Завод сократит 300 рабочих мест.", "refs": [1, 2]}]}},
        {"reports": PIPE_RUN2, "response": {"facts": [{"text": "Давление упало ночью.", "refs": [1]}]}},
        # the pipe story before g1 joins (the failed-merge test)
        {"reports": [f"{A}/1", f"{C}/c1"], "response": {"facts": [{"text": "На Садовой прорвало трубу.", "refs": [1, 2]}]}},
    ],
}
DECISIONS = {  # read at every run's start; run 1's queue starts empty, so they act in run 2
    "version": 1,
    "decisions": {
        f"{A}/2": {"decision": "approve", "at": "2026-10-06T07:00:00Z"},
        f"{A}/3": {"decision": "reject", "at": "2026-10-06T07:00:00Z"},
    },
}


def write(root: Path, stories: dict | None = None) -> Path:
    """The preset and its fixtures under root; returns the preset path."""
    root.mkdir(parents=True, exist_ok=True)
    (root / "preset.yaml").write_text(PRESET, encoding="utf-8")
    for name, content in {**RUN1, **LATER_FILES}.items():
        (root / name).write_text(content, encoding="utf-8")
    feeds = {f"{A}/rss": "agency", f"{C}/rss": "city", f"{G}/rss": "gov"}
    (root / "http.yaml").write_text("".join(f'"{u}": {n}.xml\n' for u, n in feeds.items()), encoding="utf-8")
    (root / "http-later.yaml").write_text("".join(f'"{u}": {n}-later.xml\n' for u, n in feeds.items()), encoding="utf-8")
    verdicts = {url: {"topic": topic, "score": score, "summary": f"Кратко: {url[-2:]}."} for url, (topic, score) in VERDICTS.items()}
    (root / "verdicts.json").write_text(json.dumps(verdicts, ensure_ascii=False), encoding="utf-8")
    (root / "stories.json").write_text(json.dumps(stories or STORIES, ensure_ascii=False), encoding="utf-8")
    (root / "decisions.json").write_text(json.dumps(DECISIONS), encoding="utf-8")
    return root / "preset.yaml"
