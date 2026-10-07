"""Presets: one YAML file describes one client of the engine -- its
sources, topics, reader, LLM, approval and delivery -- validated before
any network call. Tony's is agent/presets/tony.yaml; its optional `data`
section gives it a default data dir (agent/) and status.json.

See docs/superpowers/specs/2026-10-06-content-engine-core-design.md and
docs/superpowers/specs/2026-10-06-preset-switcher-design.md."""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path

import yaml

from agent.sources.base import FeedConfig, TopicConfig

LANGUAGES = ("en", "ru")
SLUG = re.compile(r"^[a-z0-9-]+$")
UTC_OFFSET = re.compile(r"^[+-](0\d|1[0-4]):[0-5]\d$")
NO_OFFLINE_MODE = ("hacker_news", "github_trending")


class PresetError(ValueError):
    """The preset file is missing, malformed, or asks for something the
    engine can't do. The message starts with the key path at fault."""


@dataclass(frozen=True)
class LLMSettings:
    base_url: str
    model: str
    api_key_env: str  # name of the environment variable, never the key


@dataclass(frozen=True)
class TelegramChannel:
    handle: str
    name: str


@dataclass(frozen=True)
class TelegramSection:
    """`sources.telegram_public`: accepted and shown as "coming soon";
    the engine never reads Telegram (decision 1, 2026-10-06)."""

    enabled: bool  # always False -- True is a PresetError
    channels: tuple[TelegramChannel, ...]


@dataclass(frozen=True)
class ApprovalConfig:
    type: str  # inbox | file
    expire_days: int
    decisions_url: str | None = None  # inbox
    token_env: str | None = None  # inbox
    path: Path | None = None  # file


@dataclass(frozen=True)
class DeliveryTarget:
    type: str  # telegram | file
    title: str  # digest header, e.g. "Research digest"
    cadence_hours: int
    chat: str | None = None  # telegram
    bot_token_env: str | None = None  # telegram


@dataclass(frozen=True)
class OfflineConfig:
    now: datetime  # the clock of an --offline run
    http: Path  # YAML manifest: url -> fixture file
    llm: Path  # JSON verdicts: url -> {topic, score, summary}
    stories: Path | None = None  # JSON: the LLM merge's groups and facts answers (presets with stories)


@dataclass(frozen=True)
class StoriesConfig:
    """`stories:` -- reports of one event across the preset's feeds become
    one story (docs/superpowers/specs/2026-10-07-content-engine-stories-design.md)."""

    window_hours: int = 24  # a story stays matchable this long after its newest report
    timezone: str = "+00:00"  # fixed UTC offset for the "first" line's clock times
    near_text: float = 0.6  # word-shingle overlap that counts as the same text
    llm_merge: bool = True  # one LLM merge per run over what no cheap signal matched
    max_facts: int = 3

    @property
    def tzinfo(self) -> timezone:
        sign = 1 if self.timezone[0] == "+" else -1
        return timezone(sign * timedelta(hours=int(self.timezone[1:3]), minutes=int(self.timezone[4:6])))


@dataclass(frozen=True)
class Preset:
    slug: str
    name: str
    language: str  # en | ru
    path: Path  # the preset file
    max_age_days: int  # recency window for the preset's own feeds
    topics: tuple[TopicConfig, ...]
    feeds: tuple[FeedConfig, ...]  # preset-scope feeds: items are classified into topics
    telegram: TelegramSection | None
    reader: str
    llm: LLMSettings
    approval: ApprovalConfig
    delivery: DeliveryTarget
    offline: OfflineConfig | None
    status_json: bool  # data.status_json: also write status.json (Tony's site widgets)
    default_data_dir: Path | None  # data.default_dir, resolved; None: --data-dir is required
    stories: StoriesConfig | None = None  # None: every report is its own queue entry


