from agent import digest
from agent.pending import PendingItem


def _pending(title, topic_name="Tooling", summary="Summary & more.", url="https://example.com/?a=1&b=2"):
    return PendingItem(
        url=url,
        title=title,
        source="hn",
        topic="tooling",
        topic_name=topic_name,
        summary=summary,
        score=7,
        pending_since="2026-10-06T00:00:00+00:00",
    )


def test_one_message_with_header_topics_and_escaped_items():
    messages = digest.build({"Tooling": [_pending("<Fast> grep")], "Web Products": [_pending("Charts", "Web Products")]})
    assert messages == [
        "<b>Research digest — 2 items</b>\n\n"
        "<b>Tooling</b>\n"
        '• <a href="https://example.com/?a=1&amp;b=2">&lt;Fast&gt; grep</a>\n'
        "Summary &amp; more.\n\n"
        "<b>Web Products</b>\n"
        '• <a href="https://example.com/?a=1&amp;b=2">Charts</a>\n'
        "Summary &amp; more."
    ]


def test_single_item_header_is_singular():
    assert digest.build({"Tooling": [_pending("One")]})[0].startswith("<b>Research digest — 1 item</b>")


def test_oversized_digest_splits_under_the_limit():
    items = [_pending(f"Item {n}", summary="x" * 300) for n in range(40)]
    messages = digest.build({"Tooling": items})
    assert len(messages) > 1
    assert messages[0] == "<b>Research digest — 40 items</b>"
    assert all(len(message) <= digest.MESSAGE_LIMIT for message in messages)
    assert sum(message.count("<a href") for message in messages) == 40
