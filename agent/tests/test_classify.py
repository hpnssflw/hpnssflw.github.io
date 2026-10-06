import json
from dataclasses import replace
from types import SimpleNamespace

import pytest

from agent import rank_cache, summarize
from agent.dedupe import RankRecord, StateEntry, url_hash
from agent.preset import LLMSettings, load_preset
from agent.ranker import FixtureError, FixtureRanker
from agent.run_result import preset_config
from agent.summarize import RankedItem
from agent.tests.conftest import FROZEN_NOW, make_item, make_topic
from agent.tests.test_preset import VALID, write_preset

LLM = LLMSettings(base_url="https://api.deepseek.com", model="deepseek-v4-flash", api_key_env="TEST_LLM_KEY")
INCIDENTS = make_topic("incidents", name="Происшествия", description="ЧП.", include=["ЧП"], exclude=["вне региона"])
POWER = make_topic("power", name="Власть", description="Решения.", include=["решения"], exclude=[])


def _feed_item(n, text="Текст.", source_name="Агентство"):
    return replace(
        make_item(url=f"https://example-agency.ru/news/{n}", title=f"Новость {n}", kind="rss", topic=None, score=None, text=text),
        source_id="agency",
        source_name=source_name,
    )


class FakeClassifier:
    """openai.OpenAI stand-in: answers from `replies` in order."""

    def __init__(self, replies):
        self.replies = list(replies)
        self.prompts = []
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=self._create))

    def __call__(self, base_url=None, api_key=None):
        return self

    def _create(self, **kwargs):
        self.prompts.append(kwargs)
        content = self.replies.pop(0)
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=content))])


def _reply(*entries):
    return json.dumps({"rankings": list(entries)})


def test_classify_prompt_lists_topics_language_and_cut_text():
    items = [_feed_item(1, text="x" * 900)]
    prompt = summarize._build_classify_prompt([INCIDENTS, POWER], "Редактор.", "ru", items)
    assert prompt.splitlines()[:3] == ["Reader: Редактор.", "Summary language: Russian", "Topics:"]
    assert "- slug: incidents\n  Name: Происшествия\n  Description: ЧП.\n  Include:\n  - ЧП\n  Exclude:\n  - вне региона" in prompt
    assert prompt.endswith(f"1. [rss · Агентство · example-agency.ru] Новость 1 — {'x' * 600}")


def test_topic_prompt_cuts_long_rss_text_but_not_hn_excerpts():
    hn_item = make_item(text="y" * 280)
    rss_item = replace(_feed_item(2, text="z" * 900), topic="tooling")
    prompt = summarize._build_batch_prompt(make_topic(), "Reader.", [hn_item, rss_item])
    assert f"— {'y' * 280}\n" in prompt
    assert prompt.endswith(f"— {'z' * 600}")


def test_parse_classify_response_needs_a_known_topic_or_null():
    slugs = {"incidents", "power"}
    good = _reply(
        {"id": 1, "topic": "power", "summary": "a", "score": 7},
        {"id": 2, "topic": None, "summary": "b", "score": 1},
    )
    assert [e["topic"] for e in summarize._parse_classify_response(good, 2, slugs)] == ["power", None]
    assert summarize._parse_classify_response(_reply({"id": 1, "topic": "sport", "summary": "a", "score": 7}), 1, slugs) is None
    assert summarize._parse_classify_response(_reply({"id": 1, "summary": "a", "score": 7}), 1, slugs) is None
    assert summarize._parse_classify_response(_reply({"id": 1, "topic": "power", "summary": "a", "score": 0}), 1, slugs) is None


def test_classify_sets_the_topic_on_each_item_and_falls_back_per_item(monkeypatch):
    fake = FakeClassifier(
        [
            "not json",
            "still not json",
            _reply({"id": 1, "topic": "power", "summary": "Решение.", "score": 8}),
            _reply({"id": 1, "topic": None, "summary": "Реклама.", "score": 1}),
            "broken",
        ]
    )
    monkeypatch.setattr(summarize, "OpenAI", fake)
    monkeypatch.setenv("TEST_LLM_KEY", "k")
    items = [_feed_item(1), _feed_item(2), _feed_item(3)]

    ranked = summarize.classify(items, [INCIDENTS, POWER], LLM, "Редактор.", "ru")

    assert [(r.item.topic, r.score, r.summary, r.failed) for r in ranked] == [
        ("power", 8, "Решение.", False),
        (None, 1, "Реклама.", False),
        (None, 1, "(ranking failed)", True),
    ]
    assert len(fake.prompts) == 5
    assert all(p["temperature"] == 0 and p["messages"][0]["content"] == summarize.CLASSIFY_SYSTEM_PROMPT for p in fake.prompts)