def load_preset(path: Path) -> Preset:
    path = Path(path).resolve()
    if not path.is_file():
        raise PresetError(f"{path}: no such preset file")
    try:
        raw = yaml.safe_load(path.read_text(encoding="utf-8"))
    except yaml.YAMLError as exc:
        raise PresetError(f"{path}: not valid YAML: {exc}") from None
    if not isinstance(raw, dict):
        raise PresetError(f"{path}: a preset must be a mapping")
    return _load_self_contained(path, raw)


def require_offline(preset: Preset) -> None:
    """--offline must not reach the network: fixtures for feeds and the
    LLM, file approval and delivery, and no HN/GitHub source."""
    if preset.offline is None:
        raise PresetError(f"{preset.slug}: --offline needs an `offline` section")
    if preset.approval.type != "file":
        raise PresetError("approval.type: --offline needs `file`")
    if preset.delivery.type != "file":
        raise PresetError("delivery.type: --offline needs `file`")
    if preset.stories is not None and preset.offline.stories is None:
        raise PresetError("offline.stories: required for a preset with stories")
    for index, topic in enumerate(preset.topics):
        for source in NO_OFFLINE_MODE:
            if source in topic.sources:
                raise PresetError(f"topics[{index}].sources.{source}: has no offline mode")


# --- self-contained ----------------------------------------------------------


def _load_self_contained(path: Path, raw: dict) -> Preset:
    _fields(raw, "", ("preset", "defaults", "topics", "ranking", "llm", "approval", "delivery"), ("sources", "offline", "data", "stories"))
    slug, name, language = _identity(raw["preset"])
    defaults = _defaults(raw["defaults"], "defaults")
    feeds, telegram = _preset_sources(raw.get("sources", {}))
    topics = _topics(raw["topics"], defaults)
    _check_unique_feed_ids(feeds, topics)
    stories = _stories(raw["stories"], topics, feeds) if "stories" in raw else None
    ranking = _fields(raw["ranking"], "ranking", ("reader",))
    llm = _fields(raw["llm"], "llm", ("base_url", "model", "api_key_env"))
    data = _data(raw.get("data", {}), path.parent)
    return Preset(
        slug=slug,
        name=name,
        language=language,
        path=path,
        max_age_days=defaults["max_age_days"],
        topics=topics,
        feeds=feeds,
        telegram=telegram,
        reader=_str(ranking, "reader", "ranking").strip(),
        llm=LLMSettings(
            base_url=_str(llm, "base_url", "llm"),
            model=_str(llm, "model", "llm"),
            api_key_env=_str(llm, "api_key_env", "llm"),
        ),
        approval=_approval(raw["approval"], path.parent),
        delivery=_delivery(raw["delivery"]),
        offline=_offline(raw["offline"], path.parent) if "offline" in raw else None,
        status_json=data["status_json"],
        default_data_dir=data["default_dir"],
        stories=stories,
    )


def _identity(raw) -> tuple[str, str, str]:
    ident = _fields(raw, "preset", ("slug", "name", "language"))
    language = _str(ident, "language", "preset")
    if language not in LANGUAGES:
        raise PresetError(f"preset.language: one of {', '.join(LANGUAGES)}")
    return _slug(ident, "slug", "preset"), _str(ident, "name", "preset"), language


def _defaults(raw, where: str) -> dict:
    section = _fields(raw, where, ("max_age_days", "min_relevance", "max_items_per_day"), ("attention",))
    return {
        "max_age_days": _int(section, "max_age_days", where, minimum=1),
        "min_relevance": _relevance(section, where),
        "max_items_per_day": _int(section, "max_items_per_day", where, minimum=0),
        **_attention(section.get("attention"), f"{where}.attention", {"enabled": False, "min_score_gain": 0}),
    }


def _attention(raw, where: str, inherited: dict) -> dict:
    if raw is None:
        return {"attention_enabled": inherited["enabled"], "attention_min_score_gain": inherited["min_score_gain"]}
    section = _fields(raw, where, ("enabled",), ("min_score_gain",))
    return {
        "attention_enabled": _bool(section, "enabled", where),
        "attention_min_score_gain": _int(section, "min_score_gain", where, minimum=0) if "min_score_gain" in section else 0,
    }


