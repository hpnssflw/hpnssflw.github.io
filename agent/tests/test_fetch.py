import socket

import pytest
import requests

from agent.fetch import MAX_BYTES, USER_AGENT, FetchError, LiveFetcher, OfflineFetcher
from agent.sources import url_safety
from agent.sources.url_safety import UnsafeURLError

ADDRESSES = {
    "public.example": "93.184.216.34",
    "internal.example": "10.0.0.5",
    "metadata.example": "169.254.169.254",
    "loop.example": "127.0.0.1",
}


@pytest.fixture(autouse=True)
def fake_dns(monkeypatch):
    def getaddrinfo(host, port, type=0, **kwargs):
        if host not in ADDRESSES:
            raise socket.gaierror("unknown host")
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (ADDRESSES[host], port))]

    monkeypatch.setattr(socket, "getaddrinfo", getaddrinfo)


class StreamResponse:
    def __init__(self, url, status_code=200, body=b"", location=None):
        self.url = url
        self.status_code = status_code
        self.headers = {"location": location} if location else {}
        self._body = body
        self.closed = False

    def iter_content(self, chunk_size):
        for start in range(0, len(self._body), chunk_size):
            yield self._body[start : start + chunk_size]

    def raise_for_status(self):
        if self.status_code >= 400:
            raise requests.HTTPError(f"HTTP {self.status_code}", response=self)

    def close(self):
        self.closed = True


class FakeSession:
    def __init__(self, responses):
        self.responses = responses  # url -> StreamResponse
        self.requests = []

    def get(self, url, allow_redirects=True, stream=False, headers=None, timeout=None):
        assert allow_redirects is False and stream is True
        self.requests.append((url, headers, timeout))
        return self.responses[url]


@pytest.mark.parametrize(
    ("url", "message"),
    [
        ("ftp://public.example/x", "must use http or https"),
        ("https://user:pw@public.example/", "embedded credentials"),
        ("http://localhost:8080/", "localhost"),
        ("http://api.localhost/", "localhost"),
        ("http:///nohost", "no hostname"),
        ("http://public.example:99999/", "Invalid URL|out of range"),
        ("http://internal.example/", "non-public address: 10.0.0.5"),
        ("http://metadata.example/latest", "non-public address: 169.254.169.254"),
        ("http://loop.example/", "non-public address: 127.0.0.1"),
        ("http://[::1]/", "non-public address: ::1"),
        ("http://nowhere.example/", "Could not resolve"),
    ],
)
def test_unsafe_urls_are_rejected(url, message):
    with pytest.raises(UnsafeURLError, match=message):
        url_safety.validate_public_http_url(url)


def test_public_url_passes():
    assert url_safety.validate_public_http_url("https://public.example/a") == "https://public.example/a"


def test_redirects_are_checked_on_every_hop():
    session = FakeSession(
        {
            "https://public.example/a": StreamResponse("https://public.example/a", 302, location="/b"),
            "https://public.example/b": StreamResponse("https://public.example/b", 301, location="http://internal.example/admin"),
        }
    )
    with pytest.raises(UnsafeURLError, match="non-public address"):
        url_safety.safe_get(session, "https://public.example/a")
    assert [url for url, _, _ in session.requests] == ["https://public.example/a", "https://public.example/b"]


def test_too_many_redirects():
    session = FakeSession({"https://public.example/a": StreamResponse("https://public.example/a", 302, location="/a")})
    with pytest.raises(UnsafeURLError, match="Too many redirects"):
        url_safety.safe_get(session, "https://public.example/a", max_redirects=2)


def test_live_fetcher_follows_redirects_and_names_itself():
    session = FakeSession(
        {
            "https://public.example/feed": StreamResponse("https://public.example/feed", 302, location="/rss.xml"),
            "https://public.example/rss.xml": StreamResponse("https://public.example/rss.xml", 200, b"<rss/>"),
        }
    )
    fetched = LiveFetcher(session).get("https://public.example/feed")
    assert (fetched.url, fetched.content) == ("https://public.example/rss.xml", b"<rss/>")
    assert all(headers == {"User-Agent": USER_AGENT} and timeout == 10 for _, headers, timeout in session.requests)


@pytest.mark.parametrize(
    ("response", "message"),
    [
        (StreamResponse("https://public.example/big", 200, b"x" * (MAX_BYTES + 1)), "larger than"),
        (StreamResponse("https://public.example/big", 404), "HTTPError 404"),
    ],
)
def test_live_fetcher_errors(response, message):
    response_session = FakeSession({"https://public.example/big": response})
    with pytest.raises(FetchError, match=message):
        LiveFetcher(response_session).get("https://public.example/big")
    assert response.closed


def test_live_fetcher_refuses_unsafe_urls_before_any_request():
    session = FakeSession({})
    with pytest.raises(FetchError, match="non-public address"):
        LiveFetcher(session).get("http://internal.example/")
    assert session.requests == []


def test_offline_fetcher_serves_only_listed_fixtures(tmp_path):
    (tmp_path / "feeds").mkdir()
    (tmp_path / "feeds" / "a.xml").write_bytes(b"<rss/>")
    manifest = tmp_path / "http.yaml"
    manifest.write_text('"https://example-agency.ru/rss": feeds/a.xml\n', encoding="utf-8")
    fetcher = OfflineFetcher(manifest)
    assert fetcher.get("https://example-agency.ru/rss").content == b"<rss/>"
    with pytest.raises(FetchError, match="no fixture for https://example-agency.ru/other"):
        fetcher.get("https://example-agency.ru/other")
