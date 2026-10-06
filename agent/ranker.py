"""The processing stage's rankers. LiveRanker calls DeepSeek through
agent/summarize.py; FixtureRanker serves recorded verdicts for --offline
runs and tests, and fails loudly on an item it has no verdict for."""

from __future__ import annotations

import json
from dataclasses import replace
from pathlib import Path

from agent import summarize
from agent.item import Item
from agent.preset import LLMSettings
from agent.sources.base import TopicConfig
from agent.summarize import RankedItem


class LiveRanker:
    def __init__(self, llm: LLMSettings, reader: str, language: str) -> None:
        self.llm = llm
        self.reader = reader
        self.language = language

    def rank_topic(self, topic: TopicConfig, items: list[Item]) -> list[RankedItem]:
        return summarize.rank_topic(topic, items, self.llm, self.reader)

    def classify(self, items: list[Item], topics: list[TopicConfig]) -> list[RankedItem]:
        return summarize.classify(items, topics, self.llm, self.reader, self.language)


class FixtureError(RuntimeError):
    """A fixture verdict is missing or doesn't fit the call."""


class FixtureRanker:
    """`offline.llm`: {url: {"topic": slug | null, "score": 1-10, "summary": str}}."""

    def __init__(self, path: Path) -> None:
        self.verdicts: dict[str, dict] = json.loads(path.read_text(encoding="utf-8"))
        self.calls = 0  # batches asked for, so tests can see the cache work

    def rank_topic(self, topic: TopicConfig, items: list[Item]) -> list[RankedItem]:
        if items:
            self.calls += 1
        ranked = []
        for item in items:
            verdict = self._verdict(item)
            if verdict["topic"] != topic.slug:
                raise FixtureError(f"{item.url}: fixture topic {verdict['topic']!r}, ranked for {topic.slug!r}")
            ranked.append(RankedItem(item=item, summary=verdict["summary"], score=verdict["score"]))
        return ranked

    def classify(self, items: list[Item], topics: list[TopicConfig]) -> list[RankedItem]:
        if items:
            self.calls += 1
        slugs = {topic.slug for topic in topics}
        ranked = []
        for item in items:
            verdict = self._verdict(item)
            if verdict["topic"] is not None and verdict["topic"] not in slugs:
                raise FixtureError(f"{item.url}: fixture topic {verdict['topic']!r} isn't one of the preset's")
            ranked.append(
                RankedItem(item=replace(item, topic=verdict["topic"]), summary=verdict["summary"], score=verdict["score"])
            )
        return ranked

    def _verdict(self, item: Item) -> dict:
        try:
            return self.verdicts[item.url]
        except KeyError:
            raise FixtureError(f"no fixture verdict for {item.url}") from None