def _preset_sources(raw) -> tuple[tuple[FeedConfig, ...], TelegramSection | None]:
    section = _fields(raw, "sources", (), ("rss", "telegram_public"))
    feeds = _feeds(section.get("rss", []), "sources.rss")
    telegram = None
    if "telegram_public" in section:
        where = "sources.telegram_public"
        tg = _fields(section["telegram_public"], where, ("enabled",), ("channels",))
        if _bool(tg, "enabled", where):
            raise PresetError(f"{where}.enabled: Telegram sources aren't supported yet")
        channels = []
        for index, channel in enumerate(_list(tg, "channels", where, default=[])):
            entry = _fields(channel, f"{where}.channels[{index}]", ("handle", "name"))
            channels.append(
                TelegramChannel(
                    handle=_str(entry, "handle", f"{where}.channels[{index}]"),
                    name=_str(entry, "name", f"{where}.channels[{index}]"),
                )
            )
        telegram = TelegramSection(enabled=False, channels=tuple(channels))
    return feeds, telegram


def _feeds(raw, where: str) -> tuple[FeedConfig, ...]:
    if not isinstance(raw, list):
        raise PresetError(f"{where}: expected a list")
    feeds = []
    for index, entry in enumerate(raw):
        at = f"{where}[{index}]"
        feed = _fields(entry, at, ("id", "name", "url"), ("full_text",))
        url = _str(feed, "url", at)
        if not url.startswith(("http://", "https://")):
            raise PresetError(f"{at}.url: must start with http:// or https://")
        feeds.append(
            FeedConfig(
                id=_slug(feed, "id", at),
                name=_str(feed, "name", at),
                url=url,
                full_text=_bool(feed, "full_text", at) if "full_text" in feed else False,
            )
        )
    return tuple(feeds)


def _topics(raw, defaults: dict) -> tuple[TopicConfig, ...]:
    if not isinstance(raw, list) or not raw:
        raise PresetError("topics: expected a non-empty list")
    topics, slugs = [], set()
    for index, entry in enumerate(raw):
        at = f"topics[{index}]"
        topic = _fields(
            entry,
            at,
            ("slug", "name", "description", "include", "exclude"),
            ("keywords", "sources", "max_age_days", "min_relevance", "max_items_per_day", "attention"),
        )
        slug = _slug(topic, "slug", at)
        if slug in slugs:
            raise PresetError(f"{at}.slug: duplicate topic {slug!r}")
        slugs.add(slug)
        sources = _fields(topic.get("sources", {}), f"{at}.sources", (), ("hacker_news", "github_trending", "rss"))
        query_sources = {}
        if "hacker_news" in sources:
            hn = _fields(sources["hacker_news"], f"{at}.sources.hacker_news", (), ("min_points",))
            query_sources["hacker_news"] = dict(hn)
        if "github_trending" in sources:
            gh = _fields(sources["github_trending"], f"{at}.sources.github_trending", ("topics",), ("min_stars",))
            query_sources["github_trending"] = dict(gh)
        keywords = _str_list(topic, "keywords", at, default=[])
        if "hacker_news" in query_sources and not keywords:
            raise PresetError(f"{at}.keywords: required with hacker_news")
        attention = _attention(
            topic.get("attention"),
            f"{at}.attention",
            {"enabled": defaults["attention_enabled"], "min_score_gain": defaults["attention_min_score_gain"]},
        )
        topics.append(
            TopicConfig(
                slug=slug,
                name=_str(topic, "name", at),
                description=_str(topic, "description", at).strip(),
                keywords=keywords,
                include=_str_list(topic, "include", at),
                exclude=_str_list(topic, "exclude", at),
                sources=query_sources,
                max_age_days=_int(topic, "max_age_days", at, minimum=1) if "max_age_days" in topic else defaults["max_age_days"],
                min_relevance=_relevance(topic, at) if "min_relevance" in topic else defaults["min_relevance"],
                max_items_per_day=(
                    _int(topic, "max_items_per_day", at, minimum=0)
                    if "max_items_per_day" in topic
                    else defaults["max_items_per_day"]
                ),
                feeds=_feeds(sources.get("rss", []), f"{at}.sources.rss"),
                **attention,
            )
        )
    return tuple(topics)


