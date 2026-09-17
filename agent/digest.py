"""Assemble the pending queue into Telegram-ready HTML messages
(parse_mode=HTML). Normally returns a single message for the whole run;
falls back to one message per topic if the combined message would exceed
Telegram's per-message character limit."""

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
    """Split a large topic into multiple message-sized chunks."""
    chunks = []
    current_items = []
    current_size = 0
    topic_header_size = len(f"<b>{escape(name)}</b>\n")

    for item in items:
        # Estimate item size
        url = escape(item.url, quote=True)
        title = escape(item.title)
        summary = escape(item.summary)
        item_size = len(f'• <a href="{url}">{title}</a>') + len(summary) + 2  # +2 for newlines

        if current_size + item_size + topic_header_size > MESSAGE_LIMIT and current_items:
            # Save current chunk
            chunks.append(_render_topic(name, current_items))
            current_items = [item]
            current_size = item_size
        else:
            current_items.append(item)
            current_size += item_size

    if current_items:
        chunks.append(_render_topic(name, current_items))

    return chunks


def _render_topic(topic_name: str, items: list[PendingItem]) -> str:
    lines = [f"<b>{escape(topic_name)}</b>"]
    for item in items:
        url = escape(item.url, quote=True)
        title = escape(item.title)
        lines.append(f'• <a href="{url}">{title}</a>')
        lines.append(escape(item.summary))
    return "\n".join(lines)
