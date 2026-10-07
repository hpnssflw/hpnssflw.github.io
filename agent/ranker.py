"""The processing stage's rankers. LiveRanker calls DeepSeek through
agent/summarize.py; FixtureRanker serves recorded verdicts for --offline
runs and tests, and fails loudly on an item it has no verdict for."""

from __future__ import annotations

import json
from dataclasses import replace
from pathlib import Path

from agent import stories, summarize
from agent.item import Item
from agent.preset import LLMSettings
from agent.sources.base import TopicConfig
from agent.stories import Report, Story
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

    def merge(self, known: list[Story], entries: list[list[Report]], tz) -> list[list[str]]:
        return summarize.merge(
            [summarize.MergeEntry(title=s.opener().title, text=s.opener().text) for s in known],
            [stories.merge_entry(reports, tz) for reports in entries],
            self.llm,
        )


class FixtureError(RuntimeError):
    """A fixture verdict is missing or doesn't fit the call."""


class FixtureRanker:
    """`offline.llm`: {url: {"topic": slug | null, "score": 1-10, "summary": str}}.
    `offline.stories`: {"merge": [[url, ...], ...] | null, "facts": [{"reports": [url, ...], "response": {...} | null}, ...]}."""

    def __init__(self, path: Path, stories_path: Path | None = None) -> None:
        self.verdicts: dict[str, dict] = json.loads(path.read_text(encoding="utf-8"))
        self.calls = 0  # batches asked for, so tests can see the cache work
        self.story_fixtures = json.loads(stories_path.read_text(encoding="utf-8")) if stories_path else None
        self.merge_calls = 0
        self.facts_calls = 0

    def _story_fixture(self, key: str):
        if self.story_fixtures is None:
            raise FixtureError("this preset has no offline.stories fixture")
        return self.story_fixtures[key]

    def merge(self, known: list[Story], entries: list[list[Report]], tz) -> list[list[str]]:
        """Each fixture group of URLs, as the ids of the entries holding them;
        a null `merge` fails like an LLM that never answers validly."""
        self.merge_calls += 1
        groups_by_url = self._story_fixture("merge")
        if groups_by_url is None:
            raise summarize.MergeFailed("fixture: merge fails")
        groups = []
        for urls in groups_by_url:
            wanted = set(urls)
            ids = [f"S{i}" for i, s in enumerate(known, start=1) if wanted & {r.url for r in s.reports}]
            ids += [f"N{j}" for j, reports in enumerate(entries, start=1) if wanted & {r.url for r in reports}]
            if len(ids) >= 2 and any(e.startswith("N") for e in ids):
                groups.append(ids)
        checked = summarize._parse_merge_response(json.dumps({"groups": groups}), len(known), len(entries))
        if checked is None:
            raise FixtureError(f"the merge fixture gives an invalid answer: {groups}")
        return checked

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
