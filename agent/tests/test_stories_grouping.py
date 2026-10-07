"""stories.group_reports: identical text, near-identical text, then the
injected LLM merge; known stories never merge with each other."""

from datetime import datetime, timezone

from agent import stories
from agent.preset import StoriesConfig
from agent.stories import StoryStore
from agent.tests.conftest import make_item
from agent.tests.test_stories import report, story

NOW = datetime(2026, 10, 6, 6, 0, tzinfo=timezone.utc)
CONFIG = StoriesConfig(timezone="+03:00")
LONG = " ".join(f"слово{i}" for i in range(40))  # hashable (>= 30 words)
NEAR = " ".join(f"слово{i}" for i in range(36)) + " иначе"  # same shingles, different hash
OTHER = " ".join(f"другое{i}" for i in range(40))


def group(reports, known=(), merge=None, config=CONFIG):
    topic_of = {r.url: "incidents" for r in reports}
    return stories.group_reports(list(reports), topic_of, list(known), config, NOW, merge)


def test_identical_text_opens_one_story_with_the_earliest_report_as_opener():
    late = report("https://c/1", "2026-10-06T04:00:00+00:00", "city", text=LONG)
    early = report("https://a/1", "2026-10-06T03:00:00+00:00", text=LONG)
    result = group([late, early])
    assert [(s.key, [r.url for r in s.reports], s.status) for s in result.opened] == [
        ("https://a/1", ["https://a/1", "https://c/1"], "waiting")
    ]
    assert result.matched["text"] == 1


def test_near_text_joins_and_unrelated_text_stands_alone():
    result = group([report("https://a/1", text=LONG), report("https://c/1", source="city", text=NEAR), report("https://g/1", text=OTHER)])
    assert sorted(len(s.reports) for s in result.opened) == [1, 2]
    assert result.matched["near"] == 1


def test_a_new_report_joins_an_open_story_and_drops_on_a_closed_one():
    open_story = story(report("https://a/1", text=LONG))
    closed = story(report("https://a/2", text=OTHER), status="approved")
    result = group([report("https://c/1", text=LONG), report("https://c/2", text=OTHER)], known=[open_story, closed])
    assert [(s.key, r.url) for s, r in result.joined] == [("https://a/1", "https://c/1")]
    assert [(s.key, r.url) for s, r in result.same_story] == [("https://a/2", "https://c/2")]
    assert result.opened == []


def test_a_report_matching_two_known_stories_joins_the_earlier_opened_one():
    first = story(report("https://a/1", text=LONG), opened_at="2026-10-05T06:00:00+00:00")
    second = story(report("https://a/2", text=LONG), opened_at="2026-10-06T02:00:00+00:00")
    result = group([report("https://c/1", text=LONG)], known=[second, first])
    assert [(s.key, r.url) for s, r in result.joined] == [("https://a/1", "https://c/1")]


def test_matches_are_transitive():
    result = group([report("https://a/1", text=LONG), report("https://b/1", text=LONG), report("https://c/1", text=NEAR)])
    assert [len(s.reports) for s in result.opened] == [3]


def test_llm_merge_joins_entries_and_known_stories():
    known = story(report("https://a/1", text=OTHER))
    calls = []

    def merge(known_stories, entries):
        calls.append(([s.key for s in known_stories], [[r.url for r in e] for e in entries]))
        return [["S1", "N1"], ["N2", "N3"]]

    result = group([report("https://c/1"), report("https://c/2"), report("https://c/3")], known=[known], merge=merge)
    assert calls == [(["https://a/1"], [["https://c/1"], ["https://c/2"], ["https://c/3"]])]
    assert [(s.key, r.url) for s, r in result.joined] == [("https://a/1", "https://c/1")]
    assert [[r.url for r in s.reports] for s in result.opened] == [["https://c/2", "https://c/3"]]
    assert result.matched["llm"] == 2


def test_a_cheap_group_is_one_llm_entry():
    seen = []
    group([report("https://a/1", text=LONG), report("https://c/1", text=LONG), report("https://g/1")], merge=lambda k, e: seen.append(e) or [])
    assert [[r.url for r in entry] for entry in seen[0]] == [["https://a/1", "https://c/1"], ["https://g/1"]]


def test_merge_failure_holds_unmatched_reports_but_keeps_cheap_groups():
    def merge(known_stories, entries):
        raise RuntimeError("deepseek down")

    result = group([report("https://a/1", text=LONG), report("https://c/1", text=LONG), report("https://g/1")], merge=merge)
    assert [r.url for r in result.held] == ["https://g/1"]
    assert [[r.url for r in s.reports] for s in result.opened] == [["https://a/1", "https://c/1"]]
    assert [type(e).__name__ for e in result.failures] == ["RuntimeError"]


def test_merge_is_skipped_with_fewer_than_two_entries_or_no_new_entry():
    called = []
    group([report("https://a/1")], merge=lambda k, e: called.append(1) or [])
    group([report("https://c/1", text=LONG)], known=[story(report("https://a/1", text=LONG))], merge=lambda k, e: called.append(1) or [])
    assert called == []


def test_merge_runs_in_chunks_of_thirty_new_entries():
    sizes = []
    group([report(f"https://a/{i}") for i in range(31)], merge=lambda k, e: sizes.append(len(e)) or [])
    assert sizes == [30, 1]


def test_apply_grouping_and_filter_members():
    open_story = story(report("https://a/1", text=LONG))
    store = StoryStore({open_story.key: open_story})
    result = group([report("https://c/1", text=LONG), report("https://g/1", text=OTHER)], known=[open_story])
    stories.apply_grouping(store, result)
    assert [r.url for r in store.stories["https://a/1"].reports] == ["https://a/1", "https://c/1"]
    assert store.stories["https://g/1"].status == "waiting"
    items = [make_item(url="https://c/1", kind="rss"), make_item(url="https://g/1", kind="rss")]
    kept, drops = stories.filter_members(items, store)  # a/1 is queued: its reports drop; g/1 is waiting: it passes
    assert [i.url for i in kept] == ["https://g/1"]
    assert [(d.url, d.reason, d.detail) for d in drops] == [("https://c/1", "seen", {"story": "https://a/1"})]
