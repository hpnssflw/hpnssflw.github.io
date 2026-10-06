"""The fetchers RSS feeds and full-text articles are read through.
LiveFetcher goes to the network: an honest User-Agent, a timeout, a 2 MB
cap and the SSRF guard on every redirect hop. OfflineFetcher serves a
preset's fixture files (`offline.http`) and refuses any other URL, so an
--offline run can't reach the network by accident."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import requests
import yaml

from agent.sources import url_safety

USER_AGENT = "TonyScraponi/1.0 (+https://hpnssflw.github.io/researcher/agent/)"
TIMEOUT_SECONDS = 10
MAX_BYTES = 2 * 1024 * 1024
CHUNK_BYTES = 64 * 1024


class FetchError(Exception):
    """A URL couldn't be fetched: network error, HTTP error, unsafe
    destination, too large, or (offline) no fixture."""


@dataclass(frozen=True)
class Fetched:
    url: str  # after redirects
    content: bytes


class LiveFetcher:
    def __init__(self, session: requests.Session | None = None) -> None:
        self.session = session or requests.Session()

    def get(self, url: str) -> Fetched:
        try:
            response = url_safety.safe_get(
                self.session, url, headers={"User-Agent": USER_AGENT}, timeout=TIMEOUT_SECONDS
            )
        except url_safety.UnsafeURLError as exc:
            raise FetchError(f"{url}: {exc}") from exc
        except requests.RequestException as exc:
            raise FetchError(f"{url}: {type(exc).__name__}") from exc
        try:
            response.raise_for_status()
            content = _read_capped(response)
        except requests.RequestException as exc:
            raise FetchError(f"{url}: {type(exc).__name__} {response.status_code}") from exc
        finally:
            response.close()
        return Fetched(url=response.url, content=content)


def _read_capped(response: requests.Response) -> bytes:
    chunks, size = [], 0
    for chunk in response.iter_content(CHUNK_BYTES):
        size += len(chunk)
        if size > MAX_BYTES:
            raise FetchError(f"{response.url}: larger than {MAX_BYTES} bytes")
        chunks.append(chunk)
    return b"".join(chunks)


class OfflineFetcher:
    """`offline.http` is a YAML mapping of URL -> fixture file, relative
    to the manifest."""

    def __init__(self, manifest: Path) -> None:
        raw = yaml.safe_load(manifest.read_text(encoding="utf-8")) or {}
        if not isinstance(raw, dict):
            raise FetchError(f"{manifest.name}: expected a mapping of url -> file")
        self.files = {url: (manifest.parent / relative).resolve() for url, relative in raw.items()}

    def get(self, url: str) -> Fetched:
        path = self.files.get(url)
        if path is None:
            raise FetchError(f"offline: no fixture for {url}")
        return Fetched(url=url, content=path.read_bytes())
