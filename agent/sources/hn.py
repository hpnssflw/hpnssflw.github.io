"""Hacker News connector — queries Algolia search per topic keyword,
matching story titles only (whole words, no typo tolerance)."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import requests

from agent.item import Item
from agent.sources.base import Drop, TopicConfig

ALGOLIA_SEARCH_URL = "https://hn.algolia.com/api/v1/search"
EXCERPT_MAX_CHARS = 280
HITS_PER_PAGE = 50


def collect(topic: TopicConfig, now: datetime) -> tuple[list[Item], list[Drop]]:
    hn_config = topic.sources.get("hacker_news")
    if hn_config is None:
        return [], []
    min_points = hn_config.get("min_points", 0)
    cutoff_epoch = int((now - timedelta(days=topic.max_age_days)).timestamp())

    hits_by_id: dict[str, dict] = {}
    failures: list[Exception] = []
    for keyword in topic.keywords:
        params = {
            "query": keyword,
            "tags": "story",
            "numericFilters": f"created_at_i>{cutoff_epoch},points>={min_points}",
            # By default Algolia also matches URL, story text and author,
            # with typo tolerance and prefix matching: "MCP" found Google
            # Maps stories and "SEO" found "so"/"Sol". Titles only, whole
            # words, no typos.
            "restrictSearchableAttributes": "title",
            "typoTolerance": "false",
            "queryType": "prefixNone",
            "hitsPerPage": HITS_PER_PAGE,
        }
        try:
            response = requests.get(ALGOLIA_SEARCH_URL, params=params, timeout=10)
            response.raise_for_status()
            hits = response.json()["hits"]
        except (requests.RequestException, ValueError, KeyError) as exc:
            # One failed keyword must not cost the topic its whole HN source.
            print(f"hn keyword '{keyword}' failed for {topic.slug}: {exc}")
            failures.append(exc)
            continue
        for hit in hits:
            hits_by_id[hit["objectID"]] = hit
    if topic.keywords and len(failures) == len(topic.keywords):
        raise failures[-1]  # every keyword failed: let the pipeline log "collect failed"

    candidates: list[Item] = []
    drops: list[Drop] = []
    for object_id, hit in hits_by_id.items():
        url = hit.get("url") or f"https://news.ycombinator.com/item?id={object_id}"
        title = hit.get("title") or "(untitled)"
        created_at_i = hit.get("created_at_i")
        if created_at_i is None:
            # HN Algolia always populates created_at_i in practice; this
            # branch exists so the connector never invents a date rather
            # than because it's expected to fire.
            drops.append(
                Drop(url=url, title=title, reason="undated", detail={"source": "hn"})
            )
            continue
        excerpt = hit.get("story_text")
        if excerpt:
            excerpt = excerpt[:EXCERPT_MAX_CHARS]
        candidates.append(
            Item(
                url=url,
                title=title,
                kind="hn",
                source_id="hacker_news",
                source_name="Hacker News",
                topic=topic.slug,
                published_at=datetime.fromtimestamp(created_at_i, tz=timezone.utc),
                score=hit.get("points"),
                text=excerpt,
            )
        )

    return candidates, drops
