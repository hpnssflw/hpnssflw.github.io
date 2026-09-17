"""Assemble the pending queue into Telegram-ready HTML messages
(parse_mode=HTML). Returns one or more messages, each under Telegram's
4096-character limit: tries to fit everything in one message with a single
header; if that's too large, splits by topic (one header per message with
topic's items); if a single topic still exceeds the limit, further splits
that topic into multiple chunks (one per-topic header repeated as needed)."""

from __future__ import annotations

from html import escape

from agent.pending import PendingItem

MESSAGE_LIMIT = 4096


def build(items_by_topic: dict[str, list[PendingItem]]) -> list[str]:
    """Return one or more parse_mode=HTML message bodies, each under
    Telegram's per-message character limit."""
    total = sum(len(items) for items in items_by_topic.values())
    header = f"<b>Research digest — {total} item{'' if total == 1 else 's'}</b>"

    # Render all topics, splitting large topics if needed
    topic_blocks = []
    for name, items in items_by_topic.items():
        rendered = _render_topic(name, items)
        # If a single topic is too large, split it into smaller pieces
        if len(rendered) > MESSAGE_LIMIT:
            topic_blocks.extend(_split_large_topic(name, items))
        else:
            topic_blocks.append(rendered)

    # Try to combine with header
    combined = "\n\n".join([header, *topic_blocks])
    if len(combined) <= MESSAGE_LIMIT:
        return [combined]

    # Fallback: one topic block per message (with header on first)
    return [header, *topic_blocks]


def _split_large_topic(name: str, items: list[PendingItem]) -> list[str]:
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
        item_size = len(_render_item(item)) + 1

        # If adding this item would exceed limit AND we already have items, flush current chunk
        # (This prevents bundling normal items with oversized ones to exceed the limit)
        if current_items and current_size + item_size + topic_header_size > MESSAGE_LIMIT:
            chunks.append(_render_topic(name, current_items))
            current_items = [item]
            current_size = item_size
        else:
            # Add item to current chunk (handles both normal and single-oversized-item cases)
            current_items.append(item)
            current_size += item_size

    if current_items:
        chunks.append(_render_topic(name, current_items))

    return chunks


def _render_topic(topic_name: str, items: list[PendingItem]) -> str:
    lines = [f"<b>{escape(topic_name)}</b>"]
    for item in items:
        lines.append(_render_item(item))
    return "\n".join(lines)


def _render_item(item: PendingItem) -> str:
    """Render one item's bullet+summary block (two lines, joined by \\n):
    the linked title, then the escaped summary. Shared by _render_topic
    (actual output) and _split_large_topic (size estimate for chunking) so
    the two can't drift apart."""
    url = escape(item.url, quote=True)
    title = escape(item.title)
    summary = escape(item.summary)
    return f'• <a href="{url}">{title}</a>\n{summary}'
