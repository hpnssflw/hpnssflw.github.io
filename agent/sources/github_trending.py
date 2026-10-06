"""GitHub connector. GitHub has no official "trending" API -- the
github.com/trending page is unversioned HTML, not worth scraping -- so
this uses the official Search API: recently created repos carrying one of
the topic's GitHub topics (topic:cli, topic:llm, ...), ranked by stars,
one query per GitHub topic, merged by repo. It used to run one global
"anything new and starred" query for Tooling alone, which let in any
trending repo whatever its subject -- so `topics` is now required."""

from __future__ import annotations

import os
from datetime import datetime, timedelta

import requests

from agent.item import Item
from agent.sources.base import Drop, TopicConfig

SEARCH_URL = "https://api.github.com/search/repositories"
EXCERPT_MAX_CHARS = 280
EXCERPT_MAX_TOPICS = 6
PER_PAGE = 30


def _excerpt(repo: dict) -> str | None:
    """Description plus the repo's own GitHub topics -- the topics tell
    the ranker what a terse or missing description doesn't."""
    description = (repo.get("description") or "").strip()[:EXCERPT_MAX_CHARS]
    repo_topics = (repo.get("topics") or [])[:EXCERPT_MAX_TOPICS]
    topic_text = f"topics: {', '.join(repo_topics)}" if repo_topics else ""
    if description and topic_text:
        return f"{description} · {topic_text}"
    return description or topic_text or None


def collect(topic: TopicConfig, now: datetime) -> tuple[list[Item], list[Drop]]:
    github_config = topic.sources.get("github_trending")
    if github_config is None:
        return [], []
    github_topics = github_config["topics"]  # required: a KeyError is logged by pipeline.process_topic as "collect failed"
    min_stars = github_config.get("min_stars", 0)
    cutoff = (now - timedelta(days=topic.max_age_days)).date().isoformat()

    headers = {"Accept": "application/vnd.github+json"}
    token = os.environ.get("GITHUB_TOKEN")
    if token:
        headers["Authorization"] = f"Bearer {token}"

    repos_by_name: dict[str, dict] = {}
    for github_topic in github_topics:
        params = {
            "q": f"topic:{github_topic} created:>{cutoff} stars:>={min_stars}",
            "sort": "stars",
            "order": "desc",
            "per_page": PER_PAGE,
        }
        response = requests.get(SEARCH_URL, params=params, headers=headers, timeout=10)
        response.raise_for_status()
        for repo in response.json()["items"]:
            repos_by_name[repo["full_name"]] = repo

    candidates: list[Item] = []
    drops: list[Drop] = []
    for repo in repos_by_name.values():
        url = repo["html_url"]
        title = repo["full_name"]
        created_at = repo.get("created_at")
        if created_at is None:
            # GitHub always populates created_at in practice; this branch
            # exists so the connector never invents a date rather than
            # because it's expected to fire.
            drops.append(
                Drop(url=url, title=title, reason="undated", detail={"source": "github"})
            )
            continue
        candidates.append(
            Item(
                url=url,
                title=title,
                kind="github",
                source_id="github_trending",
                source_name="GitHub",
                topic=topic.slug,
                published_at=datetime.fromisoformat(created_at.replace("Z", "+00:00")),
                score=repo.get("stargazers_count"),
                text=_excerpt(repo),
            )
        )

    return candidates, drops
