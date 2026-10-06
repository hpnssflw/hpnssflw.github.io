# Adapted from Horizon (https://github.com/Thysrael/Horizon), src/scrapers/rss.py
# at commit 74a70a2. MIT License, Copyright (c) 2026 Thysrael -- see
# agent/THIRD_PARTY_NOTICES.md. Changes: synchronous, through the engine's
# fetcher; an entry without a date is dropped as `undated` and one without
# an http(s) link as `no_link` (Horizon skips the first and invents a URL
# for the second); text prefers the full `content` over the summary and is
# stripped of HTML; a feed that can't be fetched or parsed raises instead
# of being logged and skipped; no ${ENV} URL substitution, tags or author.
"""RSS/Atom connector: one feed from a preset -> Items. Feeds under the
preset's `sources.rss` give items with topic None (classification assigns
one); feeds under a topic give that topic's items."""

from __future__ import annotations

import calendar
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from html.parser import HTMLParser
from urllib.parse import urlsplit

import feedparser

from agent.item import Item
from agent.sources.base import Drop, FeedConfig

TEXT_MAX_CHARS = 2000
DATE_FIELDS = ("published", "updated", "created")
BLOCK_TAGS = {"p", "br", "div", "li", "ul", "ol", "tr", "td", "blockquote", "h1", "h2", "h3", "h4", "h5", "h6"}
SKIPPED_TAGS = {"script", "style"}


class FeedError(Exception):
    """The fetched document isn't a feed feedparser can read."""


def collect_feed(feed: FeedConfig, topic: str | None, fetcher) -> tuple[list[Item], list[Drop]]:
    """Fetch and parse one feed. Raises agent.fetch.FetchError or FeedError
    when the feed as a whole fails; the caller records the failure and
    carries on with the other feeds."""
    fetched = fetcher.get(feed.url)
    parsed = feedparser.parse(fetched.content)
    # A well-formed HTML page parses without complaint but has no feed
    # version; an empty feed has a version and no entries, which is fine.
    if not parsed.entries and (parsed.bozo or not parsed.get("version")):
        raise FeedError(f"{feed.id}: not a readable feed")

    items: list[Item] = []
    drops: list[Drop] = []
    for entry in parsed.entries:
        title = clean_html(entry.get("title", "")) or "(untitled)"
        url = entry.get("link")
        detail = {"source": "rss", "feed": feed.id}
        if not _is_http(url):
            drops.append(Drop(url="", title=title, reason="no_link", detail=detail))
            continue
        published_at = _published_at(entry)
        if published_at is None:
            drops.append(Drop(url=url, title=title, reason="undated", detail=detail))
            continue
        items.append(
            Item(
                url=url,
                title=title,
                kind="rss",
                source_id=feed.id,
                source_name=feed.name,
                topic=topic,
                published_at=published_at,
                score=None,
                text=_entry_text(entry),
            )
        )
    return items, drops


def _is_http(url: str | None) -> bool:
    """Only http(s) links become items: feed content is third-party, and a
    javascript: or file: link would reach the outbox and run-result.json
    as a live link."""
    if not url:
        return False
    try:
        return urlsplit(url).scheme.lower() in ("http", "https")
    except ValueError:
        return False


def _published_at(entry) -> datetime | None:
    for field in DATE_FIELDS:
        structured = entry.get(f"{field}_parsed")
        if structured:
            return datetime.fromtimestamp(calendar.timegm(structured), tz=timezone.utc)
        raw = entry.get(field)
        if raw:
            try:
                parsed = parsedate_to_datetime(raw)
            except (TypeError, ValueError):
                continue
            return parsed.astimezone(timezone.utc) if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    return None


def _entry_text(entry) -> str | None:
    content = entry.get("content")
    raw = content[0].get("value", "") if content else (entry.get("summary") or entry.get("description") or "")
    text = clean_html(raw)[:TEXT_MAX_CHARS]
    return text or None


class _TextExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self._skipping = 0

    def handle_starttag(self, tag, attrs) -> None:
        if tag in SKIPPED_TAGS:
            self._skipping += 1
        elif tag in BLOCK_TAGS:
            self.parts.append(" ")

    def handle_endtag(self, tag) -> None:
        if tag in SKIPPED_TAGS:
            self._skipping = max(0, self._skipping - 1)
        elif tag in BLOCK_TAGS:
            self.parts.append(" ")

    def handle_data(self, data) -> None:
        if not self._skipping:
            self.parts.append(data)


def clean_html(html: str) -> str:
    """Text of an HTML fragment: tags and script/style removed, entities
    decoded, whitespace collapsed."""
    parser = _TextExtractor()
    parser.feed(html)
    parser.close()
    return " ".join("".join(parser.parts).split())
