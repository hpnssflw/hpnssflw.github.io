"""Shared test doubles. Nothing in agent/tests touches the network: HN
Algolia, GitHub search, the inbox and Telegram go through FakeHttp, and
DeepSeek through FakeDeepSeek. FROZEN_NOW is the clock every test runs at."""

from __future__ import annotations

import hashlib
import json
import re
import socket
from dataclasses import replace
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest
import requests

from agent.paths import DataPaths

AGENT_DIR = Path(__file__).resolve().parents[1]
FIXTURES = Path(__file__).parent / "fixtures"
TONY = FIXTURES / "tony"
FROZEN_NOW = datetime(2026, 10, 6, 12, 0, tzinfo=timezone.utc)

ALGOLIA_URL = "https://hn.algolia.com/api/v1/search"
GITHUB_SEARCH_URL = "https://api.github.com/search/repositories"


def load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def make_item(
    url: str = "https://example.com/a",
    title: str = "A",
    kind: str = "hn",
    topic: str | None = "tooling",
    score: int | None = 10,
    text: str | None = None,
    published_at: datetime = FROZEN_NOW,
):
    """One collected item, as the pipeline passes it between stages."""
    from agent.item import Item

    source_id, source_name = {
        "hn": ("hacker_news", "Hacker News"),
        "github": ("github_trending", "GitHub"),
    }.get(kind, ("example-feed", "Example feed"))
    return Item(
        url=url,
        title=title,
        kind=kind,
        source_id=source_id,
        source_name=source_name,
        topic=topic,
        published_at=published_at,
        score=score,
        text=text,
    )


def make_topic(slug: str = "tooling", **overrides):
    from agent.sources.base import TopicConfig

    fields = dict(
        slug=slug,
        name="Tooling",
        description="Tools developers use.",
        keywords=["CLI"],
        include=["tools used while building software"],
        exclude=["games"],
        sources={},
        max_age_days=10,
        min_relevance=6,
        max_items_per_day=3,
        attention_enabled=True,
        attention_min_score_gain=50,
    )
    fields.update(overrides)
    return TopicConfig(**fields)


class FakeResponse:
    def __init__(self, status_code: int, payload=None):
        self.status_code = status_code
        self._payload = payload
        self.text = json.dumps(payload)
        self.headers: dict[str, str] = {}

    def json(self):
        return self._payload

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise requests.HTTPError(f"HTTP {self.status_code}", response=self)


class FakeHttp:
    """Serves HN Algolia hits by query keyword, GitHub search results by
    `topic:` qualifier, and decisions.json; records Telegram posts."""

    def __init__(self, hn: dict, github: dict, decisions: dict):
        self.hn = hn
        self.github = github
        self.decisions = decisions
        self.posts: list[dict] = []

    def get(self, url, params=None, headers=None, timeout=None, **kwargs):
        if url == ALGOLIA_URL:
            return FakeResponse(200, {"hits": [self._hit(h) for h in self.hn.get(params["query"], [])]})
        if url == GITHUB_SEARCH_URL:
            github_topic = re.match(r"topic:(\S+) ", params["q"]).group(1)
            return FakeResponse(200, {"items": [self._repo(r) for r in self.github.get(github_topic, [])]})
        if "tony-inbox" in url:
            return FakeResponse(200, self.decisions)
        raise AssertionError(f"unexpected GET {url}")

    def post(self, url, json=None, timeout=None, **kwargs):
        assert url.startswith("https://api.telegram.org/bot"), url
        self.posts.append(json)
        return FakeResponse(200, {"ok": True})

    @staticmethod
    def _hit(raw: dict) -> dict:
        hit = {key: value for key, value in raw.items() if key != "age_hours"}
        hit["created_at_i"] = int((FROZEN_NOW - timedelta(hours=raw["age_hours"])).timestamp())
        return hit

    @staticmethod
    def _repo(raw: dict) -> dict:
        repo = {key: value for key, value in raw.items() if key != "age_hours"}
        repo["html_url"] = f"https://github.com/{raw['full_name']}"
        if raw["age_hours"] is None:
            repo["created_at"] = None
        else:
            created = FROZEN_NOW - timedelta(hours=raw["age_hours"])
            repo["created_at"] = created.strftime("%Y-%m-%dT%H:%M:%SZ")
        return repo


CANDIDATE_LINE = re.compile(r"^\d+\. \[[^\]]*\] (.*)$")


class FakeDeepSeek:
    """Stands in for openai.OpenAI (patched over agent.summarize.OpenAI).
    Scores come from scores.json by title, default 3, summary "About:
    <title>."; a batch holding a title with "[[bad]]" gets an unparseable
    reply, which drives summarize's retry and per-candidate fallback.
    Records every call."""

    def __init__(self, scores: dict):
        self.scores = scores
        self.calls: list[dict] = []
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=self._create))

    def __call__(self, base_url=None, api_key=None):
        return self

    def _create(self, **kwargs):
        self.calls.append(kwargs)
        user = kwargs["messages"][1]["content"]
        titles = [
            match.group(1).split(" — ")[0]
            for match in map(CANDIDATE_LINE.match, user.split("Candidates:\n", 1)[1].splitlines())
            if match
        ]
        if any("[[bad]]" in title for title in titles):
            content = "not json"
        else:
            content = json.dumps(
                {
                    "rankings": [
                        {"id": index, "summary": f"About: {title}.", "score": self.scores.get(title, 3)}
                        for index, title in enumerate(titles, start=1)
                    ]
                }
            )
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=content))])

    def transcript(self) -> str:
        """Every call's parameters and prompts, for a golden file."""
        blocks = []
        for call in self.calls:
            blocks.append(
                f"model={call['model']} temperature={call['temperature']} "
                f"response_format={json.dumps(call['response_format'])}\n"
                f"--- system\n{call['messages'][0]['content']}\n"
                f"--- user\n{call['messages'][1]['content']}"
            )
        return "\n=====\n".join(blocks) + "\n"


