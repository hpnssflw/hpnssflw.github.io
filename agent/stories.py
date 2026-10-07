"""Stories (content engine sub-project B): reports of one event across a
preset's feeds, moderated and delivered as one queue entry. The model and
its store (<data-dir>/stories.json), text fingerprints, and the "who was
first" line. Grouping comes in group_reports below.
See docs/superpowers/specs/2026-10-07-content-engine-stories-design.md."""

from __future__ import annotations

import hashlib
import json
import re
import unicodedata
from dataclasses import asdict, dataclass, field
from datetime import datetime, timedelta, tzinfo
from pathlib import Path

from agent import summarize
from agent.summarize import RankedItem

STORE_VERSION = 1
OPEN = ("waiting", "queued")  # can still take reports
CLOSED = ("approved", "sent", "rejected", "expired")
REPORT_TEXT_CHARS = 2000
TEXT_HASH_MIN_WORDS = 30  # shorter texts are too short to call identical
SHINGLE_WORDS = 400
SHINGLE_MIN = 20  # fewer shingles than this never count as near-identical

_NON_WORD = re.compile(r"[\W_]+")

FIRST_WORDS = {
    "ru": {"first": "Первым — {name}, {time}", "later": "через {gap} — {name}", "same": "в ту же минуту — {name}", "units": ("д", "ч", "мин")},
    "en": {"first": "First — {name}, {time}", "later": "{gap} later — {name}", "same": "same minute — {name}", "units": ("d", "h", "min")},
}


@dataclass
class Report:
    """One source's report of the story's event, as it was when grouped."""

    url: str
    title: str
    kind: str  # rss
    source_id: str
    source_name: str
    published_at: str  # ISO 8601, UTC
    score: int  # classify's relevance
    summary: str  # classify's one-sentence summary
    text: str  # feed or full text, cut to REPORT_TEXT_CHARS
    text_hash: str | None

    @property
    def at(self) -> datetime:
        return datetime.fromisoformat(self.published_at)


@dataclass
class Fact:
    text: str
    urls: list[str]  # the reports it cites; numbered only on output


@dataclass
class Story:
    key: str  # the opener's URL: the queue entry's url and the decision key
    topic: str  # the opener's topic
    status: str  # waiting | queued | approved | sent | rejected | expired
    opened_at: str
    reports: list[Report]
    facts: list[Fact] = field(default_factory=list)
    facts_for: str | None = None  # facts_hash the facts were made for
    flagged: bool = False  # facts were asked for and none passed validation

    @property
    def is_open(self) -> bool:
        return self.status in OPEN

    def opener(self) -> Report:
        return next(r for r in self.reports if r.url == self.key)

    def score(self) -> int:
        return max(r.score for r in self.reports)

    def sources(self) -> set[str]:
        return {r.source_id for r in self.reports}

    def newest(self) -> datetime:
        return max(r.at for r in self.reports)


@dataclass
class StoryStore:
    stories: dict[str, Story]


# --- fingerprints ------------------------------------------------------------


def normalize(text: str) -> str:
    """NFKC, lowercase, ё→е, every run of non-letters/digits -> one space."""
    text = unicodedata.normalize("NFKC", text).lower().replace("ё", "е")
    return _NON_WORD.sub(" ", text).strip()


def text_hash(text: str | None) -> str | None:
    norm = normalize(text or "")
    if len(norm.split()) < TEXT_HASH_MIN_WORDS:
        return None
    return hashlib.sha256(norm.encode("utf-8")).hexdigest()[:16]


def shingles(text: str | None) -> frozenset[tuple[str, str, str]]:
    words = normalize(text or "").split()[:SHINGLE_WORDS]
    return frozenset(zip(words, words[1:], words[2:]))


def overlap(a: frozenset, b: frozenset) -> float:
    """|A∩B| / min(|A|, |B|): also catches a summary that is part of
    another outlet's full text. 0 when either side is too short."""
    if len(a) < SHINGLE_MIN or len(b) < SHINGLE_MIN:
        return 0.0
    return len(a & b) / min(len(a), len(b))


def report_from(ranked: RankedItem) -> Report:
    item = ranked.item
    text = (item.text or "")[:REPORT_TEXT_CHARS]
    return Report(
        url=item.url,
        title=item.title,
        kind=item.kind,
        source_id=item.source_id,
        source_name=item.source_name,
        published_at=item.published_at.isoformat(),
        score=ranked.score,
        summary=ranked.summary,
        text=text,
        text_hash=text_hash(text),
    )


# --- order, clock, the "first" line -----------------------------------------


def feed_order(preset) -> dict[str, int]:
    return {feed.id: index for index, feed in enumerate(preset.feeds)}


def ordered(story: Story, order: dict[str, int]) -> list[Report]:
    """Published order -- the numbering [1..n]; ties by feed order, then URL."""
    return sorted(story.reports, key=lambda r: (r.at, order.get(r.source_id, len(order)), r.url))


