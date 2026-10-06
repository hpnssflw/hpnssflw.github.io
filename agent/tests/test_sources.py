from datetime import timedelta

import pytest
import requests

from agent.item import Item
from agent.sources import github_trending, hn
from agent.tests.conftest import FROZEN_NOW, FakeHttp, make_topic


@pytest.fixture
def http(monkeypatch):
    fake = FakeHttp(
        hn={
            "CLI": [
                {"objectID": "1", "title": "A CLI", "url": "https://cli.example/", "age_hours": 3, "points": 50},
                {"objectID": "2", "title": "Ask HN: CLIs?", "url": None, "age_hours": 4, "points": 40, "story_text": "x" * 300},
            ]
        },
        github={"cli": [{"full_name": "acme/cli", "description": "A CLI", "topics": ["cli"], "age_hours": 5, "stargazers_count": 70}]},
        decisions={},
    )
    monkeypatch.setattr(requests, "get", fake.get)
    return fake


def test_hn_items_carry_kind_source_and_topic(http):
    topic = make_topic(sources={"hacker_news": {"min_points": 30}})
    items, drops = hn.collect(topic, FROZEN_NOW)
    assert drops == []
    assert items == [
        Item(
            url="https://cli.example/",
            title="A CLI",
            kind="hn",
            source_id="hacker_news",
            source_name="Hacker News",
            topic="tooling",
            published_at=FROZEN_NOW - timedelta(hours=3),
            score=50,
            text=None,
        ),
        Item(
            url="https://news.ycombinator.com/item?id=2",
            title="Ask HN: CLIs?",
            kind="hn",
            source_id="hacker_news",
            source_name="Hacker News",
            topic="tooling",
            published_at=FROZEN_NOW - timedelta(hours=4),
            score=40,
            text="x" * 280,
        ),
    ]


def test_github_items_carry_kind_source_and_topic(http):
    topic = make_topic(sources={"github_trending": {"min_stars": 50, "topics": ["cli"]}})
    items, drops = github_trending.collect(topic, FROZEN_NOW)
    assert drops == []
    assert [(i.url, i.kind, i.source_id, i.source_name, i.topic, i.score, i.text) for i in items] == [
        ("https://github.com/acme/cli", "github", "github_trending", "GitHub", "tooling", 70, "A CLI · topics: cli")
    ]
