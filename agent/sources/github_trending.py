"""GitHub trending connector. GitHub has no official "trending" API — the
github.com/trending page is unversioned HTML, not worth scraping — so
this uses the official Search API instead: recently created repos with
enough stars, ranked by stars. That's an approximation of "trending"
(newest repos gaining the most traction), not GitHub's own undisclosed
trending algorithm."""

from __future__ import annotations

import os
from datetime import datetime, timedelta

import requests

from agent.sources.base import Candidate, Drop, TopicConfig

SEARCH_URL = "https://api.github.com/search/repositories"
EXCERPT_MAX_CHARS = 280


def collect(topic: TopicConfig, now: datetime) -> tuple[list[Candidate], list[Drop]]:
    github_config = topic.sources.get("github_trending")
    if github_config is None:
        return [], []
    min_stars = github_config.get("min_stars", 0)
    cutoff = (now - timedelta(days=topic.max_age_days)).date().isoformat()

    headers = {"Accept": "application/vnd.github+json"}
    token = os.environ.get("GITHUB_TOKEN")
    if token:
        headers["Authorization"] = f"Bearer {token}"

    params = {
        "q": f"created:>{cutoff} stars:>={min_stars}",
        "sort": "stars",
        "order": "desc",
        "per_page": 30,
    }
    response = requests.get(SEARCH_URL, params=params, headers=headers, timeout=10)
    response.raise_for_status()

    candidates: list[Candidate] = []
    drops: list[Drop] = []
    for repo in response.json()["items"]:
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
        excerpt = repo.get("description")
        if excerpt:
            excerpt = excerpt[:EXCERPT_MAX_CHARS]
        candidates.append(
            Candidate(
                url=url,
                title=title,
                source="github",
                topic=topic.slug,
                published_at=datetime.fromisoformat(created_at.replace("Z", "+00:00")),
                score=repo.get("stargazers_count"),
                excerpt=excerpt,
            )
        )

    return candidates, drops
