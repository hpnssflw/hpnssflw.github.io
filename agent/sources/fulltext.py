# Adapted from Horizon (https://github.com/Thysrael/Horizon),
# src/extractors/trafilatura.py at commit 74a70a2. MIT License, Copyright
# (c) 2026 Thysrael -- see agent/THIRD_PARTY_NOTICES.md. Changes:
# synchronous, through the engine's fetcher (which holds the SSRF guard and
# the size cap); the text comes back whitespace-collapsed and cut to
# TEXT_MAX_CHARS; trafilatura's default settings, as Horizon's defaults.
"""Full text of article pages, for feeds marked `full_text: true`. Any
failure keeps the item's feed text: full text is an improvement, never a
reason to lose an item."""

from __future__ import annotations

from dataclasses import replace

from agent.item import Item
from agent.sources.rss import TEXT_MAX_CHARS


def fetch_text(url: str, fetcher) -> str | None:
    try:
        import trafilatura  # imported here: runs without full-text feeds (Tony's) never load it
    except ImportError:
        print("trafilatura is not installed; keeping feed text (pip install -r agent/requirements.txt)")
        return None
    try:
        fetched = fetcher.get(url)
    except Exception:  # noqa: BLE001 — FetchError or anything else: the item keeps its feed text
        return None
    try:
        text = trafilatura.extract(fetched.content)
    except Exception:  # noqa: BLE001 — a page trafilatura can't handle keeps its feed text
        return None
    if not text:
        return None
    return " ".join(text.split())[:TEXT_MAX_CHARS] or None


def enrich(items: list[Item], full_text_feeds: set[str], fetcher) -> tuple[list[Item], int, int]:
    """Swap in each article's full text for items from `full_text_feeds`
    (feed ids). Returns (items, fetched, failed)."""
    enriched: list[Item] = []
    fetched = failed = 0
    for item in items:
        if item.source_id not in full_text_feeds:
            enriched.append(item)
            continue
        text = fetch_text(item.url, fetcher)
        if text is None:
            failed += 1
            enriched.append(item)
        else:
            fetched += 1
            enriched.append(replace(item, text=text))
    return enriched, fetched, failed
