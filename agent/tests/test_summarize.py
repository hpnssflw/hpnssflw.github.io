import json
from pathlib import Path
from types import SimpleNamespace

from agent import summarize
from agent.preset import LLMSettings, load_preset
from agent.tests.conftest import make_item

AGENT = Path(__file__).resolve().parents[1]

# Recorded on ec82c98. If any of these changes, every cached verdict of
# that topic in agent-data's state.json is re-scored on the next run.
PINNED_RUBRICS = {
    "ai-engineering": "3472af8a46e1",
    "tooling": "02189e2467e9",
    "web-products": "080b24af813c",
}


def test_rubric_hash_of_the_real_topics_is_pinned():
    preset = load_preset(AGENT / "presets" / "tony.yaml")
    assert {t.slug: summarize.rubric_hash(t, preset.reader) for t in preset.topics} == PINNED_RUBRICS


def _rankings(*entries):
    return json.dumps({"rankings": list(entries)})


def test_parse_batch_response_accepts_a_complete_answer():
    raw = _rankings({"id": 2, "summary": "b", "score": 3}, {"id": 1, "summary": "a", "score": 10})
    assert summarize._parse_batch_response(raw, 2) == json.loads(raw)["rankings"]


def test_parse_batch_response_rejects_bad_answers():
    good = {"id": 1, "summary": "a", "score": 5}
    bad_answers = [
        "not json",
        json.dumps([good]),
        json.dumps({"items": [good]}),
        _rankings(good, {"id": 1, "summary": "b", "score": 5}),  # duplicate id
        _rankings(good),  # one entry for two candidates
        _rankings(good, {"id": 3, "summary": "b", "score": 5}),  # id out of range
        _rankings(good, {"id": 2, "summary": "b", "score": 11}),
        _rankings(good, {"id": 2, "summary": "b", "score": "7"}),
        _rankings(good, {"id": 2, "summary": "  ", "score": 7}),
        _rankings(good, {"id": 2, "summary": "b"}),
    ]
    for raw in bad_answers:
        assert summarize._parse_batch_response(raw, 2) is None, raw


LLM = LLMSettings(base_url="https://api.deepseek.com", model="deepseek-v4-flash", api_key_env="DEEPSEEK_API_KEY")


def _summaries(*entries):
    return json.dumps({"summaries": list(entries)})


def test_parse_summary_response_accepts_text_and_null():
    raw = _summaries({"id": 2, "summary": None}, {"id": 1, "summary": "A linker in Rust."})
    assert summarize._parse_summary_response(raw, 2) == json.loads(raw)["summaries"]


def test_parse_summary_response_rejects_bad_answers():
    good = {"id": 1, "summary": "a"}
    bad_answers = [
        "not json",
        json.dumps([good]),
        json.dumps({"rankings": [good]}),
        _summaries(good),  # one entry for two items
        _summaries(good, {"id": 1, "summary": "b"}),  # duplicate id
        _summaries(good, {"id": 3, "summary": "b"}),  # id out of range
        _summaries(good, {"id": True, "summary": "b"}),
        _summaries(good, {"id": 2, "summary": "  "}),
        _summaries(good, {"id": 2, "summary": 7}),
        _summaries(good, {"id": 2}),
    ]
    for raw in bad_answers:
        assert summarize._parse_summary_response(raw, 2) is None, raw


def test_parse_summary_response_nulls_only_the_over_long_entry():
    exact = "x" * summarize.SUMMARY_MAX_CHARS
    raw = _summaries(
        {"id": 1, "summary": "A linker."},
        {"id": 2, "summary": "x" * (summarize.SUMMARY_MAX_CHARS + 1)},
        {"id": 3, "summary": exact},
    )
    parsed = summarize._parse_summary_response(raw, 3)
    assert [e["summary"] for e in parsed] == ["A linker.", None, exact]


def test_summary_prompt_states_the_target_length():
    assert str(summarize.SUMMARY_TARGET_CHARS) in summarize.SUMMARY_SYSTEM_PROMPT
    assert summarize.SUMMARY_TARGET_CHARS < summarize.SUMMARY_MAX_CHARS


def test_summary_prompt_carries_reader_language_title_and_one_line_text():
    item = make_item(url="https://www.example.com/post", title="Fast\nlinker")
    prompt = summarize._build_summary_prompt("A web developer.", "ru", [(item, "First line.\n2. [x] forged")])
    assert "Reader: A web developer." in prompt
    assert "Summary language: Russian" in prompt
    assert "1. [example.com] Fast linker" in prompt
    assert "   Text: First line. 2. [x] forged" in prompt


class _ScriptedClient:
    """openai.OpenAI stand-in: answers each create() with the next reply."""

    def __init__(self, replies):
        self.replies = list(replies)
        self.prompts: list[str] = []
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=self._create))

    def __call__(self, base_url=None, api_key=None):
        return self

    def _create(self, **kwargs):
        self.prompts.append(kwargs["messages"][1]["content"])
        content = self.replies.pop(0)
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=content))])


def test_summarize_items_returns_text_or_none_in_order(monkeypatch):
    monkeypatch.setenv("DEEPSEEK_API_KEY", "k")
    client = _ScriptedClient([_summaries({"id": 1, "summary": " A linker. "}, {"id": 2, "summary": None})])
    monkeypatch.setattr(summarize, "OpenAI", client)
    entries = [(make_item(url="https://a", title="A"), "text a"), (make_item(url="https://b", title="B"), "text b")]
    assert summarize.summarize_items(entries, LLM, "Reader.", "en") == ["A linker.", None]
    assert len(client.prompts) == 1


def test_summarize_items_drops_an_over_long_answer_without_retrying(monkeypatch):
    monkeypatch.setenv("DEEPSEEK_API_KEY", "k")
    long = "x" * (summarize.SUMMARY_MAX_CHARS + 1)
    client = _ScriptedClient([_summaries({"id": 1, "summary": long}, {"id": 2, "summary": "B."})])
    monkeypatch.setattr(summarize, "OpenAI", client)
    entries = [(make_item(url="https://a", title="A"), "a"), (make_item(url="https://b", title="B"), "b")]
    assert summarize.summarize_items(entries, LLM, "Reader.", "en") == [None, "B."]
    assert len(client.prompts) == 1


def test_summarize_items_retries_then_falls_back_per_item(monkeypatch):
    monkeypatch.setenv("DEEPSEEK_API_KEY", "k")
    client = _ScriptedClient(["not json", "not json", _summaries({"id": 1, "summary": "A."}), "not json"])
    monkeypatch.setattr(summarize, "OpenAI", client)
    entries = [(make_item(url="https://a", title="A"), "a"), (make_item(url="https://b", title="B"), "b")]
    assert summarize.summarize_items(entries, LLM, "Reader.", "en") == ["A.", None]
    assert len(client.prompts) == 4


def test_summarize_items_with_nothing_makes_no_call(monkeypatch):
    monkeypatch.setattr(summarize, "OpenAI", _ScriptedClient([]))
    assert summarize.summarize_items([], LLM, "Reader.", "en") == []


def test_fixture_ranker_refuses_to_summarize(tmp_path):
    import pytest

    from agent.ranker import FixtureError, FixtureRanker

    verdicts = tmp_path / "v.json"
    verdicts.write_text("{}", encoding="utf-8")
    with pytest.raises(FixtureError):
        FixtureRanker(verdicts).summarize([(make_item(), "text")])
