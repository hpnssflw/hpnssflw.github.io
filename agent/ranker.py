"""The processing stage's rankers. LiveRanker calls DeepSeek through
agent/summarize.py."""

from __future__ import annotations

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
