"""agent/stories.py: fingerprints, ordering, the "first" line, the store."""

from datetime import datetime, timedelta, timezone

import pytest

from agent import stories
from agent.stories import Fact, Report, Story, StoryStore

MSK = timezone(timedelta(hours=3))
NOW = datetime(2026, 10, 6, 6, 0, tzinfo=timezone.utc)
ORDER = {"agency": 0, "city": 1, "gov": 2}


def report(url, at="2026-10-06T03:10:00+00:00", source="agency", name="Агентство", text="", score=7, title=None):
    return Report(
        url=url, title=title or url, kind="rss", source_id=source, source_name=name, published_at=at,
        score=score, summary=f"О {url}.", text=text, text_hash=stories.text_hash(text),
    )


def story(*reports, key=None, status="queued", topic="incidents", opened_at="2026-10-06T06:00:00+00:00"):
    return Story(key=key or reports[0].url, topic=topic, status=status, opened_at=opened_at, reports=list(reports))


def test_normalize_folds_case_yo_and_punctuation():
    assert stories.normalize("Ёлка, «ЁЖ» — 12 шт.!") == "елка еж 12 шт"


def test_text_hash_needs_thirty_words():
    long_text = " ".join(f"слово{i}" for i in range(30))
    assert stories.text_hash("слишком коротко") is None
    assert stories.text_hash(long_text) == stories.text_hash(long_text.upper() + " !!!")
    assert len(stories.text_hash(long_text)) == 16


def test_overlap_is_the_overlap_coefficient_with_a_floor():
    words = " ".join(f"w{i}" for i in range(40))
    part = " ".join(f"w{i}" for i in range(22))  # 20 shingles, all inside `words`
    assert stories.overlap(stories.shingles(words), stories.shingles(part)) == 1.0
    assert stories.overlap(stories.shingles(words), stories.shingles("w1 w2 w3")) == 0.0  # under 20 shingles


def test_ordered_by_time_then_feed_order_then_url():
    a = report("https://b.example/2", source="city")
    b = report("https://a.example/1", source="agency")
    c = report("https://c.example/0", at="2026-10-06T03:00:00+00:00", source="gov")
    assert [r.url for r in stories.ordered(story(a, b, c), ORDER)] == [c.url, b.url, a.url]


def test_first_line_ru():
    s = story(
        report("https://a/1", "2026-10-06T03:10:00+00:00", "agency", "Агентство"),
        report("https://c/1", "2026-10-06T03:52:00+00:00", "city", "Город"),
        report("https://g/1", "2026-10-06T04:40:00+00:00", "gov", "Правительство"),
    )
    assert stories.first_line(s, ORDER, MSK, NOW, "ru") == (
        "Первым — Агентство, 06:10; через 42 мин — Город; через 1 ч 30 мин — Правительство"
    )
    assert stories.first_line(s, ORDER, MSK, NOW, "en") == (
        "First — Агентство, 06:10; 42 min later — Город; 1 h 30 min later — Правительство"
    )


@pytest.mark.parametrize(
    "second, phrase",
    [
        ("2026-10-06T03:10:40+00:00", "в ту же минуту — Город"),
        ("2026-10-06T05:10:00+00:00", "через 2 ч — Город"),
        ("2026-10-07T03:10:00+00:00", "через 1 д — Город"),
        ("2026-10-07T05:20:00+00:00", "через 1 д 2 ч — Город"),
    ],
)
def test_first_line_gaps(second, phrase):
    s = story(report("https://a/1", "2026-10-06T03:10:00+00:00"), report("https://c/1", second, "city", "Город"))
    assert stories.first_line(s, ORDER, MSK, NOW, "ru") == f"Первым — Агентство, 06:10; {phrase}"


def test_first_line_shows_the_date_when_it_is_not_today_in_that_timezone():
    s = story(report("https://a/1", "2026-10-05T12:00:00+00:00"), report("https://c/1", "2026-10-05T12:25:00+00:00", "city", "Город"))
    assert stories.first_line(s, ORDER, MSK, NOW, "ru") == "Первым — Агентство, 05.10 15:00; через 25 мин — Город"


def test_first_line_lists_each_source_once_and_none_for_one_report():
    s = story(report("https://a/1"), report("https://a/2", "2026-10-06T03:20:00+00:00"))
    assert stories.first_line(s, ORDER, MSK, NOW, "ru") == "Первым — Агентство, 06:10"
    assert stories.first_line(story(report("https://a/1")), ORDER, MSK, NOW, "ru") is None


def test_story_derived_fields():
    s = story(report("https://a/1", score=6), report("https://c/1", "2026-10-06T04:00:00+00:00", "city", score=8))
    assert s.score() == 8 and s.sources() == {"agency", "city"} and s.opener().url == "https://a/1"
    assert s.newest() == datetime(2026, 10, 6, 4, 0, tzinfo=timezone.utc) and s.is_open


def test_cap_key_prefers_score_then_sources_then_earliest():
    one = story(report("https://a/1", score=8))
    two = story(report("https://a/2", score=8), report("https://c/2", source="city", score=7))
    best = story(report("https://a/3", score=9))
    assert sorted([one, two, best], key=lambda s: stories.cap_key(s, ORDER)) == [best, two, one]


def test_facts_hash_follows_the_report_set():
    s = story(report("https://a/1"), report("https://c/1", source="city"))
    first = stories.facts_hash(s, 3, "ru")
    assert stories.facts_hash(s, 3, "ru") == first
    assert stories.facts_hash(s, 2, "ru") != first
    s.reports.append(report("https://g/1", source="gov"))
    assert stories.facts_hash(s, 3, "ru") != first


def test_store_round_trip_and_prune(tmp_path):
    path = tmp_path / "stories.json"
    old = "2026-10-04T03:00:00+00:00"  # 51 h before NOW
    store = StoryStore(
        {
            "https://a/1": story(report("https://a/1"), report("https://c/1", source="city")),
            "https://a/2": story(report("https://a/2", old), status="sent"),  # closed, older than 24 h: pruned
            "https://a/3": story(report("https://a/3", "2026-10-04T12:00:00+00:00"), status="waiting"),  # 42 h: inside 2 days, kept
            "https://a/4": story(report("https://a/4", "2026-10-01T00:00:00+00:00"), status="waiting"),  # pruned
            "https://a/5": story(report("https://a/5", old), status="queued"),  # in the queue: kept
        }
    )
    store.stories["https://a/1"].facts = [Fact(text="Факт.", urls=["https://a/1"])]
    stories.save_store(path, store, NOW, window_hours=24, max_age_days=2)
    loaded = stories.load_store(path)
    assert sorted(loaded.stories) == ["https://a/1", "https://a/3", "https://a/5"]
    assert loaded.stories["https://a/1"] == store.stories["https://a/1"]
    assert stories.load_store(tmp_path / "missing.json").stories == {}


def test_member_index_and_matchable():
    fresh = story(report("https://a/1"), report("https://c/1", source="city"))
    stale = story(report("https://a/2", "2026-10-04T00:00:00+00:00"), status="sent")
    store = StoryStore({fresh.key: fresh, stale.key: stale})
    assert stories.member_index(store)["https://c/1"] is fresh
    assert stories.matchable(store, NOW, 24) == [fresh]