def clock(at: datetime, tz: tzinfo, now: datetime | None = None) -> str:
    """HH:MM in tz; "DD.MM HH:MM" when now is given and the date differs."""
    local = at.astimezone(tz)
    text = local.strftime("%H:%M")
    if now is not None and local.date() != now.astimezone(tz).date():
        text = local.strftime("%d.%m ") + text
    return text


def stamp(at: datetime, tz: tzinfo) -> str:
    return at.astimezone(tz).strftime("%d.%m %H:%M")


def _gap(minutes: int, units: tuple[str, str, str]) -> str:
    days, rest = divmod(minutes, 1440)
    hours, mins = divmod(rest, 60)
    if days:
        return f"{days} {units[0]}" + (f" {hours} {units[1]}" if hours else "")
    if hours:
        return f"{hours} {units[1]}" + (f" {mins} {units[2]}" if mins else "")
    return f"{mins} {units[2]}"


def first_line(story: Story, order: dict[str, int], tz: tzinfo, now: datetime, language: str) -> str | None:
    """"Первым — A, 06:10; через 42 мин — B": one entry per source at its
    earliest report, gaps counted from the first. None for one report."""
    if len(story.reports) < 2:
        return None
    words = FIRST_WORDS[language]
    firsts: list[tuple[str, datetime]] = []
    seen: set[str] = set()
    for r in ordered(story, order):
        if r.source_id not in seen:
            seen.add(r.source_id)
            firsts.append((r.source_name, r.at.replace(second=0, microsecond=0)))
    (name, first_at), rest = firsts[0], firsts[1:]
    parts = [words["first"].format(name=name, time=clock(first_at, tz, now))]
    for other, at in rest:
        minutes = int((at - first_at).total_seconds() // 60)
        if minutes == 0:
            parts.append(words["same"].format(name=other))
        else:
            parts.append(words["later"].format(gap=_gap(minutes, words["units"]), name=other))
    return "; ".join(parts)


def facts_hash(story: Story, max_facts: int, language: str) -> str:
    payload = {
        "urls": sorted(r.url for r in story.reports),
        "max_facts": max_facts,
        "language": language,
        "prompt_version": summarize.FACTS_PROMPT_VERSION,
    }
    return hashlib.sha256(json.dumps(payload, sort_keys=True).encode("utf-8")).hexdigest()[:12]


def cap_key(story: Story, order: dict[str, int]) -> tuple:
    """Cap order: score, then number of sources, then earliest report, then key."""
    return (-story.score(), -len(story.sources()), min(r.at for r in story.reports), story.key)


# --- the store ---------------------------------------------------------------


def _story_from_raw(key: str, raw: dict) -> Story:
    return Story(
        key=key,
        topic=raw["topic"],
        status=raw["status"],
        opened_at=raw["opened_at"],
        reports=[Report(**r) for r in raw["reports"]],
        facts=[Fact(**f) for f in raw["facts"]],
        facts_for=raw["facts_for"],
        flagged=raw["flagged"],
    )


def load_store(path: Path) -> StoryStore:
    """A missing file is an empty store; an unreadable one raises, as
    state.json does."""
    if not path.exists():
        return StoryStore({})
    raw = json.loads(path.read_text(encoding="utf-8"))
    if raw.get("version") != STORE_VERSION:
        raise ValueError(f"{path}: unsupported stories.json version {raw.get('version')!r}")
    return StoryStore({key: _story_from_raw(key, value) for key, value in raw["stories"].items()})


def prune(store: StoryStore, now: datetime, window_hours: int, max_age_days: int) -> None:
    """Closed (sent/rejected/expired) stories past the window; waiting ones
    whose reports can no longer be collected. Queued and approved stay."""
    closed_cutoff = now - timedelta(hours=window_hours)
    waiting_cutoff = now - timedelta(hours=max(window_hours, 24 * max_age_days))
    for key, story in list(store.stories.items()):
        newest = story.newest()
        if story.status in ("sent", "rejected", "expired") and newest < closed_cutoff:
            del store.stories[key]
        elif story.status == "waiting" and newest < waiting_cutoff:
            del store.stories[key]


def save_store(path: Path, store: StoryStore, now: datetime, window_hours: int, max_age_days: int) -> None:
    prune(store, now, window_hours, max_age_days)
    raw = {
        "version": STORE_VERSION,
        "stories": {
            key: {k: v for k, v in asdict(story).items() if k != "key"} for key, story in sorted(store.stories.items())
        },
    }
    path.write_text(json.dumps(raw, indent=2, sort_keys=True, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")


def member_index(store: StoryStore) -> dict[str, Story]:
    """Every report URL -> its story."""
    return {r.url: story for story in store.stories.values() for r in story.reports}


def matchable(store: StoryStore, now: datetime, window_hours: int) -> list[Story]:
    """Stories whose newest report is inside the window, earliest opened first."""
    cutoff = now - timedelta(hours=window_hours)
    return sorted((s for s in store.stories.values() if s.newest() >= cutoff), key=lambda s: (s.opened_at, s.key))