def _check_unique_feed_ids(feeds: tuple[FeedConfig, ...], topics: tuple[TopicConfig, ...]) -> None:
    seen = set()
    for feed in [*feeds, *(feed for topic in topics for feed in topic.feeds)]:
        if feed.id in seen:
            raise PresetError(f"sources: duplicate feed id {feed.id!r}")
        seen.add(feed.id)


def _approval(raw, base: Path) -> ApprovalConfig:
    kind = raw.get("type") if isinstance(raw, dict) else None
    if kind == "inbox":
        section = _fields(raw, "approval", ("type", "decisions_url", "expire_days", "token_env"))
        return ApprovalConfig(
            type="inbox",
            expire_days=_int(section, "expire_days", "approval", minimum=1),
            decisions_url=_str(section, "decisions_url", "approval"),
            token_env=_str(section, "token_env", "approval"),
        )
    if kind == "file":
        section = _fields(raw, "approval", ("type", "path", "expire_days"))
        return ApprovalConfig(
            type="file",
            expire_days=_int(section, "expire_days", "approval", minimum=1),
            path=_existing_file(section, "path", "approval", base),
        )
    raise PresetError("approval.type: one of inbox, file")


def _delivery(raw) -> DeliveryTarget:
    kind = raw.get("type") if isinstance(raw, dict) else None
    if kind == "telegram":
        section = _fields(raw, "delivery", ("type", "chat", "bot_token_env", "title", "cadence_hours"))
        return DeliveryTarget(
            type="telegram",
            title=_str(section, "title", "delivery"),
            cadence_hours=_int(section, "cadence_hours", "delivery", minimum=1),
            chat=_str(section, "chat", "delivery"),
            bot_token_env=_str(section, "bot_token_env", "delivery"),
        )
    if kind == "file":
        section = _fields(raw, "delivery", ("type", "title", "cadence_hours"))
        return DeliveryTarget(
            type="file",
            title=_str(section, "title", "delivery"),
            cadence_hours=_int(section, "cadence_hours", "delivery", minimum=1),
        )
    raise PresetError("delivery.type: one of telegram, file")


def _offline(raw, base: Path) -> OfflineConfig:
    section = _fields(raw, "offline", ("now", "http", "llm"), ("stories",))
    now = section["now"]
    if isinstance(now, str):
        try:
            now = datetime.fromisoformat(now)
        except ValueError:
            raise PresetError("offline.now: expected an ISO 8601 timestamp") from None
    if not isinstance(now, datetime) or now.tzinfo is None:
        raise PresetError("offline.now: expected an ISO 8601 timestamp with a UTC offset")
    return OfflineConfig(
        now=now,
        http=_existing_file(section, "http", "offline", base),
        llm=_existing_file(section, "llm", "offline", base),
        stories=_existing_file(section, "stories", "offline", base) if "stories" in section else None,
    )


def _data(raw, base: Path) -> dict:
    section = _fields(raw, "data", (), ("default_dir", "status_json"))
    return {
        "default_dir": (base / _str(section, "default_dir", "data")).resolve() if "default_dir" in section else None,
        "status_json": _bool(section, "status_json", "data") if "status_json" in section else False,
    }


