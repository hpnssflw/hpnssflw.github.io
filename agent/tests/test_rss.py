from datetime import datetime, timezone

import pytest

from agent.fetch import FetchError, Fetched
from agent.item import Item
from agent.sources import rss
from agent.sources.base import FeedConfig

FEED = FeedConfig(id="agency", name="Агентство (пример)", url="https://example-agency.ru/rss", full_text=True)

RSS2 = """<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
<channel><title>Агентство (пример)</title><link>https://example-agency.ru/</link>
<item><title>Прорыв трубы на Садовой</title><link>https://example-agency.ru/news/1</link>
<pubDate>Mon, 06 Oct 2026 06:30:00 +0300</pubDate>
<description>&lt;p&gt;Без воды &lt;b&gt;три квартала&lt;/b&gt;.&lt;/p&gt;</description>
<content:encoded><![CDATA[<p>Полный текст: без воды остались <i>три</i> квартала.</p><p>Вода будет к вечеру.</p>]]></content:encoded></item>
<item><title>Только описание</title><link>https://example-agency.ru/news/3</link>
<pubDate>Mon, 06 Oct 2026 07:30:00 +0300</pubDate><description>&lt;p&gt;Коротко &amp;amp; ясно&lt;/p&gt;</description></item>
<item><title>Без даты</title><link>https://example-agency.ru/news/2</link><description>нет даты</description></item>
<item><title>Без ссылки</title><pubDate>Mon, 06 Oct 2026 07:00:00 +0300</pubDate></item>
</channel></rss>"""

ATOM = """<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom"><title>Министерство (пример)</title>
<entry><title>Приказ о тарифах</title><link href="https://example-ministry.ru/docs/7"/><id>urn:7</id>
<updated>2026-10-05T15:00:00Z</updated><summary type="html">&lt;p&gt;Тарифы&lt;/p&gt;</summary></entry>
</feed>"""


class FakeFetcher:
    def __init__(self, documents: dict[str, bytes]):
        self.documents = documents

    def get(self, url):
        if url not in self.documents:
            raise FetchError(f"no fixture for {url}")
        return Fetched(url=url, content=self.documents[url])


def test_rss2_items_prefer_full_content_and_drop_undated_and_linkless():
    items, drops = rss.collect_feed(FEED, None, FakeFetcher({FEED.url: RSS2.encode("utf-8")}))
    assert items == [
        Item(
            url="https://example-agency.ru/news/1",
            title="Прорыв трубы на Садовой",
            kind="rss",
            source_id="agency",
            source_name="Агентство (пример)",
            topic=None,
            published_at=datetime(2026, 10, 6, 3, 30, tzinfo=timezone.utc),
            score=None,
            text="Полный текст: без воды остались три квартала. Вода будет к вечеру.",
        ),
        Item(
            url="https://example-agency.ru/news/3",
            title="Только описание",
            kind="rss",
            source_id="agency",
            source_name="Агентство (пример)",
            topic=None,
            published_at=datetime(2026, 10, 6, 4, 30, tzinfo=timezone.utc),
            score=None,
            text="Коротко & ясно",
        ),
    ]
    assert [(d.url, d.title, d.reason, d.detail) for d in drops] == [
        ("https://example-agency.ru/news/2", "Без даты", "undated", {"source": "rss", "feed": "agency"}),
        ("", "Без ссылки", "no_link", {"source": "rss", "feed": "agency"}),
    ]


def test_atom_feed_under_a_topic():
    feed = FeedConfig(id="ministry", name="Министерство", url="https://example-ministry.ru/atom")
    items, drops = rss.collect_feed(feed, "power", FakeFetcher({feed.url: ATOM.encode("utf-8")}))
    assert drops == []
    assert [(i.url, i.topic, i.published_at, i.text) for i in items] == [
        ("https://example-ministry.ru/docs/7", "power", datetime(2026, 10, 5, 15, 0, tzinfo=timezone.utc), "Тарифы")
    ]


def test_declared_encoding_is_honored():
    xml = (
        '<?xml version="1.0" encoding="windows-1251"?><rss version="2.0"><channel><title>Город</title>'
        "<item><title>Ремонт моста</title><link>https://example-city.ru/n/5</link>"
        "<pubDate>Sun, 05 Oct 2026 10:00:00 GMT</pubDate><description>Мост закроют</description></item>"
        "</channel></rss>"
    )
    feed = FeedConfig(id="city", name="Город", url="https://example-city.ru/rss")
    items, _ = rss.collect_feed(feed, None, FakeFetcher({feed.url: xml.encode("cp1251")}))
    assert [(i.title, i.text) for i in items] == [("Ремонт моста", "Мост закроют")]


def test_long_text_is_cut():
    xml = RSS2.replace("Только описание</title>", "Длинный</title>").replace(
        "&lt;p&gt;Коротко &amp;amp; ясно&lt;/p&gt;", "слово " * 600
    )
    items, _ = rss.collect_feed(FEED, None, FakeFetcher({FEED.url: xml.encode("utf-8")}))
    assert len(items[1].text) == rss.TEXT_MAX_CHARS


def test_a_page_that_is_not_a_feed_raises():
    with pytest.raises(rss.FeedError, match="agency: not a readable feed"):
        rss.collect_feed(FEED, None, FakeFetcher({FEED.url: b"<html><body>404</body></html>"}))


def test_an_empty_feed_is_not_an_error():
    empty = b'<?xml version="1.0"?><rss version="2.0"><channel><title>x</title></channel></rss>'
    assert rss.collect_feed(FEED, None, FakeFetcher({FEED.url: empty})) == ([], [])


def test_fetch_errors_propagate():
    with pytest.raises(FetchError):
        rss.collect_feed(FEED, None, FakeFetcher({}))


def test_clean_html():
    assert rss.clean_html("<p>a&nbsp;b</p><script>x()</script><style>p{}</style><ul><li>c</li><li>d</li></ul>") == "a b c d"
