"""The stories' LLM prompts: merge (this task) and facts (Task 5)."""

import json
from datetime import timedelta, timezone
from types import SimpleNamespace

import pytest

from agent import ranker, summarize
from agent.preset import LLMSettings
from agent.tests.test_stories import report, story

LLM = LLMSettings(base_url="https://api.deepseek.com", model="deepseek-v4-flash", api_key_env="DEEPSEEK_API_KEY")
MSK = timezone(timedelta(hours=3))


class Scripted:
    """openai.OpenAI stand-in: replies in order, records prompts."""

    def __init__(self, *replies):
        self.replies = list(replies)
        self.prompts = []
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=self._create))

    def __call__(self, base_url=None, api_key=None):
        return self

    def _create(self, **kwargs):
        self.prompts.append(kwargs)
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=self.replies.pop(0)))])


@pytest.fixture
def scripted(monkeypatch):
    monkeypatch.setenv("DEEPSEEK_API_KEY", "test")

    def install(*replies):
        fake = Scripted(*replies)
        monkeypatch.setattr(summarize, "OpenAI", fake)
        return fake

    return install


def test_merge_prompt_lists_known_and_new_entries():
    prompt = summarize._build_merge_prompt(
        [summarize.MergeEntry(title="Прорыв трубы", text="т" * 400)],
        [summarize.MergeEntry(title="Без воды", text="Три квартала.", source="Город · 06:52")],
    )
    assert prompt.splitlines()[0:2] == ["Known stories:", "S1: Прорыв трубы — " + "т" * 300]
    assert "N1: [Город · 06:52] Без воды — Три квартала." in prompt
    assert summarize._build_merge_prompt([], [summarize.MergeEntry("a", "", "x · 01:00")]).splitlines()[1] == "(none)"


@pytest.mark.parametrize(
    "raw, ok",
    [
        ('{"groups": [["S1", "N1"], ["N2", "N3"]]}', True),
        ('{"groups": []}', True),
        ('{"groups": [["S1", "S2", "N1"]]}', False),  # two known stories
        ('{"groups": [["N1"]]}', False),  # singleton
        ('{"groups": [["S1", "N1"], ["N1", "N2"]]}', False),  # id twice
        ('{"groups": [["S1", "N9"]]}', False),  # unknown id
        ('{"groups": [["S1", "S2"]]}', False),  # no new entry
        ('{"group": []}', False),
        ("not json", False),
    ],
)
def test_parse_merge_response(raw, ok):
    parsed = summarize._parse_merge_response(raw, known_count=2, new_count=3)
    assert (parsed is not None) is ok


def test_merge_retries_once_then_fails(scripted):
    fake = scripted("nope", '{"groups": [["S1", "N1"]]}')
    assert summarize.merge([summarize.MergeEntry("a", "b")], [summarize.MergeEntry("c", "d", "x · 01:00")], LLM) == [["S1", "N1"]]
    assert fake.prompts[0]["temperature"] == 0 and fake.prompts[0]["messages"][0]["content"] == summarize.MERGE_SYSTEM_PROMPT
    scripted("nope", "still nope")
    with pytest.raises(summarize.MergeFailed):
        summarize.merge([summarize.MergeEntry("a", "b")], [summarize.MergeEntry("c", "d", "x · 01:00")], LLM)


def test_live_ranker_merge_builds_entries_from_reports(scripted):
    fake = scripted('{"groups": []}')
    known = story(report("https://a/1", title="Прорыв трубы", text="Текст."))
    new = [report("https://c/1", "2026-10-06T03:52:00+00:00", "city", "Город", title="Без воды", text="Три квартала.")]
    assert ranker.LiveRanker(LLM, "Редактор.", "ru").merge([known], [new], MSK) == []
    user = fake.prompts[0]["messages"][1]["content"]
    assert "S1: Прорыв трубы — Текст." in user and "N1: [Город · 06:52] Без воды — Три квартала." in user


def test_fixture_ranker_merge_maps_url_groups_to_ids(tmp_path):
    (tmp_path / "verdicts.json").write_text("{}", encoding="utf-8")
    (tmp_path / "stories.json").write_text(json.dumps({"merge": [["https://a/1", "https://g/1"]], "facts": []}), encoding="utf-8")
    fixture = ranker.FixtureRanker(tmp_path / "verdicts.json", tmp_path / "stories.json")
    known = story(report("https://a/1"), report("https://c/1"))
    assert fixture.merge([known], [[report("https://g/1")], [report("https://x/1")]], MSK) == [["S1", "N1"]]
    assert fixture.merge_calls == 1
    (tmp_path / "stories.json").write_text(json.dumps({"merge": None, "facts": []}), encoding="utf-8")
    with pytest.raises(summarize.MergeFailed):
        ranker.FixtureRanker(tmp_path / "verdicts.json", tmp_path / "stories.json").merge([known], [[report("https://g/1")]], MSK)
