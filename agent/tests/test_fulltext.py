from dataclasses import replace

from agent.sources import fulltext
from agent.tests.conftest import make_item
from agent.tests.test_rss import FakeFetcher

ARTICLE = """<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><title>Прорыв трубы на улице Садовой</title></head>
<body>
<header><nav><a href="/">Главная</a> <a href="/news">Новости</a> <a href="/contacts">Контакты</a></nav></header>
<main><article>
<h1>Прорыв трубы на улице Садовой оставил без воды три квартала</h1>
<p>В ночь на понедельник на улице Садовой произошёл прорыв магистрального водопровода. Без холодной воды остались жители трёх кварталов, около четырёх тысяч человек.</p>
<p>Аварийные бригады водоканала прибыли на место через сорок минут. По словам диспетчера, повреждённый участок трубы был проложен в 1974 году и давно требовал замены.</p>
<p>Подвоз питьевой воды организован к школе № 12 и к поликлинике на Садовой, 18. Водоканал обещает восстановить подачу к вечеру вторника.</p>
<p>В мэрии сообщили, что замена изношенных сетей на Садовой включена в программу ремонта на следующий год.</p>
</article></main>
<footer><p>© Информагентство (пример), 2026. Все права защищены.</p><a href="/privacy">Политика конфиденциальности</a></footer>
</body></html>""".encode("utf-8")

URL = "https://example-agency.ru/news/1"


def test_fetch_text_keeps_the_article_and_drops_the_chrome():
    text = fulltext.fetch_text(URL, FakeFetcher({URL: ARTICLE}))
    assert text.startswith("Прорыв трубы на улице Садовой оставил без воды три квартала В ночь на понедельник")
    assert "восстановить подачу к вечеру вторника" in text
    assert "Главная" not in text and "Все права защищены" not in text
    assert "\n" not in text


def test_fetch_text_returns_none_when_the_page_fails_or_has_no_article():
    assert fulltext.fetch_text(URL, FakeFetcher({})) is None
    assert fulltext.fetch_text(URL, FakeFetcher({URL: b"<html><body></body></html>"})) is None


def test_enrich_touches_only_full_text_feeds_and_counts():
    with_text = replace(make_item(url=URL, kind="rss", topic=None, score=None, text="feed text"), source_id="agency")
    broken = replace(with_text, url="https://example-agency.ru/news/404")
    other_feed = replace(with_text, source_id="city", url="https://example-city.ru/1")
    fetcher = FakeFetcher({URL: ARTICLE})

    items, fetched, failed = fulltext.enrich([with_text, broken, other_feed], {"agency"}, fetcher)

    assert (fetched, failed) == (1, 1)
    assert items[0].text.startswith("Прорыв трубы")
    assert items[1].text == "feed text"
    assert items[2] is other_feed
