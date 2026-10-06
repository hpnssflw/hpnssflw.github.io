import json
from pathlib import Path

from agent import summarize
from agent.preset import load_preset

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
