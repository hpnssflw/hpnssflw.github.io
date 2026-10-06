"""DeepSeek-backed ranking: batched calls per topic (at most
RANK_BATCH_SIZE candidates each), scored against the topic's
include/exclude criteria and a short reader profile, validated and
retried before falling back to per-candidate calls."""

from __future__ import annotations

import hashlib
import json
import os
from dataclasses import dataclass
from urllib.parse import urlparse

from openai import OpenAI

from agent.item import Item
from agent.preset import LLMSettings
from agent.sources.base import TopicConfig

# Bump whenever RANK_SYSTEM_PROMPT or _build_batch_prompt's wording
# changes, OR when llm.model changes (the model is not in rubric_hash):
# it's part of rubric_hash, so a bump re-scores cached verdicts.
RANK_PROMPT_VERSION = 2
# The first run after a rubric change re-scores a whole topic's window
# (100+ items); one oversized batch failing validation twice would fall
# back to one call per candidate.
RANK_BATCH_SIZE = 40

# The word "json" must appear in the prompt for DeepSeek's JSON object
# response mode to accept the request — this phrasing satisfies that
# requirement incidentally, since it's also what we want the model to do.
RANK_SYSTEM_PROMPT = (
    "You rank candidate links for one reader's research digest against "
    "one topic. For each candidate, judge how well it fits the topic's "
    "include and exclude criteria on a 1-10 scale, and write a "
    "one-sentence summary.\n"
    "Scale: 9-10 = squarely inside include, and substantial; 6-8 = inside "
    "include; 3-5 = tangential, or the given text doesn't make clear what "
    "it is; 1-2 = matches exclude, or off-topic.\n"
    "The summary states only what the title and excerpt say. Never guess "
    "what something likely does or offers.\n"
    "Respond with JSON only: an object of the shape "
    '{"rankings": [{"id": 1, "summary": "...", "score": 7}, ...]}, one '
    "entry per candidate, in the order given, ids starting at 1."
)


@dataclass(frozen=True)
class RankedItem:
    item: Item
    summary: str
    score: int
    failed: bool = False  # no call produced a verdict; never cached, retried next run


def rubric_hash(topic: TopicConfig, reader: str) -> str:
    """Identifies everything that shapes a verdict for this topic. Stored
    with each cached verdict (agent/rank_cache.py), so editing any of
    these re-scores the topic's cached items on the next run."""
    payload = {
        "name": topic.name,
        "description": topic.description,
        "include": list(topic.include),
        "exclude": list(topic.exclude),
        "reader": reader,
        "prompt_version": RANK_PROMPT_VERSION,
    }
    canonical = json.dumps(payload, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()[:12]


def _client(llm: LLMSettings) -> OpenAI:
    api_key = os.environ.get(llm.api_key_env)
    if not api_key:
        raise RuntimeError(f"{llm.api_key_env} is not set")
    return OpenAI(base_url=llm.base_url, api_key=api_key)


def _domain(url: str) -> str:
    host = urlparse(url).hostname or ""
    return host[4:] if host.startswith("www.") else host


def _context(candidate: Item) -> str:
    """`hn · 312 points · example.com` / `github · 1204 stars` — HN link
    posts carry no excerpt, so points and domain are most of what the
    ranker has beyond the title."""
    parts = [candidate.kind]
    if candidate.score is not None:
        unit = "stars" if candidate.kind == "github" else "points"
        parts.append(f"{candidate.score} {unit}")
    if candidate.kind != "github":
        domain = _domain(candidate.url)
        if domain:
            parts.append(domain)
    return " · ".join(parts)


def _build_batch_prompt(topic: TopicConfig, reader: str, candidates: list[Item]) -> str:
    lines = [
        f"Reader: {reader}",
        f"Topic: {topic.name}",
        f"Description: {topic.description}",
        "Include:",
        *[f"- {line}" for line in topic.include],
        "Exclude:",
        *[f"- {line}" for line in topic.exclude],
        "",
        "Candidates:",
    ]
    for index, candidate in enumerate(candidates, start=1):
        excerpt = f" — {candidate.text}" if candidate.text else ""
        lines.append(f"{index}. [{_context(candidate)}] {candidate.title}{excerpt}")
    return "\n".join(lines)


def _parse_batch_response(raw: str, expected_count: int) -> list[dict] | None:
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return None
    if not isinstance(parsed, dict) or "rankings" not in parsed:
        return None
    rankings = parsed["rankings"]
    if not isinstance(rankings, list) or len(rankings) != expected_count:
        return None
    seen_ids: set[int] = set()
    for entry in rankings:
        if not isinstance(entry, dict) or not {"id", "summary", "score"} <= entry.keys():
            return None
        entry_id = entry["id"]
        if not isinstance(entry_id, int) or not (1 <= entry_id <= expected_count):
            return None
        if entry_id in seen_ids:
            return None
        seen_ids.add(entry_id)
        if not isinstance(entry["score"], int) or not (1 <= entry["score"] <= 10):
            return None
        if not isinstance(entry["summary"], str) or not entry["summary"].strip():
            return None
    if seen_ids != set(range(1, expected_count + 1)):
        return None
    return rankings


def _call_batch(
    client: OpenAI, llm: LLMSettings, reader: str, topic: TopicConfig, candidates: list[Item]
) -> list[dict] | None:
    response = client.chat.completions.create(
        model=llm.model,
        response_format={"type": "json_object"},
        temperature=0,
        messages=[
            {"role": "system", "content": RANK_SYSTEM_PROMPT},
            {"role": "user", "content": _build_batch_prompt(topic, reader, candidates)},
        ],
    )
    content = response.choices[0].message.content or ""
    return _parse_batch_response(content, len(candidates))


def _rank_chunk(
    client: OpenAI, llm: LLMSettings, reader: str, topic: TopicConfig, candidates: list[Item]
) -> list[RankedItem]:
    result = _call_batch(client, llm, reader, topic, candidates)
    if result is None:
        result = _call_batch(client, llm, reader, topic, candidates)  # one retry

    if result is not None:
        by_id = {entry["id"]: entry for entry in result}
        return [
            RankedItem(item=c, summary=by_id[i]["summary"], score=by_id[i]["score"])
            for i, c in enumerate(candidates, start=1)
        ]

    # Batch failed twice — fall back to one call per candidate so the
    # whole chunk doesn't lose its ranking over one malformed response.
    ranked: list[RankedItem] = []
    for candidate in candidates:
        single = _call_batch(client, llm, reader, topic, [candidate])
        if single is None:
            ranked.append(RankedItem(item=candidate, summary="(ranking failed)", score=1, failed=True))
        else:
            entry = single[0]
            ranked.append(RankedItem(item=candidate, summary=entry["summary"], score=entry["score"]))
    return ranked


def rank_topic(topic: TopicConfig, candidates: list[Item], llm: LLMSettings, reader: str) -> list[RankedItem]:
    if not candidates:
        return []
    client = _client(llm)
    ranked: list[RankedItem] = []
    for start in range(0, len(candidates), RANK_BATCH_SIZE):
        ranked.extend(_rank_chunk(client, llm, reader, topic, candidates[start : start + RANK_BATCH_SIZE]))
    return ranked
