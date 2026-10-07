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


from agent.digest import StoryBlock, build


def _story_item(url, title="Прорыв", summary="Кратко.", topic_name="Происшествия", score=8):
    return PendingItem(url=url, title=title, source="rss", topic="incidents", topic_name=topic_name, summary=summary, score=score, pending_since="2026-10-06T06:00:00+00:00")


def test_story_block_renders_facts_with_report_links_and_the_first_line():
    block = StoryBlock(
        facts=(("Без воды три квартала.", ((1, "https://a/1"), (2, "https://c/1"))), ("Подвоз & вода.", ((3, "https://g/1"),))),
        first="Первым — Агентство, 06:10; через 42 мин — Город",
    )
    [message] = build({"Происшествия": [_story_item("https://a/1")]}, "Сводка", "ru", {"https://a/1": block})
    assert message == (
        "<b>Сводка — материалов: 1</b>\n\n<b>Происшествия</b>\n"
        '• <a href="https://a/1">Прорыв</a>\n'
        'Без воды три квартала. <a href="https://a/1">[1]</a><a href="https://c/1">[2]</a>\n'
        'Подвоз &amp; вода. <a href="https://g/1">[3]</a>\n'
        "Первым — Агентство, 06:10; через 42 мин — Город"
    )


def test_story_block_without_facts_shows_the_summary():
    block = StoryBlock(facts=(), first="Первым — Агентство, 06:10; через 5 мин — Город")
    [message] = build({"T": [_story_item("https://a/1")]}, "S", "ru", {"https://a/1": block})
    assert message.endswith('• <a href="https://a/1">Прорыв</a>\nКратко.\nПервым — Агентство, 06:10; через 5 мин — Город')


def test_items_without_a_story_block_render_as_before():
    items = {"T": [_story_item("https://a/1")]}
    other = {"https://other/1": StoryBlock(facts=(), first="x")}  # a block for another url: never applied here
    assert build(items, "S", "ru", other) == build(items, "S", "ru") == [
        '<b>S — материалов: 1</b>\n\n<b>T</b>\n• <a href="https://a/1">Прорыв</a>\nКратко.'
    ]