def test_classify_rubric_changes_with_criteria_and_language():
    base = summarize.classify_rubric_hash([INCIDENTS, POWER], "R.", "ru")
    assert base == summarize.classify_rubric_hash([INCIDENTS, POWER], "R.", "ru")
    assert base != summarize.classify_rubric_hash([INCIDENTS, POWER], "R.", "en")
    assert base != summarize.classify_rubric_hash([INCIDENTS, replace(POWER, include=["бюджет"])], "R.", "ru")


def _state_with(item, slug, relevance, rubric="c1"):
    record = RankRecord(relevance=relevance, summary="cached", rubric=rubric, source_score=None, ranked_at="t")
    return {url_hash(item.url): StateEntry("t", None, 0, ranks={slug: record})}


def test_partition_classified():
    topics = {"incidents": INCIDENTS, "power": POWER}
    item = _feed_item(1)
    assert rank_cache.partition_classified([item], {}, "c1", topics) == ([item], [], [])
    assert rank_cache.partition_classified([item], _state_with(item, "power", 8, rubric="old"), "c1", topics)[0] == [item]

    _, cached, drops = rank_cache.partition_classified([item], _state_with(item, "power", 8), "c1", topics)
    assert drops == [] and [(r.item.topic, r.score, r.summary) for r in cached] == [("power", 8, "cached")]

    _, cached, drops = rank_cache.partition_classified([item], _state_with(item, "power", 3), "c1", topics)
    assert cached == [] and [(d.reason, d.detail) for d in drops] == [("already_ranked", {"relevance": 3, "topic": "power"})]

    _, cached, drops = rank_cache.partition_classified([item], _state_with(item, rank_cache.OFF_TOPIC, 1), "c1", topics)
    assert cached == [] and [(d.reason, d.detail) for d in drops] == [("already_ranked", {"relevance": 1, "topic": None})]


def test_record_classified_files_verdicts_under_the_assigned_topic():
    on_topic, off_topic, failed = _feed_item(1), _feed_item(2), _feed_item(3)
    state = {url_hash(i.url): StateEntry("t", None, 0) for i in (on_topic, off_topic, failed)}
    rank_cache.record_classified(
        state,
        [
            RankedItem(replace(on_topic, topic="power"), "Решение.", 8),
            RankedItem(off_topic, "Реклама.", 1),
            RankedItem(failed, "(ranking failed)", 1, failed=True),
        ],
        "c1",
        FROZEN_NOW,
    )
    assert state[url_hash(on_topic.url)].ranks["power"].rubric == "c1"
    assert state[url_hash(off_topic.url)].ranks[rank_cache.OFF_TOPIC].relevance == 1
    assert state[url_hash(failed.url)].ranks == {}


def test_fixture_ranker(tmp_path):
    path = tmp_path / "verdicts.json"
    path.write_text(
        json.dumps(
            {
                "https://example-agency.ru/news/1": {"topic": "power", "score": 8, "summary": "Решение."},
                "https://example-agency.ru/news/2": {"topic": None, "score": 1, "summary": "Реклама."},
                "https://example-agency.ru/news/3": {"topic": "sport", "score": 5, "summary": "Матч."},
            }
        ),
        encoding="utf-8",
    )
    ranker = FixtureRanker(path)
    ranked = ranker.classify([_feed_item(1), _feed_item(2)], [INCIDENTS, POWER])
    assert [(r.item.topic, r.score) for r in ranked] == [("power", 8), (None, 1)]
    assert ranker.rank_topic(POWER, [_feed_item(1)])[0].score == 8
    assert ranker.calls == 2
    assert ranker.classify([], [INCIDENTS]) == [] and ranker.calls == 2
    with pytest.raises(FixtureError, match="no fixture verdict"):
        ranker.classify([_feed_item(9)], [INCIDENTS])
    with pytest.raises(FixtureError, match="isn't one of the preset's"):
        ranker.classify([_feed_item(3)], [INCIDENTS, POWER])
    with pytest.raises(FixtureError, match="ranked for 'incidents'"):
        ranker.rank_topic(INCIDENTS, [_feed_item(1)])


def test_feed_presets_show_classification_in_their_config(tmp_path):
    config = preset_config(load_preset(write_preset(tmp_path, VALID)))
    assert config["ranking"]["classify_prompt_version"] == summarize.CLASSIFY_PROMPT_VERSION
    assert len(config["ranking"]["classify_rubric_hash"]) == 12
