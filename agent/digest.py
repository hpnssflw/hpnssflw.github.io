"""Assemble the pending queue into Telegram-ready HTML messages
(parse_mode=HTML). Returns one or more messages, each under Telegram's
4096-character limit: tries to fit everything in one message with a single
header; if that's too large, splits by topic (one header per message with
topic's items); if a single topic still exceeds the limit, further splits
that topic into multiple chunks (one per-topic header repeated as needed)."""

from __future__ import annotations

from dataclasses import dataclass
from html import escape

from agent.pending import PendingItem

MESSAGE_LIMIT = 4096

# "<title> — <count>" in the preset's language.
COUNT_PHRASES = {
    "en": lambda total: f"{total} item{'' if total == 1 else 's'}",
    "ru": lambda total: f"материалов: {total}",
}


@dataclass(frozen=True)
class StoryBlock:
    """A story with two or more reports, as the digest renders it under its
    linked title: each fact followed by links to the reports it cites (or
    the summary when there are no facts), then who reported first.
    agent/stories.py builds it."""

    facts: tuple[tuple[str, tuple[tuple[int, str], ...]], ...]  # (text, ((n, url), ...))
    first: str | None


def build(
    items_by_topic: dict[str, list[PendingItem]],
    title: str = "Research digest",
    language: str = "en",
    stories: dict[str, StoryBlock] | None = None,
) -> list[str]:
    """Return one or more parse_mode=HTML message bodies, each under
    Telegram's per-message character limit."""
    stories = stories or {}
    total = sum(len(items) for items in items_by_topic.values())
    header = f"<b>{escape(title)} — {COUNT_PHRASES[language](total)}</b>"

    # Render all topics, splitting large topics if needed
    topic_blocks = []
    for name, items in items_by_topic.items():
        rendered = _render_topic(name, items, stories)
        # If a single topic is too large, split it into smaller pieces
        if len(rendered) > MESSAGE_LIMIT:
            topic_blocks.extend(_split_large_topic(name, items, stories))
        else:
            topic_blocks.append(rendered)

    # Try to combine with header
    combined = "\n\n".join([header, *topic_blocks])
    if len(combined) <= MESSAGE_LIMIT:
        return [combined]

    # Fallback: one topic block per message (with header on first)
    return [header, *topic_blocks]


def _split_large_topic(name: str, items: list[PendingItem], stories: dict[str, StoryBlock]) -> list[str]:
    """Split a large topic into multiple message-sized chunks. Each chunk
    respects the MESSAGE_LIMIT, except for unavoidable cases where a single
    item's rendered size (with topic header) exceeds the limit — in that case,
    the oversized item gets its own chunk (best effort)."""
    chunks = []
    current_items = []
    current_size = 0
    topic_header_size = len(f"<b>{escape(name)}</b>\n")

    for item in items:
        # +1 accounts for the newline joining this item's rendered block to
        # whatever follows it in the chunk (see _render_topic's "\n".join);
        # _render_item's own return value already has one internal "\n"
        # between its bullet and summary lines.
        item_size = len(_render_item(item, stories.get(item.url))) + 1

        # If adding this item would exceed limit AND we already have items, flush current chunk
        # (This prevents bundling normal items with oversized ones to exceed the limit)
        if current_items and current_size + item_size + topic_header_size > MESSAGE_LIMIT:
            chunks.append(_render_topic(name, current_items, stories))
            current_items = [item]
            current_size = item_size
        else:
            # Add item to current chunk (handles both normal and single-oversized-item cases)
            current_items.append(item)
            current_size += item_size

    if current_items:
        chunks.append(_render_topic(name, current_items, stories))

    return chunks


def _render_topic(topic_name: str, items: list[PendingItem], stories: dict[str, StoryBlock]) -> str:
    lines = [f"<b>{escape(topic_name)}</b>"]
    for item in items:
        lines.append(_render_item(item, stories.get(item.url)))
    return "\n".join(lines)


def _render_item(item: PendingItem, story: StoryBlock | None = None) -> str:
    """Render one item's block: the linked title, then the escaped summary
    -- or, for a story, its facts with links to the reports they cite (the
    summary when it has none) and who reported first. Shared by
    _render_topic (actual output) and _split_large_topic (size estimate for
    chunking) so the two can't drift apart."""
    url = escape(item.url, quote=True)
    head = f'• <a href="{url}">{escape(item.title)}</a>'
    if story is None:
        return f"{head}\n{escape(item.summary)}"
    lines = [head]
    if story.facts:
        for text, refs in story.facts:
            links = "".join(f'<a href="{escape(ref_url, quote=True)}">[{n}]</a>' for n, ref_url in refs)
            lines.append(f"{escape(text)} {links}")
    else:
        lines.append(escape(item.summary))
    if story.first:
        lines.append(escape(story.first))
    return "\n".join(lines)
