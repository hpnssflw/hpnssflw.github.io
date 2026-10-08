import pytest

from agent.approval import merge_decisions
from agent.inbox import DecisionEntry
from agent.tests.conftest import FIXTURES, load_json

CASES = load_json(FIXTURES / "approval-merge.json")["cases"]


def _entries(raw: dict) -> dict[str, DecisionEntry]:
    return {url: DecisionEntry(entry["decision"], entry["at"]) for url, entry in raw.items()}


@pytest.mark.parametrize("case", CASES, ids=[case["name"] for case in CASES])
def test_merge_decisions_on_the_shared_cases(case):
    assert merge_decisions(_entries(case["site"]), _entries(case["telegram"])) == case["expected"]