def _stories(raw, topics: tuple[TopicConfig, ...], feeds: tuple[FeedConfig, ...]) -> StoriesConfig:
    where = "stories"
    section = _fields(raw, where, (), ("window_hours", "timezone", "near_text", "llm_merge", "max_facts"))
    base = StoriesConfig()
    window_hours = _int(section, "window_hours", where, minimum=1) if "window_hours" in section else base.window_hours
    if window_hours > 720:
        raise PresetError("stories.window_hours: expected 1-720")
    offset = _str(section, "timezone", where) if "timezone" in section else base.timezone
    if not UTC_OFFSET.match(offset):
        raise PresetError('stories.timezone: a UTC offset like "+03:00"')
    near = section.get("near_text", base.near_text)
    if isinstance(near, bool) or not isinstance(near, (int, float)) or not 0 < near <= 1:
        raise PresetError("stories.near_text: expected a number in (0, 1]")
    llm_merge = _bool(section, "llm_merge", where) if "llm_merge" in section else base.llm_merge
    max_facts = _int(section, "max_facts", where, minimum=1) if "max_facts" in section else base.max_facts
    if max_facts > 6:
        raise PresetError("stories.max_facts: expected 1-6")
    for topic in topics:
        if topic.sources or topic.feeds:
            raise PresetError(f"stories: stories group preset feeds only; topic `{topic.slug}` has its own sources")
    if not feeds:
        raise PresetError("stories: stories need preset feeds (sources.rss)")
    return StoriesConfig(window_hours, offset, float(near), llm_merge, max_facts)


# --- field readers -----------------------------------------------------------


def _at(where: str, key: str) -> str:
    return f"{where}.{key}" if where else key


def _fields(raw, where: str, required: tuple[str, ...], optional: tuple[str, ...] = ()) -> dict:
    if not isinstance(raw, dict):
        raise PresetError(f"{where or 'preset file'}: expected a mapping")
    for key in raw:
        if key not in required and key not in optional:
            raise PresetError(f"{_at(where, key)}: unknown key")
    for key in required:
        if key not in raw:
            raise PresetError(f"{_at(where, key)}: required")
    return raw


def _str(raw: dict, key: str, where: str) -> str:
    value = raw[key]
    if not isinstance(value, str) or not value.strip():
        raise PresetError(f"{_at(where, key)}: expected a non-empty string")
    return value


def _slug(raw: dict, key: str, where: str) -> str:
    value = _str(raw, key, where)
    if not SLUG.match(value):
        raise PresetError(f"{_at(where, key)}: lowercase letters, digits and dashes only")
    return value


def _int(raw: dict, key: str, where: str, minimum: int) -> int:
    value = raw[key]
    if isinstance(value, bool) or not isinstance(value, int) or value < minimum:
        raise PresetError(f"{_at(where, key)}: expected an integer >= {minimum}")
    return value


def _relevance(raw: dict, where: str) -> int:
    value = _int(raw, "min_relevance", where, minimum=1)
    if value > 10:
        raise PresetError(f"{_at(where, 'min_relevance')}: expected 1-10")
    return value


def _bool(raw: dict, key: str, where: str) -> bool:
    value = raw[key]
    if not isinstance(value, bool):
        raise PresetError(f"{_at(where, key)}: expected true or false")
    return value


def _list(raw: dict, key: str, where: str, default: list | None = None) -> list:
    if key not in raw and default is not None:
        return list(default)
    value = raw[key]
    if not isinstance(value, list):
        raise PresetError(f"{_at(where, key)}: expected a list")
    return value


def _str_list(raw: dict, key: str, where: str, default: list | None = None) -> list[str]:
    value = _list(raw, key, where, default)
    if not all(isinstance(entry, str) and entry.strip() for entry in value):
        raise PresetError(f"{_at(where, key)}: expected a list of non-empty strings")
    return value


def _existing_file(raw: dict, key: str, where: str, base: Path) -> Path:
    path = (base / _str(raw, key, where)).resolve()
    if not path.is_file():
        raise PresetError(f"{_at(where, key)}: no such file {path}")
    return path