def frozen_datetime(now_fn):
    """A datetime subclass whose now() is now_fn() -- patched over a
    module's `datetime` name so its wall clock is deterministic."""

    class _FrozenDatetime(datetime):
        @classmethod
        def now(cls, tz=None):
            return now_fn()

    return _FrozenDatetime


def ticking_clock(start: datetime):
    """now() for event timestamps: strictly increasing by 1 microsecond,
    so event order never depends on the machine's clock resolution."""
    state = {"t": start}

    def now():
        state["t"] += timedelta(microseconds=1)
        return state["t"]

    return now


def url_hash(url: str) -> str:
    return hashlib.sha256(url.encode("utf-8")).hexdigest()[:16]


def seed_tony_data(data: Path) -> None:
    """Write state.json (seed keyed by URL -> keyed by URL hash, as the
    agent stores it), pending.json and status.json into data."""
    data.mkdir(parents=True, exist_ok=True)
    seed_state = load_json(TONY / "seed_state.json")
    state = {url_hash(url): entry for url, entry in seed_state.items()}
    (data / "state.json").write_text(json.dumps(state, indent=2, sort_keys=True), encoding="utf-8")
    (data / "pending.json").write_text((TONY / "seed_pending.json").read_text(encoding="utf-8"), encoding="utf-8")
    (data / "status.json").write_text((TONY / "seed_status.json").read_text(encoding="utf-8"), encoding="utf-8")


class RefusingFetcher:
    """The fetcher for runs with no feed fixtures: a fetch is a test bug,
    not a request to the live web."""

    def get(self, url: str):
        raise AssertionError(f"unexpected fetch {url}")


class TonyHarness:
    """One Tony run on fixed inputs: seeded data dir, fake network, fixed
    clock. Only run_real/run_preview/run_dry change as the engine is
    refactored; the inputs they feed must stay identical."""

    def __init__(self, data: Path, monkeypatch: pytest.MonkeyPatch):
        from agent import deliver, events, summarize

        self.data = data
        seed_tony_data(data)
        self.http = FakeHttp(load_json(TONY / "hn.json"), load_json(TONY / "github.json"), load_json(TONY / "decisions.json"))
        self.llm = FakeDeepSeek(load_json(TONY / "scores.json"))
        monkeypatch.setattr(requests, "get", self.http.get)
        monkeypatch.setattr(requests, "post", self.http.post)
        monkeypatch.setattr(summarize, "OpenAI", self.llm)
        monkeypatch.setattr(deliver.time, "sleep", lambda seconds: None)
        monkeypatch.setattr(events, "datetime", frozen_datetime(ticking_clock(FROZEN_NOW)))
        monkeypatch.setenv("DEEPSEEK_API_KEY", "test-deepseek-key")
        monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "test-telegram-token")
        monkeypatch.delenv("GITHUB_TOKEN", raising=False)

    def _run_args(self):
        from agent import engine
        from agent.preset import load_preset

        preset = load_preset(AGENT_DIR / "presets" / "tony.yaml")
        # The goldens pin Tony's HN and GitHub inputs; tony.yaml's RSS feeds
        # have no fixtures here, so they're left out (RSS has its own tests:
        # test_rss.py, test_feed_path.py, the demo goldens).
        preset = replace(preset, feeds=(), topics=tuple(replace(topic, feeds=()) for topic in preset.topics))
        paths = DataPaths(self.data)
        adapters = replace(engine.live_adapters(preset, paths), fetcher=RefusingFetcher())
        return preset, paths, FROZEN_NOW, adapters

    def run_real(self) -> None:
        from agent import engine

        engine.run_real(*self._run_args())

    def run_preview(self) -> None:
        from agent import engine

        engine.run_preview(*self._run_args())

    def run_dry(self) -> None:
        from agent import engine

        engine.run_dry(*self._run_args())

    def read(self, relative: str) -> str:
        return (self.data / relative).read_text(encoding="utf-8")

    def normalize(self, text: str) -> str:
        return text.replace(str(self.data), "<DATA>").replace("\\", "/")


@pytest.fixture
def tony(tmp_path, monkeypatch) -> TonyHarness:
    return TonyHarness(tmp_path / "data", monkeypatch)


@pytest.fixture
def no_network(monkeypatch):
    """Any HTTP request or DNS lookup fails the test."""

    def refuse(*args, **kwargs):
        raise AssertionError("network access in an offline run")

    monkeypatch.setattr(requests, "get", refuse)
    monkeypatch.setattr(requests, "post", refuse)
    monkeypatch.setattr(requests.Session, "get", refuse)
    monkeypatch.setattr(socket, "getaddrinfo", refuse)
