# Topic & Source Quality Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every topic's candidates match its theme by construction, each item is scored once against explicit per-topic criteria, and the inbox receives about 10 items a day in total.

**Architecture:** HN Algolia queries become strict (title only, whole words, no typos) and GitHub search runs one `topic:` query per configured GitHub topic, for all three topics. The DeepSeek ranker scores against `include`/`exclude` lists in each topic's YAML plus a reader profile, and every verdict is cached per (URL, topic) in `state.json` together with a rubric hash — re-scored only when the rubric changes or the item's points/stars grow. A rolling 24h cap per topic replaces the per-run `max_items`. A new `agent/pipeline.py` holds the per-topic pass, shared by the real run and a new write-nothing `--preview` mode; `python -m agent report` summarizes queue outcomes from `state.json`.

**Tech Stack:** Python agent (`requests`, `pyyaml`, `openai` — already dependencies), HN Algolia API, GitHub Search API, DeepSeek (`deepseek-v4-flash`), Next.js 16 static export (copy changes only), Vitest 4.

**Spec:** `docs/superpowers/specs/2026-09-30-topic-source-quality-design.md`

## Global Constraints

- HN queries always send `restrictSearchableAttributes=title`, `typoTolerance=false`, `queryType=prefixNone`, `hitsPerPage=50` (plus the existing `query`, `tags=story`, `numericFilters`). Not configurable per topic.
- GitHub: one query per GitHub topic, `q = f"topic:{t} created:>{cutoff} stars:>={min_stars}"`, `sort=stars`, `order=desc`, `per_page=30`, merged by `full_name`. `topics` is required in every `github_trending` config. Excerpt = `description[:280]` + ` · topics: a, b, c` (first 6 repo topics); no description → just `topics: …`.
- GitHub topics per topic: ai-engineering `llm, mcp, ai-agents, rag, llm-inference` (`min_stars: 100`); tooling `developer-tools, cli, devtools, terminal, vscode-extension, neovim` (`min_stars: 50`); web-products `data-visualization, web-performance, frontend, seo` (`min_stars: 50`).
- Ranker: `RANK_PROMPT_VERSION = 2`, `RANK_BATCH_SIZE = 40`, `temperature=0`. Scale anchors 9–10 / 6–8 / 3–5 / 1–2 as in the spec. Candidate line `N. [hn · 312 points · example.com] Title — excerpt` / `N. [github · 1204 stars] owner/repo — excerpt`.
- `rubric_hash` = first 12 hex chars of SHA-256 of `json.dumps({name, description, include, exclude, reader, prompt_version}, sort_keys=True, ensure_ascii=False)`.
- `min_relevance` stays **6**. `max_items` is replaced by `max_items_per_day`: default **3**, ai-engineering **4**. The cap is a rolling 24h window per topic.
- Growth (re-score) = both scores known, `current >= 2 * source_score` and `current - source_score >= attention.min_score_gain` (**50**, existing `attention` block); `attention.enabled: false` disables re-scoring on growth.
- `already_ranked` drops are emitted at stage **`dedupe`**; `below_relevance` and `over_max_items` stay at stage `rank`. Failed rankings are never cached.
- `status.json` and `pending.json` schemas are unchanged. `.github/workflows/agent-run.yml` is **not** changed.
- No new Python or npm dependencies. No Tailwind/CSS-in-JS/component library.
- Python on this machine is `py -3` (CI uses `python`). Throwaway verification scripts live in `.superpowers/sdd/2026-09-30-topic-source-quality/` (git-ignored) and run from the worktree root with `py -3 - < <script>` so the repo root is on `sys.path`. Each is written first and must fail before the code change.
- All work happens in the worktree `C:\A\polozov\.claude\worktrees\tony-scraponi` on branch `worktree-tony-scraponi`. Nothing touches `main` until Task 5.
- Never stage `.claude/settings.local.json`.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- After each task: update the sub-project #6 status lines in `PROGRESS.md` in the task's commit, then stop and hand off per `CLAUDE.md` ("Clean context after each micro-task").

## File map

| File | Responsibility | Task |
|---|---|---|
| `agent/sources/hn.py` | strict title-only Algolia queries | 1 |
| `agent/sources/github_trending.py` | one `topic:` query per GitHub topic, merged; topics in excerpt | 1 |
| `agent/topics/*.yaml` | keywords, sources (1); include/exclude (2); ai-engineering cap (3) | 1, 2, 3 |
| `agent/sources/base.py` | `TopicConfig.include/exclude` (2), `max_items_per_day` + `already_ranked` reason (3) | 2, 3 |
| `agent/config.py` | `RankingConfig`, topic include/exclude (2); `max_items_per_day` (3) | 2, 3 |
| `agent/defaults.yaml` | `ranking.reader` (2); `max_items_per_day` (3) | 2, 3 |
| `agent/summarize.py` | prompt, candidate context, batching, `failed`, `rubric_hash` | 2 |
| `agent/dedupe.py` | `RankRecord`, `StateEntry.ranks`, load/save | 3 |
| `agent/rank_cache.py` (new) | verdict cache validity, partition, record, daily cap, select | 3 |
| `agent/pipeline.py` (new) | `CONNECTORS`, `TopicResult`, `process_topic` (3); `format_preview` (4) | 3, 4 |
| `agent/main.py` | `run_real` uses `pipeline` (3); `--preview`, `report` dispatch (4) | 3, 4 |
| `agent/funnel.py`, `agent/panel_page.html` | `new` subtracts all dedupe reasons | 3 |
| `agent/events.py` | `MemoryWriter` | 4 |
| `agent/report.py` (new) | `build_report`, `run_report` | 4 |
| docs + `app/researcher/agent/page.tsx` + `lib/topics.ts` | narrative/copy sync | 5 |

---

### Task 1: Collection — strict HN search, GitHub topic queries, new keywords

**Files:**
- Modify: `agent/sources/hn.py`
- Modify: `agent/sources/github_trending.py` (full rewrite)
- Modify: `agent/topics/ai-engineering.yaml`, `agent/topics/tooling.yaml`, `agent/topics/web-products.yaml`
- Modify: `PROGRESS.md`, `docs/tony-scraponi-roadmap.md` (record sub-project #6 and #7)
- Throwaway: `.superpowers/sdd/2026-09-30-topic-source-quality/task1-check.py`

**Interfaces:**
- Consumes: `agent.sources.base.Candidate`, `Drop`, `TopicConfig`; `agent.config.load_topics` (all existing).
- Produces:
  - `hn.HITS_PER_PAGE = 50`; `hn.collect(topic, now)` unchanged signature, strict params.
  - `github_trending.collect(topic, now)` unchanged signature; raises `KeyError` if the topic's `github_trending` config has no `topics`.
  - `github_trending._excerpt(repo: dict) -> str | None`.
  - Every topic YAML has `sources.github_trending = {min_stars, topics}`.

- [ ] **Step 1: Write the verification script (it must fail first)**

Create `.superpowers/sdd/2026-09-30-topic-source-quality/task1-check.py`:

```python
from dataclasses import replace
from datetime import datetime, timezone
from pathlib import Path
from unittest import mock

from agent import config
from agent.sources import github_trending, hn

now = datetime(2026, 9, 30, 12, 0, tzinfo=timezone.utc)
topics = {t.slug: t for t in config.load_topics(Path("agent/topics"), Path("agent/defaults.yaml"))}
assert set(topics) == {"ai-engineering", "tooling", "web-products"}, topics


# --- config: short title-level keywords, GitHub topics on every topic ---
for slug, topic in topics.items():
    assert len(topic.keywords) >= 15, (slug, topic.keywords)
    assert topic.sources["hacker_news"] == {"min_points": 30}, (slug, topic.sources)
assert "MCP" in topics["ai-engineering"].keywords
for gone in ["agent framework", "LLM inference", "self-hosted AI"]:
    assert gone not in topics["ai-engineering"].keywords, gone
assert "developer tooling" not in topics["tooling"].keywords
assert topics["ai-engineering"].sources["github_trending"] == {
    "min_stars": 100, "topics": ["llm", "mcp", "ai-agents", "rag", "llm-inference"],
}
assert topics["tooling"].sources["github_trending"] == {
    "min_stars": 50, "topics": ["developer-tools", "cli", "devtools", "terminal", "vscode-extension", "neovim"],
}
assert topics["web-products"].sources["github_trending"] == {
    "min_stars": 50, "topics": ["data-visualization", "web-performance", "frontend", "seo"],
}


class FakeResponse:
    def __init__(self, payload):
        self._payload = payload

    def raise_for_status(self):
        pass

    def json(self):
        return self._payload


# --- HN: every request is strict; the same story from many keywords merges ---
hn_calls = []


def fake_hn_get(url, params=None, timeout=None, **kwargs):
    hn_calls.append(params)
    return FakeResponse({"hits": [
        {"objectID": "1", "url": "https://example.com/a", "title": "A CLI", "created_at_i": 1790000000, "points": 40},
    ]})


with mock.patch.object(hn.requests, "get", side_effect=fake_hn_get):
    candidates, drops = hn.collect(topics["tooling"], now)
assert len(hn_calls) == len(topics["tooling"].keywords), len(hn_calls)
for params in hn_calls:
    assert params["restrictSearchableAttributes"] == "title", params
    assert params["typoTolerance"] == "false", params
    assert params["queryType"] == "prefixNone", params
    assert params["hitsPerPage"] == 50, params
    assert params["tags"] == "story", params
    assert params["numericFilters"].endswith(",points>=30"), params
assert [c.title for c in candidates] == ["A CLI"] and drops == [], (candidates, drops)


# --- GitHub: one query per GitHub topic, merged by full_name, topics in the excerpt ---
def repo(name, stars, description, repo_topics):
    return {
        "html_url": f"https://github.com/{name}", "full_name": name,
        "created_at": "2026-09-25T10:00:00Z", "stargazers_count": stars,
        "description": description, "topics": repo_topics,
    }


gh_queries = []


def fake_gh_get(url, params=None, headers=None, timeout=None, **kwargs):
    gh_queries.append(params["q"])
    assert params["sort"] == "stars" and params["order"] == "desc" and params["per_page"] == 30, params
    if params["q"].startswith("topic:cli "):
        items = [
            repo("a/tool", 500, "A fast CLI", ["cli", "rust", "terminal", "tui", "tools", "dev", "extra"]),
            repo("b/shared", 300, None, ["cli", "developer-tools"]),
        ]
    elif params["q"].startswith("topic:developer-tools "):
        items = [repo("b/shared", 300, None, ["cli", "developer-tools"])]
    else:
        items = []
    return FakeResponse({"items": items})


with mock.patch.object(github_trending.requests, "get", side_effect=fake_gh_get):
    candidates, drops = github_trending.collect(topics["tooling"], now)
assert gh_queries == [
    f"topic:{t} created:>2026-09-20 stars:>=50"
    for t in ["developer-tools", "cli", "devtools", "terminal", "vscode-extension", "neovim"]
], gh_queries
by_title = {c.title: c for c in candidates}
assert sorted(by_title) == ["a/tool", "b/shared"], by_title
assert by_title["a/tool"].excerpt == "A fast CLI · topics: cli, rust, terminal, tui, tools, dev", by_title["a/tool"].excerpt
assert by_title["b/shared"].excerpt == "topics: cli, developer-tools", by_title["b/shared"].excerpt
assert by_title["a/tool"].source == "github" and by_title["a/tool"].score == 500
assert drops == []
assert github_trending._excerpt({"description": "", "topics": []}) is None

# --- GitHub: a config without topics is an error, raised before any request ---
broken = replace(topics["tooling"], sources={"github_trending": {"min_stars": 50}})
with mock.patch.object(github_trending.requests, "get", side_effect=AssertionError("no request expected")):
    try:
        github_trending.collect(broken, now)
    except KeyError:
        pass
    else:
        raise AssertionError("collect accepted a config without topics")

print("OK")
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `py -3 - < .superpowers/sdd/2026-09-30-topic-source-quality/task1-check.py`
Expected: `AssertionError` on the keyword-count loop (`('ai-engineering', [...])`) — the old topics have 4–6 keywords.

- [ ] **Step 3: Make HN queries strict**

In `agent/sources/hn.py`, replace the module docstring and constants:

```python
"""Hacker News connector — queries Algolia search per topic keyword,
matching story titles only (whole words, no typo tolerance)."""
```

```python
ALGOLIA_SEARCH_URL = "https://hn.algolia.com/api/v1/search"
EXCERPT_MAX_CHARS = 280
HITS_PER_PAGE = 50
```

and replace the `params` dict inside the keyword loop with:

```python
        params = {
            "query": keyword,
            "tags": "story",
            "numericFilters": f"created_at_i>{cutoff_epoch},points>={min_points}",
            # By default Algolia also matches URL, story text and author,
            # with typo tolerance and prefix matching: "MCP" found Google
            # Maps stories and "SEO" found "so"/"Sol". Titles only, whole
            # words, no typos.
            "restrictSearchableAttributes": "title",
            "typoTolerance": "false",
            "queryType": "prefixNone",
            "hitsPerPage": HITS_PER_PAGE,
        }
```

- [ ] **Step 4: Rewrite `agent/sources/github_trending.py`**

Replace the whole file with:

```python
"""GitHub connector. GitHub has no official "trending" API -- the
github.com/trending page is unversioned HTML, not worth scraping -- so
this uses the official Search API: recently created repos carrying one of
the topic's GitHub topics (topic:cli, topic:llm, ...), ranked by stars,
one query per GitHub topic, merged by repo. It used to run one global
"anything new and starred" query for Tooling alone, which let in any
trending repo whatever its subject -- so `topics` is now required."""

from __future__ import annotations

import os
from datetime import datetime, timedelta

import requests

from agent.sources.base import Candidate, Drop, TopicConfig

SEARCH_URL = "https://api.github.com/search/repositories"
EXCERPT_MAX_CHARS = 280
EXCERPT_MAX_TOPICS = 6
PER_PAGE = 30


def _excerpt(repo: dict) -> str | None:
    """Description plus the repo's own GitHub topics -- the topics tell
    the ranker what a terse or missing description doesn't."""
    description = (repo.get("description") or "").strip()[:EXCERPT_MAX_CHARS]
    repo_topics = (repo.get("topics") or [])[:EXCERPT_MAX_TOPICS]
    topic_text = f"topics: {', '.join(repo_topics)}" if repo_topics else ""
    if description and topic_text:
        return f"{description} · {topic_text}"
    return description or topic_text or None


def collect(topic: TopicConfig, now: datetime) -> tuple[list[Candidate], list[Drop]]:
    github_config = topic.sources.get("github_trending")
    if github_config is None:
        return [], []
    github_topics = github_config["topics"]  # required: a KeyError is logged by main as "collect failed"
    min_stars = github_config.get("min_stars", 0)
    cutoff = (now - timedelta(days=topic.max_age_days)).date().isoformat()

    headers = {"Accept": "application/vnd.github+json"}
    token = os.environ.get("GITHUB_TOKEN")
    if token:
        headers["Authorization"] = f"Bearer {token}"

    repos_by_name: dict[str, dict] = {}
    for github_topic in github_topics:
        params = {
            "q": f"topic:{github_topic} created:>{cutoff} stars:>={min_stars}",
            "sort": "stars",
            "order": "desc",
            "per_page": PER_PAGE,
        }
        response = requests.get(SEARCH_URL, params=params, headers=headers, timeout=10)
        response.raise_for_status()
        for repo in response.json()["items"]:
            repos_by_name[repo["full_name"]] = repo

    candidates: list[Candidate] = []
    drops: list[Drop] = []
    for repo in repos_by_name.values():
        url = repo["html_url"]
        title = repo["full_name"]
        created_at = repo.get("created_at")
        if created_at is None:
            # GitHub always populates created_at in practice; this branch
            # exists so the connector never invents a date rather than
            # because it's expected to fire.
            drops.append(
                Drop(url=url, title=title, reason="undated", detail={"source": "github"})
            )
            continue
        candidates.append(
            Candidate(
                url=url,
                title=title,
                source="github",
                topic=topic.slug,
                published_at=datetime.fromisoformat(created_at.replace("Z", "+00:00")),
                score=repo.get("stargazers_count"),
                excerpt=_excerpt(repo),
            )
        )

    return candidates, drops
```

- [ ] **Step 5: Rewrite the three topic files' `keywords` and `sources`**

`agent/topics/ai-engineering.yaml` (whole file):

```yaml
name: AI Engineering
description: >
  Agent and automated pipelines and harnesses, LLM assistants,
  self-hosted/private AI platform development, and LLM/inference
  optimization.
# Matched against HN story titles only -- whole words, no typos -- so keep
# them short: a multi-word keyword needs every word in the title.
keywords:
  [LLM, agent, agentic, MCP, RAG, inference, eval, benchmark, Claude, GPT, Gemini,
   DeepSeek, Qwen, Llama, llama.cpp, vLLM, Ollama, open-weight, fine-tuning, prompt,
   embeddings]

sources:
  hacker_news: { min_points: 30 }
  github_trending: { min_stars: 100, topics: [llm, mcp, ai-agents, rag, llm-inference] }
```

`agent/topics/tooling.yaml` (whole file):

```yaml
name: Tooling
description: >
  Trending GitHub repos and web development tools.
# Matched against HN story titles only -- whole words, no typos -- so keep
# them short: a multi-word keyword needs every word in the title.
keywords:
  [CLI, terminal, editor, IDE, compiler, debugger, Git, GitHub, Rust, TypeScript, Python,
   Postgres, SQLite, database, Show HN, open source, library, framework, Neovim, VS Code]

sources:
  hacker_news: { min_points: 30 }
  github_trending:
    { min_stars: 50, topics: [developer-tools, cli, devtools, terminal, vscode-extension, neovim] }
```

`agent/topics/web-products.yaml` (whole file):

```yaml
name: Web Products
description: >
  Product and web trends, securities & market data, data visualization,
  browser performance, web architecture, and SEO.
# Matched against HN story titles only -- whole words, no typos -- so keep
# them short: a multi-word keyword needs every word in the title.
keywords:
  [browser, Chrome, Firefox, Safari, WebKit, WebAssembly, JavaScript, CSS, HTML, React,
   frontend, SEO, visualization, chart, dashboard, D3, stock, trading, fintech, Stripe, SaaS]

sources:
  hacker_news: { min_points: 30 }
  github_trending: { min_stars: 50, topics: [data-visualization, web-performance, frontend, seo] }
```

(Tooling's description changes in Task 2, with the criteria.)

- [ ] **Step 6: Run the verification script**

Run: `py -3 - < .superpowers/sdd/2026-09-30-topic-source-quality/task1-check.py`
Expected: `OK`

- [ ] **Step 7: Live smoke check (network, no DeepSeek)**

Run: `GITHUB_TOKEN=$(gh auth token) py -3 -m agent --dry-run`
Expected: three funnels print (`AI Engineering`, `Tooling`, `Web Products`), no `collection failed` lines, `collected` > 0 for AI Engineering and Tooling. (Writes `agent/state.json` and a file in `agent/runs/`, both git-ignored. If a request times out — this machine's TLS to some hosts is flaky — re-run once.)

- [ ] **Step 8: Record sub-project #6 in the status docs**

In `docs/tony-scraponi-roadmap.md`, after item 5 (the paragraph ending "`docs/superpowers/specs/2026-09-28-tony-scraponi-inbox-design.md`."), add:

```markdown
6. **Topic & source quality.** Strict title-only HN search, GitHub
   topic queries for every topic, per-topic include/exclude criteria
   for the ranker, a verdict cache so an item is scored once, and a
   daily cap per topic. Spec:
   `docs/superpowers/specs/2026-09-30-topic-source-quality-design.md`.
7. **A Web Products source.** Hacker News barely covers market data,
   dataviz and SEO, so Web Products needs a source of its own (RSS or
   otherwise) — designed once #6's numbers are in.

Later candidate: give the ranker Artem's recent inbox decisions as
few-shot examples, once there are 30–50 of them.
```

In `PROGRESS.md`:
- Replace the Content Direction status line `**Status: sub-projects #1-#5 shipped.**` with `**Status: sub-projects #1-#5 shipped; #6 (topic & source quality) in progress.**`
- After the whole "**Sub-project #5, Inbox (moderated delivery): shipped.**" bullet (it ends "`CLAUDE.md`; M1, M4, M7-M10 deferred."), add:

```markdown
- **Sub-project #6, Topic & source quality: in progress.**
  Spec: `docs/superpowers/specs/2026-09-30-topic-source-quality-design.md`.
  Plan: `docs/superpowers/plans/2026-09-30-topic-source-quality.md`.
  Task 1 of 5 done.
  Latest: strict title-only HN search; GitHub topic queries for all three topics.
  Next: Task 2 (ranking criteria).
```

- In "How to resume", replace

```
Sub-project #5 (Inbox) is
shipped; there's no confirmed next step for this initiative —
candidates: a Telegram DM when items await review, summary editing,
topic/source management.
```

with

```
Sub-project #5 (Inbox) is
shipped. Sub-project #6 (topic & source quality) is in progress: follow
`docs/superpowers/plans/2026-09-30-topic-source-quality.md` from the
task its status bullet above names as next. Later candidates: a Web
Products source (#7), a Telegram DM when items await review, summary
editing.
```

- [ ] **Step 9: Commit**

```bash
git add agent/sources/hn.py agent/sources/github_trending.py agent/topics/ai-engineering.yaml agent/topics/tooling.yaml agent/topics/web-products.yaml docs/tony-scraponi-roadmap.md PROGRESS.md
git commit -m "Match HN keywords in titles only and query GitHub by topic

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Ranking criteria — include/exclude, reader, prompt, batching, rubric hash

**Files:**
- Modify: `agent/sources/base.py` (`TopicConfig.include`, `TopicConfig.exclude`)
- Modify: `agent/config.py` (`RankingConfig`, `Settings.ranking`, topic include/exclude)
- Modify: `agent/defaults.yaml` (`ranking.reader`)
- Modify: `agent/summarize.py` (full rewrite)
- Modify: `agent/topics/*.yaml` (include/exclude; Tooling description)
- Modify: `docs/tony-scraponi-roadmap.md` (Tooling theme wording), `PROGRESS.md`
- Throwaway: `.superpowers/sdd/2026-09-30-topic-source-quality/task2-check.py`

**Interfaces:**
- Consumes: `Candidate`, `TopicConfig`, `config.Settings` (existing).
- Produces:
  - `TopicConfig.include: list[str]`, `TopicConfig.exclude: list[str]` (declared right after `keywords`)
  - `config.RankingConfig(reader: str)`; `config.Settings.ranking: RankingConfig`
  - `summarize.RANK_PROMPT_VERSION = 2`, `summarize.RANK_BATCH_SIZE = 40`
  - `summarize.RankedItem(candidate: Candidate, summary: str, score: int, failed: bool = False)`
  - `summarize.rubric_hash(topic: TopicConfig, settings: Settings) -> str` (12 hex chars)
  - `summarize._build_batch_prompt(topic: TopicConfig, settings: Settings, candidates: list[Candidate]) -> str`
  - `summarize.rank_topic(topic, candidates, settings) -> list[RankedItem]` (unchanged signature; batches of 40; `temperature=0`)

- [ ] **Step 1: Write the verification script (it must fail first)**

Create `.superpowers/sdd/2026-09-30-topic-source-quality/task2-check.py`:

```python
import json
import re
from dataclasses import replace
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace

from agent import config, summarize
from agent.sources.base import Candidate

now = datetime(2026, 9, 30, 12, 0, tzinfo=timezone.utc)
settings = config.load_settings(Path("agent/defaults.yaml"))
topics = {t.slug: t for t in config.load_topics(Path("agent/topics"), Path("agent/defaults.yaml"))}
tooling = topics["tooling"]

# --- config ---
assert settings.ranking.reader.startswith("Artem, a full-stack engineer"), settings.ranking.reader
assert not settings.ranking.reader.endswith("\n")
for slug, topic in topics.items():
    assert len(topic.include) >= 3 and len(topic.exclude) >= 3, (slug, topic.include, topic.exclude)
assert "Trending GitHub repos" not in tooling.description, tooling.description
assert any("Tooling" in line for line in topics["ai-engineering"].exclude)
assert any("AI Engineering" in line for line in tooling.exclude)


def cand(i, source="hn", score=312, url=None, excerpt=None):
    return Candidate(
        url=url or f"https://www.example.com/{i}", title=f"Title {i}", source=source,
        topic="tooling", published_at=now, score=score, excerpt=excerpt,
    )


# --- the prompt carries reader, criteria and per-candidate context ---
prompt = summarize._build_batch_prompt(tooling, settings, [
    cand(1),
    cand(2, source="github", score=1204, url="https://github.com/o/r", excerpt="A CLI · topics: cli, rust"),
    cand(3, score=None, url="https://news.ycombinator.com/item?id=3"),
])
assert f"Reader: {settings.ranking.reader}" in prompt, prompt
assert f"Topic: {tooling.name}" in prompt and f"Description: {tooling.description}" in prompt
assert "Include:" in prompt and "Exclude:" in prompt
for line in tooling.include + tooling.exclude:
    assert f"- {line}" in prompt, line
assert "1. [hn · 312 points · example.com] Title 1" in prompt, prompt
assert "2. [github · 1204 stars] Title 2 — A CLI · topics: cli, rust" in prompt, prompt
assert "3. [hn · news.ycombinator.com] Title 3" in prompt, prompt
for anchor in ["9-10", "6-8", "3-5", "1-2", "Never guess", "JSON"]:
    assert anchor in summarize.RANK_SYSTEM_PROMPT, anchor

# --- rubric_hash: stable, 12 hex chars, moves only with what shapes a verdict ---
h = summarize.rubric_hash(tooling, settings)
assert re.fullmatch(r"[0-9a-f]{12}", h), h
assert h == summarize.rubric_hash(tooling, settings)
assert h != summarize.rubric_hash(replace(tooling, include=tooling.include + ["x"]), settings)
assert h != summarize.rubric_hash(replace(tooling, exclude=[]), settings)
assert h != summarize.rubric_hash(replace(tooling, description="other"), settings)
assert h != summarize.rubric_hash(tooling, replace(settings, ranking=config.RankingConfig(reader="someone else")))
assert h == summarize.rubric_hash(replace(tooling, keywords=["x"], min_relevance=9, max_age_days=3), settings)
summarize.RANK_PROMPT_VERSION += 1
assert h != summarize.rubric_hash(tooling, settings)
summarize.RANK_PROMPT_VERSION -= 1


# --- rank_topic: batches of 40, temperature 0, order preserved ---
class FakeCompletions:
    def __init__(self, respond):
        self.respond = respond
        self.calls = []
        self.batch_sizes = []

    def create(self, **kwargs):
        self.calls.append(kwargs)
        user = kwargs["messages"][1]["content"]
        n = len(re.findall(r"^\d+\. \[", user, flags=re.M))
        self.batch_sizes.append(n)
        content = self.respond(n)
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=content))])


def install(fake):
    summarize._client = lambda s: SimpleNamespace(chat=SimpleNamespace(completions=fake))


good = FakeCompletions(lambda n: json.dumps(
    {"rankings": [{"id": i, "summary": f"s{i}", "score": 7} for i in range(1, n + 1)]}
))
install(good)
ranked = summarize.rank_topic(tooling, [cand(i) for i in range(1, 86)], settings)
assert good.batch_sizes == [40, 40, 5], good.batch_sizes
assert all(call["temperature"] == 0 for call in good.calls)
assert [r.candidate.title for r in ranked] == [f"Title {i}" for i in range(1, 86)]
assert all(r.score == 7 and not r.failed for r in ranked)

# --- a batch that never validates falls back per candidate; still-failing items are flagged ---
bad = FakeCompletions(lambda n: "not json")
install(bad)
ranked = summarize.rank_topic(tooling, [cand(1), cand(2)], settings)
assert len(bad.calls) == 4, len(bad.calls)  # batch, retry, then one call per candidate
assert all(r.failed and r.score == 1 and r.summary == "(ranking failed)" for r in ranked), ranked
assert summarize.rank_topic(tooling, [], settings) == []

print("OK")
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `py -3 - < .superpowers/sdd/2026-09-30-topic-source-quality/task2-check.py`
Expected: `AttributeError: 'Settings' object has no attribute 'ranking'`

- [ ] **Step 3: Add `include`/`exclude` to `TopicConfig`**

In `agent/sources/base.py`, in `TopicConfig`, directly after `keywords: list[str]`, add:

```python
    include: list[str]  # ranker criteria: what fits this topic
    exclude: list[str]  # ranker criteria: what doesn't, even if the keywords match
```

- [ ] **Step 4: Load the reader and the criteria in `agent/config.py`**

After the `InboxConfig` dataclass, add:

```python
@dataclass(frozen=True)
class RankingConfig:
    reader: str
```

Add `ranking: RankingConfig` as the last field of `Settings`. In `load_settings`, add `ranking_raw = raw["ranking"]` after `inbox_raw = raw["inbox"]`, and add this argument to the `Settings(...)` call, after `inbox=...`:

```python
        ranking=RankingConfig(reader=ranking_raw["reader"].strip()),
```

In `load_topics`, after `keywords=merged["keywords"],` add:

```python
                include=merged.get("include", []),
                exclude=merged.get("exclude", []),
```

- [ ] **Step 5: Add the reader to `agent/defaults.yaml`**

Between the `llm:` block and the `delivery:` block, add:

```yaml
ranking:
  # Who the digest is for. Part of every ranking prompt and of each
  # topic's rubric hash, so editing it re-scores cached verdicts.
  reader: >
    Artem, a full-stack engineer who builds web products and LLM agents
    and writes about both. He wants items he can learn from or act on
    as a builder, not general tech news.
```

- [ ] **Step 6: Add the criteria to the topic files**

`agent/topics/ai-engineering.yaml` — after the `description:` block, before the keywords comment, add:

```yaml
include:
  - "building, running or evaluating LLM systems: agent harnesses, tool use, MCP, RAG, evals"
  - "inference and serving: self-hosted/local models, quantization, speed and cost"
  - major model, API or dev-platform releases that change what or how you build
exclude:
  - AI policy, lawsuits, regulation, company drama, funding and business news
  - AI tools used while writing code (they belong to Tooling)
  - consumer AI apps with no engineering substance
```

`agent/topics/tooling.yaml` — replace the `description:` block and add the criteria after it:

```yaml
description: >
  Tools developers use to build software: editors, CLIs, libraries,
  and AI coding tools.
include:
  - "tools used while building software: editors and IDEs, CLIs, terminals, debuggers, build tools, package managers, version control, databases"
  - "AI tools used while writing code: coding agents, editor plugins, Claude Code skills and hooks"
  - new or notably improved open-source libraries and frameworks for building software
exclude:
  - "components for building LLM systems: agent frameworks, inference servers, evals (they belong to AI Engineering)"
  - games, consumer apps, and utilities with no role in software development
  - nostalgia or legacy-systems threads, career and workplace discussion
```

`agent/topics/web-products.yaml` — after the `description:` block, add:

```yaml
include:
  - "the web platform and browsers: new APIs, standards, rendering and browser performance"
  - "frontend engineering and web architecture: frameworks, CSS, performance, SEO"
  - data visualization, and products built on market or financial data
  - "product and web trends: notable launches and how web products make money"
exclude:
  - general tech-company news, earnings and stock moves with no product angle
  - AI model releases (AI Engineering) and developer tools (Tooling)
  - games and demos that merely run in a browser
```

(Items containing `: ` are quoted so YAML doesn't read them as mappings.)

- [ ] **Step 7: Rewrite `agent/summarize.py`**

Replace the whole file with:

```python
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

from agent.config import Settings
from agent.sources.base import Candidate, TopicConfig

# Bump whenever RANK_SYSTEM_PROMPT or _build_batch_prompt's wording
# changes: it's part of rubric_hash, so a bump re-scores cached verdicts.
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
    candidate: Candidate
    summary: str
    score: int
    failed: bool = False  # no call produced a verdict; never cached, retried next run


def rubric_hash(topic: TopicConfig, settings: Settings) -> str:
    """Identifies everything that shapes a verdict for this topic. Stored
    with each cached verdict (agent/rank_cache.py), so editing any of
    these re-scores the topic's cached items on the next run."""
    payload = {
        "name": topic.name,
        "description": topic.description,
        "include": list(topic.include),
        "exclude": list(topic.exclude),
        "reader": settings.ranking.reader,
        "prompt_version": RANK_PROMPT_VERSION,
    }
    canonical = json.dumps(payload, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()[:12]


def _client(settings: Settings) -> OpenAI:
    api_key = os.environ.get("DEEPSEEK_API_KEY")
    if not api_key:
        raise RuntimeError("DEEPSEEK_API_KEY is not set")
    return OpenAI(base_url=settings.llm.base_url, api_key=api_key)


def _domain(url: str) -> str:
    host = urlparse(url).hostname or ""
    return host[4:] if host.startswith("www.") else host


def _context(candidate: Candidate) -> str:
    """`hn · 312 points · example.com` / `github · 1204 stars` — HN link
    posts carry no excerpt, so points and domain are most of what the
    ranker has beyond the title."""
    parts = [candidate.source]
    if candidate.score is not None:
        unit = "stars" if candidate.source == "github" else "points"
        parts.append(f"{candidate.score} {unit}")
    if candidate.source != "github":
        domain = _domain(candidate.url)
        if domain:
            parts.append(domain)
    return " · ".join(parts)


def _build_batch_prompt(topic: TopicConfig, settings: Settings, candidates: list[Candidate]) -> str:
    lines = [
        f"Reader: {settings.ranking.reader}",
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
        excerpt = f" — {candidate.excerpt}" if candidate.excerpt else ""
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
    client: OpenAI, settings: Settings, topic: TopicConfig, candidates: list[Candidate]
) -> list[dict] | None:
    response = client.chat.completions.create(
        model=settings.llm.model,
        response_format={"type": "json_object"},
        temperature=0,
        messages=[
            {"role": "system", "content": RANK_SYSTEM_PROMPT},
            {"role": "user", "content": _build_batch_prompt(topic, settings, candidates)},
        ],
    )
    content = response.choices[0].message.content or ""
    return _parse_batch_response(content, len(candidates))


def _rank_chunk(
    client: OpenAI, settings: Settings, topic: TopicConfig, candidates: list[Candidate]
) -> list[RankedItem]:
    result = _call_batch(client, settings, topic, candidates)
    if result is None:
        result = _call_batch(client, settings, topic, candidates)  # one retry

    if result is not None:
        by_id = {entry["id"]: entry for entry in result}
        return [
            RankedItem(candidate=c, summary=by_id[i]["summary"], score=by_id[i]["score"])
            for i, c in enumerate(candidates, start=1)
        ]

    # Batch failed twice — fall back to one call per candidate so the
    # whole chunk doesn't lose its ranking over one malformed response.
    ranked: list[RankedItem] = []
    for candidate in candidates:
        single = _call_batch(client, settings, topic, [candidate])
        if single is None:
            ranked.append(RankedItem(candidate=candidate, summary="(ranking failed)", score=1, failed=True))
        else:
            entry = single[0]
            ranked.append(RankedItem(candidate=candidate, summary=entry["summary"], score=entry["score"]))
    return ranked


def rank_topic(topic: TopicConfig, candidates: list[Candidate], settings: Settings) -> list[RankedItem]:
    if not candidates:
        return []
    client = _client(settings)
    ranked: list[RankedItem] = []
    for start in range(0, len(candidates), RANK_BATCH_SIZE):
        ranked.extend(_rank_chunk(client, settings, topic, candidates[start : start + RANK_BATCH_SIZE]))
    return ranked
```

- [ ] **Step 8: Run the verification scripts**

Run: `py -3 - < .superpowers/sdd/2026-09-30-topic-source-quality/task2-check.py`
Expected: `OK`
Run: `py -3 - < .superpowers/sdd/2026-09-30-topic-source-quality/task1-check.py`
Expected: `OK`
Run: `py -3 -c "import agent.main"`
Expected: no output (imports cleanly).

- [ ] **Step 9: Update the roadmap's Tooling theme and the status line**

In `docs/tony-scraponi-roadmap.md`, "Themes" section, replace

```
3. **Tooling** — trending GitHub repos, web development tools.
```

with

```
3. **Tooling** — tools developers use to build software: editors, CLIs,
   libraries, and AI coding tools. (Until sub-project #6 this read
   "trending GitHub repos, web development tools"; a trending repo that
   isn't a developer tool no longer qualifies.)
```

In `PROGRESS.md`'s sub-project #6 bullet, replace the three lines:
- `Task 1 of 5 done.` → `Task 2 of 5 done.`
- the `Latest:` line → `Latest: per-topic include/exclude criteria, reader profile, rubric hash, batches of 40.`
- the `Next:` line → `Next: Task 3 (verdict cache and daily cap).`

- [ ] **Step 10: Commit**

```bash
git add agent/sources/base.py agent/config.py agent/defaults.yaml agent/summarize.py agent/topics/ai-engineering.yaml agent/topics/tooling.yaml agent/topics/web-products.yaml docs/tony-scraponi-roadmap.md PROGRESS.md
git commit -m "Rank against per-topic include/exclude criteria and a reader profile

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Verdict cache, daily cap, shared per-topic pipeline

**Files:**
- Modify: `agent/dedupe.py` (`RankRecord`, `StateEntry.ranks`, `load_state`)
- Create: `agent/rank_cache.py`
- Create: `agent/pipeline.py`
- Modify: `agent/main.py` (imports, `run_dry`'s connector loop, `run_real`'s topic loop)
- Modify: `agent/sources/base.py` (`max_items` → `max_items_per_day`, `Drop.reason` comment)
- Modify: `agent/config.py` (`max_items_per_day`)
- Modify: `agent/defaults.yaml`, `agent/topics/ai-engineering.yaml`
- Modify: `agent/funnel.py`, `agent/panel_page.html`
- Modify: `PROGRESS.md`
- Throwaway: `.superpowers/sdd/2026-09-30-topic-source-quality/task3-check.py`

**Interfaces:**
- Consumes: `summarize.RankedItem` (with `failed`), `summarize.rubric_hash`, `summarize.rank_topic` (Task 2); `dedupe.record_seen`, `dedupe.filter_seen`, `pending.filter_already_pending`, `pending.add_kept`, `date_guard.apply_recency_window` (existing).
- Produces:
  - `dedupe.RankRecord(relevance: int, summary: str, rubric: str, source_score: int | None, ranked_at: str, queued_at: str | None = None)`
  - `dedupe.StateEntry.ranks: dict[str, RankRecord]` (default `{}`, keyed by topic slug)
  - `rank_cache.is_valid(record: RankRecord, candidate: Candidate, rubric: str, topic: TopicConfig) -> bool`
  - `rank_cache.partition(candidates: list[Candidate], state: dict[str, StateEntry], topic: TopicConfig, rubric: str) -> tuple[list[Candidate], list[RankedItem], list[Drop]]` (to_rank, cached, already_ranked drops)
  - `rank_cache.record(state, ranked: list[RankedItem], slug: str, rubric: str, now: datetime) -> None`
  - `rank_cache.queued_in_last_24h(state, slug: str, now: datetime) -> int`
  - `rank_cache.select(eligible: list[RankedItem], remaining: int) -> tuple[list[RankedItem], list[RankedItem]]`
  - `rank_cache.mark_queued(state, items: list[RankedItem], slug: str, now: datetime) -> None`
  - `pipeline.CONNECTORS: dict[str, Callable]` (moved from `main.py`)
  - `pipeline.TopicResult(kept, over_cap, below: list[RankedItem], cached_below: list[Drop], queued_before: int)`
  - `pipeline.process_topic(topic, state, queue, settings, now, writer) -> TopicResult` (`writer` needs `emit`, `emit_candidate`, `emit_drop`)
  - `TopicConfig.max_items_per_day: int` (replaces `max_items`)

- [ ] **Step 1: Write the verification script (it must fail first)**

Create `.superpowers/sdd/2026-09-30-topic-source-quality/task3-check.py`:

```python
import json
import tempfile
from dataclasses import replace
from datetime import datetime, timedelta, timezone
from pathlib import Path

from agent import config, dedupe, events, funnel, pending, pipeline, rank_cache, status_export, summarize
from agent.sources.base import Candidate

now = datetime(2026, 9, 30, 12, 0, tzinfo=timezone.utc)
settings = config.load_settings(Path("agent/defaults.yaml"))
topics = {t.slug: t for t in config.load_topics(Path("agent/topics"), Path("agent/defaults.yaml"))}
tooling = topics["tooling"]
tmp = Path(tempfile.mkdtemp())

# --- config ---
assert tooling.max_items_per_day == 3 and topics["web-products"].max_items_per_day == 3
assert topics["ai-engineering"].max_items_per_day == 4
assert not hasattr(tooling, "max_items")
assert tooling.attention_enabled and tooling.attention_min_score_gain == 50


def cand(title, score=40):
    return Candidate(url=f"https://example.com/{title}", title=title, source="hn", topic="tooling",
                     published_at=now, score=score, excerpt=None)


def verdict(relevance, rubric, source_score=40, queued_at=None, summary="s"):
    return dedupe.RankRecord(relevance=relevance, summary=summary, rubric=rubric, source_score=source_score,
                             ranked_at=now.isoformat(), queued_at=queued_at)


def entry(**ranks):
    return dedupe.StateEntry(first_seen=now.isoformat(), last_score=40, times_sent=0, ranks=dict(ranks))


# --- state round-trip: old entries load without ranks; ranks survive save/load ---
path = tmp / "state.json"
path.write_text(json.dumps({"abc": {"first_seen": now.isoformat(), "last_score": 5, "times_sent": 0, "dismissed": None}}),
                encoding="utf-8")
state = dedupe.load_state(path)
assert state["abc"].ranks == {}
state["abc"].ranks["tooling"] = verdict(7, "r")
dedupe.save_state(path, state)
assert json.loads(path.read_text(encoding="utf-8"))["abc"]["ranks"]["tooling"]["queued_at"] is None
assert dedupe.load_state(path)["abc"].ranks["tooling"] == state["abc"].ranks["tooling"]

# --- is_valid ---
assert rank_cache.is_valid(verdict(4, "r", source_score=35), cand("x", 84), "r", tooling)       # +49: not growth
assert not rank_cache.is_valid(verdict(4, "r", source_score=35), cand("x", 85), "r", tooling)   # 2x and +50
assert rank_cache.is_valid(verdict(4, "r", source_score=300), cand("x", 350), "r", tooling)     # +50 but not 2x
assert not rank_cache.is_valid(verdict(4, "r", source_score=300), cand("x", 600), "r", tooling)
assert not rank_cache.is_valid(verdict(4, "old"), cand("x"), "r", tooling)                      # rubric changed
assert rank_cache.is_valid(verdict(4, "r", source_score=35), cand("x", 500), "r",
                           replace(tooling, attention_enabled=False))
assert rank_cache.is_valid(verdict(4, "r", source_score=None), cand("x", 500), "r", tooling)
assert rank_cache.is_valid(verdict(4, "r", source_score=35), cand("x", None), "r", tooling)

# --- partition ---
state = {
    dedupe.url_hash("https://example.com/low"): entry(tooling=verdict(4, "r")),
    dedupe.url_hash("https://example.com/high"): entry(tooling=verdict(8, "r", summary="kept before")),
    dedupe.url_hash("https://example.com/stale"): entry(tooling=verdict(9, "old")),
    dedupe.url_hash("https://example.com/other"): entry(**{"web-products": verdict(9, "r")}),
}
to_rank, cached, drops = rank_cache.partition(
    [cand("low"), cand("high"), cand("stale"), cand("other"), cand("new")], state, tooling, "r")
assert [c.title for c in to_rank] == ["stale", "other", "new"], to_rank
assert [(i.candidate.title, i.score, i.summary) for i in cached] == [("high", 8, "kept before")], cached
assert [(d.title, d.reason, d.detail) for d in drops] == [("low", "already_ranked", {"relevance": 4})], drops

# --- record: stores fresh verdicts, skips failed ones ---
state = {dedupe.url_hash("https://example.com/a"): entry(), dedupe.url_hash("https://example.com/b"): entry()}
rank_cache.record(state, [
    summarize.RankedItem(candidate=cand("a", 77), summary="sa", score=6),
    summarize.RankedItem(candidate=cand("b"), summary="(ranking failed)", score=1, failed=True),
], "tooling", "r", now)
assert state[dedupe.url_hash("https://example.com/a")].ranks["tooling"] == dedupe.RankRecord(
    relevance=6, summary="sa", rubric="r", source_score=77, ranked_at=now.isoformat(), queued_at=None)
assert state[dedupe.url_hash("https://example.com/b")].ranks == {}

# --- queued_in_last_24h ---
state = {
    "1": entry(tooling=verdict(7, "r", queued_at=(now - timedelta(hours=23, minutes=59)).isoformat())),
    "2": entry(tooling=verdict(7, "r", queued_at=(now - timedelta(hours=24, seconds=1)).isoformat())),
    "3": entry(**{"web-products": verdict(7, "r", queued_at=now.isoformat())}),
    "4": entry(tooling=verdict(7, "r")),
}
assert rank_cache.queued_in_last_24h(state, "tooling", now) == 1
assert rank_cache.queued_in_last_24h(state, "web-products", now) == 1

# --- select: relevance, then source score, descending ---
items = [
    summarize.RankedItem(candidate=cand("p", 10), summary="", score=7),
    summarize.RankedItem(candidate=cand("q", 90), summary="", score=7),
    summarize.RankedItem(candidate=cand("r", 5), summary="", score=9),
]
keep, over = rank_cache.select(items, 2)
assert [i.candidate.title for i in keep] == ["r", "q"] and [i.candidate.title for i in over] == ["p"]
assert rank_cache.select(items, 0)[0] == []

# --- process_topic end to end (fake source, fake ranker) ---
topic = replace(tooling, sources={"hacker_news": {"min_points": 30}})
rubric = summarize.rubric_hash(topic, settings)
collected = [cand(t) for t in ["c2", "c3", "c4", "c5", "c6"]]
pipeline.CONNECTORS = {"hacker_news": lambda t, n: (list(collected), [])}
rank_calls = []


def fake_rank(t, candidates, s):
    rank_calls.append([c.title for c in candidates])
    scores = {"c4": 8, "c5": 5, "c6": 7}
    return [summarize.RankedItem(candidate=c, summary=f"sum {c.title}", score=scores[c.title]) for c in candidates]


summarize.rank_topic = fake_rank
state = {
    "old": entry(tooling=verdict(7, rubric, queued_at=(now - timedelta(hours=2)).isoformat())),
    dedupe.url_hash("https://example.com/c2"): entry(tooling=verdict(3, rubric)),
    dedupe.url_hash("https://example.com/c3"): entry(tooling=verdict(9, rubric, summary="cached c3")),
}
queue = pending.PendingQueue(last_email_at=None, items=[])
writer = events.EventWriter("task3", runs_dir=tmp)
result = pipeline.process_topic(topic, state, queue, settings, now, writer)
writer.close()

assert rank_calls == [["c4", "c5", "c6"]], rank_calls
assert [i.candidate.title for i in result.kept] == ["c3", "c4"], result.kept
assert [i.candidate.title for i in result.over_cap] == ["c6"], result.over_cap
assert [i.candidate.title for i in result.below] == ["c5"], result.below
assert [(d.title, d.reason) for d in result.cached_below] == [("c2", "already_ranked")]
assert result.queued_before == 1
assert [(i.title, i.summary, i.score) for i in queue.items] == [("c3", "cached c3", 9), ("c4", "sum c4", 8)]


def ranks(title):
    return state[dedupe.url_hash(f"https://example.com/{title}")].ranks["tooling"]


assert ranks("c3").queued_at == now.isoformat() and ranks("c4").queued_at == now.isoformat()
assert (ranks("c4").relevance, ranks("c4").rubric) == (8, rubric)
assert (ranks("c6").relevance, ranks("c6").queued_at) == (7, None)
assert ranks("c5").relevance == 5 and ranks("c2").relevance == 3

run_events = events.read_events(writer.path)
drops = [(e["stage"], e["reason"], e["title"]) for e in run_events if e["event"] == "drop"]
assert drops == [("dedupe", "already_ranked", "c2"), ("rank", "below_relevance", "c5"),
                 ("rank", "over_max_items", "c6")], drops
over = next(e for e in run_events if e.get("reason") == "over_max_items")
assert over["detail"] == {"max_items_per_day": 3, "queued_last_24h": 1}, over
assert [e["title"] for e in run_events if e["event"] == "kept"] == ["c3", "c4"]

f = funnel.compute_funnel(run_events)["topics"]["tooling"]
assert (f["collected"], f["in_window"], f["new"], f["scored"], f["kept"]) == (5, 5, 4, 3, 2), f
status = status_export.build_status(run_events, {"tooling": "Tooling"}, queue, 24, 4, None, now)
assert status["funnel"]["tooling"] == {"collected": 5, "in_window": 5, "new": 4, "kept": 2}, status["funnel"]

# --- a second run an hour later: nothing re-ranked, cap already full ---
later = now + timedelta(hours=1)
writer = events.EventWriter("task3b", runs_dir=tmp)
result = pipeline.process_topic(topic, state, queue, settings, later, writer)
writer.close()
assert rank_calls[1:] in ([], [[]]), rank_calls   # to_rank is empty
assert result.queued_before == 3 and result.kept == []
assert [i.candidate.title for i in result.over_cap] == ["c6"]
assert sorted(d.title for d in result.cached_below) == ["c2", "c5"]

print("OK")
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `py -3 - < .superpowers/sdd/2026-09-30-topic-source-quality/task3-check.py`
Expected: `ImportError: cannot import name 'pipeline' from 'agent'`

- [ ] **Step 3: Add `RankRecord` and `StateEntry.ranks` to `agent/dedupe.py`**

Replace the module docstring's first sentence

```
"""Persistent seen-URL state: hashes, first-seen dates, score history,
send counts, and inbox dismissals.
```

with

```
"""Persistent seen-URL state: hashes, first-seen dates, score history,
send counts, inbox dismissals, and per-topic ranking verdicts (`ranks`,
read and written by agent/rank_cache.py).
```

(the rest of the docstring stays). Change `from dataclasses import asdict, dataclass` to `from dataclasses import asdict, dataclass, field`. Replace the `StateEntry` dataclass and `load_state` with:

```python
@dataclass
class RankRecord:
    """One topic's cached verdict on one URL — see agent/rank_cache.py."""

    relevance: int  # 1-10
    summary: str
    rubric: str  # summarize.rubric_hash at scoring time
    source_score: int | None  # HN points / GitHub stars at scoring time
    ranked_at: str  # ISO 8601
    queued_at: str | None = None  # set when this topic put the item in the pending queue


@dataclass
class StateEntry:
    first_seen: str  # ISO 8601
    last_score: int | None
    times_sent: int
    dismissed: str | None = None  # "rejected" | "expired" -- set by the inbox, never cleared
    ranks: dict[str, RankRecord] = field(default_factory=dict)  # topic slug -> verdict


def url_hash(url: str) -> str:
    return hashlib.sha256(url.encode("utf-8")).hexdigest()[:16]


def _entry_from_raw(value: dict) -> StateEntry:
    ranks = {slug: RankRecord(**record) for slug, record in value.get("ranks", {}).items()}
    return StateEntry(**{**value, "ranks": ranks})


def load_state(path: Path) -> dict[str, StateEntry]:
    if not path.exists():
        return {}
    raw = json.loads(path.read_text(encoding="utf-8"))
    return {key: _entry_from_raw(value) for key, value in raw.items()}
```

(`url_hash` is unchanged — it's shown because it sits between the two. `save_state` stays as is: `asdict` converts the nested `RankRecord`s.)

- [ ] **Step 4: Create `agent/rank_cache.py`**

```python
"""Per-(URL, topic) verdict cache and the rolling daily cap. A topic
scores an item once; the verdict is reused until the topic's rubric
changes or the item's points/stars grow enough to deserve a second look
(the `attention` block in defaults.yaml). Pure functions over the dedupe
state -- no I/O."""

from __future__ import annotations

from datetime import datetime, timedelta

from agent.dedupe import RankRecord, StateEntry, url_hash
from agent.sources.base import Candidate, Drop, TopicConfig
from agent.summarize import RankedItem

QUEUE_WINDOW = timedelta(hours=24)


def is_valid(record: RankRecord, candidate: Candidate, rubric: str, topic: TopicConfig) -> bool:
    """A verdict holds unless the rubric changed or the item grew: its
    score at least doubled and rose by attention_min_score_gain. Both
    conditions, so 35 -> 85 HN points counts and 300 -> 350 stars doesn't."""
    if record.rubric != rubric:
        return False
    if not topic.attention_enabled:
        return True
    previous, current = record.source_score, candidate.score
    if previous is None or current is None:
        return True
    grew = current >= 2 * previous and current - previous >= topic.attention_min_score_gain
    return not grew


def partition(
    candidates: list[Candidate], state: dict[str, StateEntry], topic: TopicConfig, rubric: str
) -> tuple[list[Candidate], list[RankedItem], list[Drop]]:
    """Split candidates into (to_rank, cached, drops): no valid verdict ->
    to_rank; a valid verdict below min_relevance -> an already_ranked
    drop; a valid verdict at or above it (it lost to the daily cap
    before) -> cached, reused as-is. min_relevance is read live, so
    changing it needs no re-scoring."""
    to_rank: list[Candidate] = []
    cached: list[RankedItem] = []
    drops: list[Drop] = []
    for candidate in candidates:
        entry = state.get(url_hash(candidate.url))
        verdict = entry.ranks.get(topic.slug) if entry is not None else None
        if verdict is None or not is_valid(verdict, candidate, rubric, topic):
            to_rank.append(candidate)
        elif verdict.relevance < topic.min_relevance:
            drops.append(
                Drop(
                    url=candidate.url,
                    title=candidate.title,
                    reason="already_ranked",
                    detail={"relevance": verdict.relevance},
                )
            )
        else:
            cached.append(RankedItem(candidate=candidate, summary=verdict.summary, score=verdict.relevance))
    return to_rank, cached, drops


def record(
    state: dict[str, StateEntry], ranked: list[RankedItem], slug: str, rubric: str, now: datetime
) -> None:
    """Cache fresh verdicts. Every ranked item was collected this run, so
    record_seen has already created its state entry. Failed rankings
    aren't cached -- they're retried next run."""
    for item in ranked:
        if item.failed:
            continue
        state[url_hash(item.candidate.url)].ranks[slug] = RankRecord(
            relevance=item.score,
            summary=item.summary,
            rubric=rubric,
            source_score=item.candidate.score,
            ranked_at=now.isoformat(),
        )


def queued_in_last_24h(state: dict[str, StateEntry], slug: str, now: datetime) -> int:
    count = 0
    for entry in state.values():
        verdict = entry.ranks.get(slug)
        if verdict is not None and verdict.queued_at is not None:
            if now - datetime.fromisoformat(verdict.queued_at) < QUEUE_WINDOW:
                count += 1
    return count


def select(eligible: list[RankedItem], remaining: int) -> tuple[list[RankedItem], list[RankedItem]]:
    """Best first -- relevance, then points/stars -- split at the cap."""
    ordered = sorted(eligible, key=lambda item: (item.score, item.candidate.score or 0), reverse=True)
    return ordered[:remaining], ordered[remaining:]


def mark_queued(state: dict[str, StateEntry], items: list[RankedItem], slug: str, now: datetime) -> None:
    for item in items:
        state[url_hash(item.candidate.url)].ranks[slug].queued_at = now.isoformat()
```

- [ ] **Step 5: Create `agent/pipeline.py`**

```python
"""One topic's pass through the pipeline -- collect, recency window,
dedupe, verdict cache, rank, daily cap, queue -- shared by the real run
and --preview. Mutates the state and queue it's given; the caller decides
whether to save them."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from agent import date_guard, dedupe, pending, rank_cache, summarize
from agent.config import Settings
from agent.dedupe import StateEntry
from agent.pending import PendingQueue
from agent.sources import github_trending, hn
from agent.sources.base import Drop, TopicConfig
from agent.summarize import RankedItem

CONNECTORS = {
    "hacker_news": hn.collect,
    "github_trending": github_trending.collect,
}


@dataclass
class TopicResult:
    kept: list[RankedItem]  # queued this run
    over_cap: list[RankedItem]  # at or above threshold, over the daily cap; eligible again next run
    below: list[RankedItem]  # freshly scored below min_relevance
    cached_below: list[Drop]  # already_ranked: a cached verdict below min_relevance
    queued_before: int  # this topic's items queued in the 24h before this pass


def process_topic(
    topic: TopicConfig,
    state: dict[str, StateEntry],
    queue: PendingQueue,
    settings: Settings,
    now: datetime,
    writer,
) -> TopicResult:
    all_candidates = []
    for source_name, connector in CONNECTORS.items():
        if source_name not in topic.sources:
            continue
        try:
            candidates, drops = connector(topic, now)
        except Exception as exc:  # noqa: BLE001 — one source failing must not abort the topic or the run
            writer.emit("collect", "failed", topic=topic.slug, source=source_name, detail={"error": str(exc)})
            print(f"{source_name} collection failed for {topic.slug}: {exc}")
            continue
        for candidate in candidates:
            writer.emit_candidate("collect", source_name, topic.slug, candidate)
            dedupe.record_seen(state, candidate, now)
        for drop in drops:
            writer.emit_drop("collect", topic.slug, drop)
        all_candidates.extend(candidates)

    kept, drops = date_guard.apply_recency_window(all_candidates, topic.max_age_days, now)
    for drop in drops:
        writer.emit_drop("date_guard", topic.slug, drop)

    kept, drops = dedupe.filter_seen(kept, state)
    for drop in drops:
        writer.emit_drop("dedupe", topic.slug, drop)

    kept, drops = pending.filter_already_pending(kept, queue)
    for drop in drops:
        writer.emit_drop("dedupe", topic.slug, drop)

    rubric = summarize.rubric_hash(topic, settings)
    to_rank, cached, cached_below = rank_cache.partition(kept, state, topic, rubric)
    for drop in cached_below:
        writer.emit_drop("dedupe", topic.slug, drop)

    fresh = summarize.rank_topic(topic, to_rank, settings)
    rank_cache.record(state, fresh, topic.slug, rubric, now)

    eligible = list(cached)
    below: list[RankedItem] = []
    for item in fresh:
        (eligible if item.score >= topic.min_relevance else below).append(item)
    for item in below:
        writer.emit_drop(
            "rank",
            topic.slug,
            Drop(
                url=item.candidate.url,
                title=item.candidate.title,
                reason="below_relevance",
                detail={"score": item.score, "min_relevance": topic.min_relevance},
            ),
        )

    queued_before = rank_cache.queued_in_last_24h(state, topic.slug, now)
    remaining = max(0, topic.max_items_per_day - queued_before)
    keep, over_cap = rank_cache.select(eligible, remaining)
    for item in over_cap:
        writer.emit_drop(
            "rank",
            topic.slug,
            Drop(
                url=item.candidate.url,
                title=item.candidate.title,
                reason="over_max_items",
                detail={"max_items_per_day": topic.max_items_per_day, "queued_last_24h": queued_before},
            ),
        )
    for item in keep:
        writer.emit(
            "rank",
            "kept",
            topic=topic.slug,
            source=item.candidate.source,
            url=item.candidate.url,
            title=item.candidate.title,
            score=item.score,
        )

    rank_cache.mark_queued(state, keep, topic.slug, now)
    pending.add_kept(queue, topic.name, keep, now)
    return TopicResult(
        kept=keep, over_cap=over_cap, below=below, cached_below=cached_below, queued_before=queued_before
    )
```

- [ ] **Step 6: Rename the cap and document the new drop reason**

`agent/sources/base.py`:
- `Drop.reason` comment → `# undated | outside_window | below_min_points | seen | dismissed | already_ranked | below_relevance | over_max_items | rejected | expired`
- In `TopicConfig`, replace `max_items: int` with `max_items_per_day: int  # rolling 24h cap on items this topic adds to the queue`

`agent/config.py`, in `load_topics`: replace `max_items=merged["max_items"],` with `max_items_per_day=merged["max_items_per_day"],`

`agent/defaults.yaml`: replace `max_items: 8` with

```yaml
max_items_per_day: 3 # per topic, rolling 24h; items over the cap stay eligible for later runs
```

`agent/topics/ai-engineering.yaml`: after the `description:` block, add

```yaml
max_items_per_day: 4
```

- [ ] **Step 7: Use the pipeline from `agent/main.py`**

Replace the two import lines

```python
from agent import config, dedupe, date_guard, deliver, digest, events, inbox, pending, status_export, summarize
from agent.sources import github_trending, hn
from agent.sources.base import Drop
```

with

```python
from agent import config, dedupe, date_guard, deliver, digest, events, inbox, pending, pipeline, status_export
```

Delete the `CONNECTORS = {...}` block (it now lives in `agent/pipeline.py`). In `run_dry`, change `for source_name, connector in CONNECTORS.items():` to `for source_name, connector in pipeline.CONNECTORS.items():`.

In `run_real`, replace the whole `for topic in topics:` loop — from `    for topic in topics:` down to and including `        pending.add_kept(queue, topic.name, keep, now)` — with:

```python
    for topic in topics:
        pipeline.process_topic(topic, state, queue, settings, now, writer)
```

- [ ] **Step 8: Count every dedupe-stage reason in the local panel's funnel**

`agent/funnel.py`: replace `entry["new"] = entry["in_window"] - drops.get("seen", 0)` with

```python
        entry["new"] = (
            entry["in_window"]
            - drops.get("seen", 0)
            - drops.get("dismissed", 0)
            - drops.get("already_ranked", 0)
        )
```

`agent/panel_page.html`: replace `t.new = t.in_window - (t.drops.seen || 0);` with

```js
      t.new = t.in_window - (t.drops.seen || 0) - (t.drops.dismissed || 0) - (t.drops.already_ranked || 0);
```

- [ ] **Step 9: Run the verification scripts**

Run: `py -3 - < .superpowers/sdd/2026-09-30-topic-source-quality/task3-check.py`
Expected: `OK`
Run: `py -3 - < .superpowers/sdd/2026-09-30-topic-source-quality/task2-check.py` and `... task1-check.py`
Expected: `OK` twice.
Run: `grep -n "max_items\b\|CONNECTORS\|already_ranked" agent/*.py agent/panel_page.html`
Expected: no bare `max_items` left (only `max_items_per_day` / `over_max_items`); `CONNECTORS` only in `pipeline.py` and `main.py`'s `run_dry`.

- [ ] **Step 10: Live smoke check of the real-run path without DeepSeek or delivery**

Run: `GITHUB_TOKEN=$(gh auth token) py -3 -m agent --dry-run`
Expected: three funnels print, no errors. (`run_real` itself needs `DEEPSEEK_API_KEY` and would deliver — it's exercised live only in Task 5.)

- [ ] **Step 11: Update the status line**

In `PROGRESS.md`'s sub-project #6 bullet:
- `Task 2 of 5 done.` → `Task 3 of 5 done.`
- `Latest:` → `Latest: verdict cache per (URL, topic) in state.json, re-scored on growth or rubric change; rolling 24h cap per topic (3; AI Engineering 4); per-topic pass moved to agent/pipeline.py.`
- `Next:` → `Next: Task 4 (--preview and report).`

- [ ] **Step 12: Commit**

```bash
git add agent/dedupe.py agent/rank_cache.py agent/pipeline.py agent/main.py agent/sources/base.py agent/config.py agent/defaults.yaml agent/topics/ai-engineering.yaml agent/funnel.py agent/panel_page.html PROGRESS.md
git commit -m "Score each item once per topic and cap the queue per day

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: `--preview` and `report`

**Files:**
- Modify: `agent/events.py` (`MemoryWriter`)
- Modify: `agent/pipeline.py` (`format_preview`)
- Modify: `agent/main.py` (`_load_topics`, `run_preview`, `main()`)
- Create: `agent/report.py`
- Modify: `PROGRESS.md`
- Throwaway: `.superpowers/sdd/2026-09-30-topic-source-quality/task4-check.py`

**Interfaces:**
- Consumes: `pipeline.process_topic`, `pipeline.TopicResult`, `rank_cache` (Task 3); `dedupe.RankRecord`, `StateEntry.ranks` (Task 3).
- Produces:
  - `events.MemoryWriter()` — `.events: list[dict]`, `.path = None`, same `emit`/`emit_candidate`/`emit_drop`/`close` as `EventWriter`, never touches disk.
  - `pipeline.format_preview(topic: TopicConfig, result: TopicResult) -> str`
  - `main.run_preview(topic_filter: str | None) -> None`; CLI `python -m agent --preview [--topic SLUG]` (mutually exclusive with `--dry-run`)
  - `report.build_report(state: dict[str, StateEntry], topic_names: dict[str, str], now: datetime, days: int) -> str`
  - `report.run_report(argv: list[str]) -> None`; CLI `python -m agent report [--days N]`

- [ ] **Step 1: Write the verification script (it must fail first)**

Create `.superpowers/sdd/2026-09-30-topic-source-quality/task4-check.py`:

```python
import contextlib
import io
import json
import sys
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

from agent import config, dedupe, events, inbox, main, pipeline, report, summarize
from agent.sources.base import Candidate, Drop

now = datetime(2026, 9, 30, 12, 0, tzinfo=timezone.utc)
topics = {t.slug: t for t in config.load_topics(Path("agent/topics"), Path("agent/defaults.yaml"))}
tmp = Path(tempfile.mkdtemp())

# --- MemoryWriter keeps events in memory only ---
writer = events.MemoryWriter()
writer.emit("rank", "kept", topic="tooling", title="x")
writer.emit_drop("dedupe", "tooling", Drop(url="u", title="t", reason="already_ranked", detail={"relevance": 3}))
writer.close()
assert writer.path is None
assert [(e["stage"], e["event"]) for e in writer.events] == [("rank", "kept"), ("dedupe", "drop")]


def cand(title, source="hn"):
    return Candidate(url=f"https://example.com/{title}", title=title, source=source, topic="tooling",
                     published_at=datetime.now(timezone.utc), score=40, excerpt=None)


def ranked(title, score, summary="sum"):
    return summarize.RankedItem(candidate=cand(title), summary=f"{summary} {title}", score=score)


# --- format_preview shows every verdict ---
text = pipeline.format_preview(topics["tooling"], pipeline.TopicResult(
    kept=[ranked("Kept A", 8)], over_cap=[ranked("Over B", 7)], below=[ranked("Low C", 3), ranked("Low D", 5)],
    cached_below=[Drop(url="u", title="Cached E", reason="already_ranked", detail={"relevance": 2})],
    queued_before=1,
))
assert "== Tooling (tooling)" in text and "cap 3/day, 1 queued in the last 24h" in text, text
for verdict, title in [("queue", "Kept A"), ("over cap", "Over B"), ("below", "Low C"), ("cached-below", "Cached E")]:
    assert any(line.lstrip().startswith(verdict) and title in line for line in text.splitlines()), (verdict, text)
assert text.index("Low D") < text.index("Low C"), "below rows sorted by score, highest first"
assert "sum Kept A" in text
empty = pipeline.format_preview(topics["tooling"], pipeline.TopicResult([], [], [], [], 0))
assert "(nothing to score)" in empty

# --- run_preview: real pipeline, fake source and ranker, writes nothing ---
state_path, pending_path, status_path = tmp / "state.json", tmp / "pending.json", tmp / "status.json"
state_path.write_text(json.dumps({}), encoding="utf-8")
pending_path.write_text(json.dumps({"last_email_at": None, "items": []}), encoding="utf-8")
main.STATE_PATH, main.PENDING_PATH, main.STATUS_PATH = state_path, pending_path, status_path
before = {p.name: p.read_bytes() for p in tmp.iterdir()}
pipeline.CONNECTORS = {
    "hacker_news": lambda t, n: ([cand("Alpha"), cand("Beta")], []),
    "github_trending": lambda t, n: ([], []),
}
summarize.rank_topic = lambda t, cs, s: [
    summarize.RankedItem(candidate=c, summary=f"sum {c.title}", score=9 if c.title == "Alpha" else 2) for c in cs
]


def no_inbox(*args, **kwargs):
    raise AssertionError("preview must not read the inbox")


inbox.load_decisions = no_inbox
out = io.StringIO()
with contextlib.redirect_stdout(out):
    main.run_preview("tooling")
printed = out.getvalue()
assert "== Tooling (tooling)" in printed and "Alpha" in printed and "Beta" in printed, printed
assert "Preview only: nothing was written." in printed
assert {p.name: p.read_bytes() for p in tmp.iterdir()} == before, "preview wrote a file"

# --- CLI: --dry-run and --preview are mutually exclusive ---
sys.argv = ["agent", "--dry-run", "--preview"]
with contextlib.redirect_stderr(io.StringIO()):
    try:
        main.main()
    except SystemExit as exc:
        assert exc.code == 2
    else:
        raise AssertionError("--dry-run --preview was accepted")


# --- report ---
def entry(times_sent=0, dismissed=None, **ranks):
    return dedupe.StateEntry(first_seen=now.isoformat(), last_score=1, times_sent=times_sent,
                             dismissed=dismissed, ranks=dict(ranks))


def verdict(relevance, ranked_days_ago, queued_days_ago=None):
    queued = None if queued_days_ago is None else (now - timedelta(days=queued_days_ago)).isoformat()
    return dedupe.RankRecord(relevance=relevance, summary="s", rubric="r", source_score=1,
                             ranked_at=(now - timedelta(days=ranked_days_ago)).isoformat(), queued_at=queued)


state = {
    "sent": entry(times_sent=1, tooling=verdict(8, 2, 2)),
    "rejected": entry(dismissed="rejected", tooling=verdict(7, 1, 1)),
    "expired": entry(dismissed="expired", tooling=verdict(6, 3, 3)),
    "pending": entry(tooling=verdict(9, 0, 0)),
    "low": entry(tooling=verdict(3, 1)),
    "ancient": entry(times_sent=1, tooling=verdict(8, 20, 20)),
    "ai": entry(**{"ai-engineering": verdict(5, 1)}),
}
text = report.build_report(state, {"ai-engineering": "AI Engineering", "tooling": "Tooling"}, now, 14)
lines = text.splitlines()
assert lines[0] == "Last 14 days (since 2026-09-16)", lines[0]
tooling_at = lines.index("Tooling (tooling)")
assert lines[tooling_at + 1] == "  queued 4: sent 1, rejected 1, expired 1, pending 1", lines[tooling_at + 1]
assert lines[tooling_at + 2] == "  relevance 1:0 2:0 3:1 4:0 5:0 6:1 7:1 8:1 9:1 10:0", lines[tooling_at + 2]
ai_at = lines.index("AI Engineering (ai-engineering)")
assert lines[ai_at + 1] == "  queued 0: sent 0, rejected 0, expired 0, pending 0"
assert lines[ai_at + 2] == "  relevance 1:0 2:0 3:0 4:0 5:1 6:0 7:0 8:0 9:0 10:0"

print("OK")
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `py -3 - < .superpowers/sdd/2026-09-30-topic-source-quality/task4-check.py`
Expected: `ImportError: cannot import name 'report' from 'agent'`

- [ ] **Step 3: Add `MemoryWriter` to `agent/events.py`**

Append:

```python
class MemoryWriter(EventWriter):
    """Same interface as EventWriter, but keeps events in memory and never
    touches disk -- for --preview, which must write nothing."""

    def __init__(self) -> None:  # deliberately skips EventWriter.__init__: no file
        self.path = None
        self.events: list[dict] = []

    def emit(self, stage: str, event: str, **fields: Any) -> None:
        self.events.append(
            {"ts": datetime.now(timezone.utc).isoformat(), "stage": stage, "event": event, **fields}
        )

    def close(self) -> None:
        pass
```

- [ ] **Step 4: Add `format_preview` to `agent/pipeline.py`**

Append:

```python
PREVIEW_TITLE_CHARS = 90


def format_preview(topic: TopicConfig, result: TopicResult) -> str:
    """One row per item and verdict, summaries indented below -- what a
    real run would queue, and why the rest wouldn't be."""
    lines = [
        f"\n== {topic.name} ({topic.slug}) -- cap {topic.max_items_per_day}/day, "
        f"{result.queued_before} queued in the last 24h"
    ]
    rows = (
        [("queue", item) for item in result.kept]
        + [("over cap", item) for item in result.over_cap]
        + [("below", item) for item in sorted(result.below, key=lambda i: i.score, reverse=True)]
    )
    for verdict, item in rows:
        lines.append(
            f"  {verdict:<12} {item.score:>2}  {item.candidate.source:<6}  "
            f"{item.candidate.title[:PREVIEW_TITLE_CHARS]}"
        )
        lines.append(f"  {'':<12}     {item.summary}")
    for drop in result.cached_below:
        lines.append(f"  {'cached-below':<12} {drop.detail['relevance']:>2}  {'':<6}  {drop.title[:PREVIEW_TITLE_CHARS]}")
    if len(lines) == 1:
        lines.append("  (nothing to score)")
    return "\n".join(lines)
```

- [ ] **Step 5: Add `run_preview`, a shared topic loader, and the new CLI to `agent/main.py`**

Add, after the path constants:

```python
def _load_topics(topic_filter: str | None) -> list:
    topics = config.load_topics(TOPICS_DIR, DEFAULTS_PATH)
    if topic_filter:
        topics = [t for t in topics if t.slug == topic_filter]
        if not topics:
            print(f"No topic named {topic_filter!r}", file=sys.stderr)
            sys.exit(1)
    return topics
```

In both `run_dry` and `run_real`, replace

```python
    topics = config.load_topics(TOPICS_DIR, DEFAULTS_PATH)
    if topic_filter:
        topics = [t for t in topics if t.slug == topic_filter]
        if not topics:
            print(f"No topic named {topic_filter!r}", file=sys.stderr)
            sys.exit(1)
```

with `    topics = _load_topics(topic_filter)`. (In `run_real`, the later `all_topics = config.load_topics(TOPICS_DIR, DEFAULTS_PATH)` for `status.json` stays — it deliberately loads every topic.)

Add, after `run_real`:

```python
def run_preview(topic_filter: str | None) -> None:
    """Collect and rank exactly like a real run, against in-memory copies
    of state.json and pending.json, and print what would be queued.
    Writes nothing, reads no inbox, delivers nothing. Copy state.json and
    pending.json from the agent-data branch first for a realistic run."""
    now = datetime.now(timezone.utc)
    settings = config.load_settings(DEFAULTS_PATH)
    topics = _load_topics(topic_filter)
    state = dedupe.load_state(STATE_PATH)
    queue = pending.load_pending(PENDING_PATH)
    writer = events.MemoryWriter()
    for topic in topics:
        result = pipeline.process_topic(topic, state, queue, settings, now, writer)
        print(pipeline.format_preview(topic, result))
    print("\nPreview only: nothing was written.")
```

Replace `main()` with:

```python
def main() -> None:
    if len(sys.argv) > 1 and sys.argv[1] == "panel":
        from agent.panel import run_panel

        run_panel()
        return
    if len(sys.argv) > 1 and sys.argv[1] == "report":
        from agent.report import run_report

        run_report(sys.argv[2:])
        return

    parser = argparse.ArgumentParser(prog="python -m agent")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--dry-run", action="store_true")
    mode.add_argument("--preview", action="store_true")
    parser.add_argument("--topic", default=None)
    args = parser.parse_args()

    config.load_env(AGENT_DIR / ".env")

    if args.dry_run:
        run_dry(args.topic)
    elif args.preview:
        run_preview(args.topic)
    else:
        run_real(args.topic)
```

Update the module docstring to `"""Entry point: python -m agent [--dry-run | --preview] [--topic SLUG] | panel | report [--days N]"""`.

- [ ] **Step 6: Create `agent/report.py`**

```python
"""Queue outcomes and score distribution per topic, from state.json --
python -m agent report [--days N]. For tuning min_relevance and the daily
caps against what Artem actually approves. Reads the local
agent/state.json: copy it from the agent-data branch first. Only items
queued since sub-project #6 carry a topic (ranks[slug].queued_at), so
older ones don't appear."""

from __future__ import annotations

import argparse
from collections import Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path

from agent import config, dedupe
from agent.dedupe import StateEntry

AGENT_DIR = Path(__file__).parent


def build_report(state: dict[str, StateEntry], topic_names: dict[str, str], now: datetime, days: int) -> str:
    since = now - timedelta(days=days)
    lines = [f"Last {days} days (since {since.date().isoformat()})"]
    for slug, name in topic_names.items():
        outcomes: Counter[str] = Counter()
        histogram: Counter[int] = Counter()
        for entry in state.values():
            verdict = entry.ranks.get(slug)
            if verdict is None:
                continue
            if datetime.fromisoformat(verdict.ranked_at) >= since:
                histogram[verdict.relevance] += 1
            if verdict.queued_at is not None and datetime.fromisoformat(verdict.queued_at) >= since:
                outcomes["queued"] += 1
                if entry.times_sent > 0:
                    outcomes["sent"] += 1
                elif entry.dismissed is not None:
                    outcomes[entry.dismissed] += 1  # "rejected" | "expired"
                else:
                    outcomes["pending"] += 1
        lines.append("")
        lines.append(f"{name} ({slug})")
        lines.append(
            f"  queued {outcomes['queued']}: sent {outcomes['sent']}, rejected {outcomes['rejected']}, "
            f"expired {outcomes['expired']}, pending {outcomes['pending']}"
        )
        lines.append("  relevance " + " ".join(f"{score}:{histogram[score]}" for score in range(1, 11)))
    return "\n".join(lines)


def run_report(argv: list[str]) -> None:
    parser = argparse.ArgumentParser(prog="python -m agent report")
    parser.add_argument("--days", type=int, default=14)
    args = parser.parse_args(argv)
    state_path = AGENT_DIR / "state.json"
    if not state_path.exists():
        raise SystemExit(f"{state_path} not found -- copy it from the agent-data branch first")
    topics = config.load_topics(AGENT_DIR / "topics", AGENT_DIR / "defaults.yaml")
    state = dedupe.load_state(state_path)
    print(build_report(state, {t.slug: t.name for t in topics}, datetime.now(timezone.utc), args.days))
```

- [ ] **Step 7: Run the verification scripts**

Run: `py -3 - < .superpowers/sdd/2026-09-30-topic-source-quality/task4-check.py`
Expected: `OK`
Run: `py -3 - < .superpowers/sdd/2026-09-30-topic-source-quality/task3-check.py`, then `task2-check.py`, then `task1-check.py`
Expected: `OK` three times.
Run: `py -3 -m agent report --days 14`
Expected: prints `Last 14 days (…)` and three topic blocks (all zeros against the local `state.json` from the Task 1/3 dry runs, which has no `ranks`).

- [ ] **Step 8: Update the status line**

In `PROGRESS.md`'s sub-project #6 bullet:
- `Task 3 of 5 done.` → `Task 4 of 5 done.`
- `Latest:` → `Latest: python -m agent --preview (collect + rank, writes nothing) and python -m agent report (queue outcomes, score histogram).`
- `Next:` → `Next: Task 5 (live preview and criteria tuning with Artem, docs, merge, push, live check). Needs DEEPSEEK_API_KEY in the worktree's agent/.env.`

- [ ] **Step 9: Commit**

```bash
git add agent/events.py agent/pipeline.py agent/main.py agent/report.py PROGRESS.md
git commit -m "Add a write-nothing --preview mode and a queue-outcome report

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Live preview and tuning, docs, merge, push, live check

**Files:**
- Modify (tuning, as needed): `agent/topics/*.yaml`
- Modify: `docs/agent-plan.md`, `app/researcher/agent/page.tsx`, `lib/topics.ts`, `CLAUDE.md`, `PROGRESS.md`
- External: push to `hpnssflw/hpnssflw.github.io` `main`; one `workflow_dispatch` run of `agent-run.yml`

**Interfaces:**
- Consumes: everything from Tasks 1–4.
- Produces: the live feature.

- [ ] **Step 1: Artem adds the DeepSeek key (manual — Claude cannot do this)**

Ask Artem to create `C:\A\polozov\.claude\worktrees\tony-scraponi\agent\.env` (git-ignored) with one line, `DEEPSEEK_API_KEY=<his key>`, typed by him — never pasted into the chat. The main checkout's `agent/.env` holds only `TELEGRAM_BOT_TOKEN`; don't copy that one here (preview never delivers, and it isn't needed).

Check without printing the value:

```bash
grep -c '^DEEPSEEK_API_KEY=.\+' agent/.env
```

Expected: `1`.

- [ ] **Step 2: Copy live state and run the preview**

```bash
gh api "repos/hpnssflw/hpnssflw.github.io/contents/agent/state.json?ref=agent-data" -H "Accept: application/vnd.github.raw" > agent/state.json
gh api "repos/hpnssflw/hpnssflw.github.io/contents/agent/pending.json?ref=agent-data" -H "Accept: application/vnd.github.raw" > agent/pending.json
GITHUB_TOKEN=$(gh auth token) PYTHONIOENCODING=utf-8 py -3 -m agent --preview > .superpowers/sdd/2026-09-30-topic-source-quality/preview-1.txt
```

Expected: the file holds three `== …` blocks and ends with `Preview only: nothing was written.`; `git status` shows no tracked file changed. (Retry a `gh api` call once if TLS flakes.)

- [ ] **Step 3: Tune the criteria with Artem (success criterion 1)**

Show Artem each topic's `queue` and `over cap` rows (and the top `below` rows) from the preview file. Ask per topic: are most `queue` rows on-topic? Is anything clearly wrong sitting in `below`? Adjust only `include`/`exclude`/`keywords`/GitHub `topics` in `agent/topics/*.yaml` per his answers, re-run Step 2's last command into `preview-2.txt`, `preview-3.txt`, … and repeat until he says most `queue` rows are on-topic. Don't change `min_relevance` or the caps here — per the spec, those get tuned later from `report` data.

If anything changed:

```bash
git add agent/topics/ai-engineering.yaml agent/topics/tooling.yaml agent/topics/web-products.yaml
git commit -m "Tune topic criteria against a live preview

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 4: Sync the technical plan (`docs/agent-plan.md`)**

In "Topics", replace `- **Tooling** — trending GitHub repos and web development tools.` with

```markdown
- **Tooling** — tools developers use to build software: editors, CLIs,
  libraries, and AI coding tools.

Each topic's YAML also carries `include`/`exclude` criteria, which the
ranker scores against (see Pipeline).
```

In "Sources", replace the first two bullets with

```markdown
- Hacker News — public Algolia search API, matching each topic's keywords
  against story titles only (whole words, no typo tolerance, no prefix
  matching).
- GitHub — GitHub's Search API: recently created repos tagged with one of
  each topic's GitHub topics (`topic:cli`, `topic:llm`, …), ranked by
  stars; every topic uses it.
```

In "Pipeline", replace steps 3 and 4 with

```markdown
3. **Dedupe** — every link's URL gets hashed against a store of what's already been sent or dismissed from the inbox, and against the topic's verdict cache: an item this topic already scored below the threshold isn't sent to the LLM again unless its points/stars at least doubled and grew by `attention.min_score_gain`, or the topic's criteria changed (`rank_cache.py`). Only new links continue.
4. **Rank** — batched LLM calls per topic (at most 40 candidates each) score every uncached candidate 1–10 against the topic's `include`/`exclude` criteria and a short reader profile, returning a one-line summary per item; anything below the threshold is dropped, and at most `max_items_per_day` items per topic enter the queue in any rolling 24 hours — the rest stay eligible for later runs.
```

- [ ] **Step 5: Sync the public plan page (`app/researcher/agent/page.tsx`)**

In the Sources list, replace the Hacker News `<li>`'s text `Hacker News — via the public Algolia search API, filtered to each topic&apos;s keywords.` with `Hacker News — via the public Algolia search API, matching each topic&apos;s keywords against story titles only.` Replace the GitHub `<li>`'s text (`GitHub trending — recently created repos ranked by stars, via GitHub&apos;s Search API; backs the Tooling topic specifically.`) with `GitHub — recently created repos tagged with each topic&apos;s GitHub topics, ranked by stars, via GitHub&apos;s Search API.`

In the Pipeline list, replace the Dedupe `<li>`'s text with `Dedupe — every link&apos;s URL gets hashed against a store of what&apos;s already been sent, and against what&apos;s already been scored for that topic, so the same item isn&apos;t judged again every few hours unless it&apos;s taking off; only new links continue.` Replace the Rank `<li>`'s text with `Rank — each topic&apos;s new links are scored in batches against written include/exclude criteria rather than a one-line description; a one-line summary and score come back per item, anything below the threshold gets dropped, and only a few items per topic a day go into the queue — the rest wait their turn.`

In the Status paragraph, replace `the pipeline runs end to end on Hacker News alone, on a` with `the pipeline runs end to end on Hacker News and GitHub, on a`.

Keep the JSX structure and wrapping style of the surrounding lines.

- [ ] **Step 6: Tooling gloss, rollback note, roadmap/PROGRESS**

`lib/topics.ts`: replace `gloss: "trending GitHub repos, web development tools.",` with `gloss: "developer tools: editors, CLIs, libraries, AI coding tools.",`

`CLAUDE.md`, in the tony-inbox bullet, after `` `TypeError` on it.`` add:

```markdown
  The same goes for `StateEntry.ranks` (sub-project #6): once the
  topic-quality code has run, every entry carries `ranks`, so code from
  before #6 can't load `state.json` until that key is stripped.
```

`PROGRESS.md`, sub-project #6 bullet: `Task 4 of 5 done.` → `Task 5 in progress.`; `Latest:` → `Latest: criteria tuned against a live preview; docs synced.`; `Next:` → `Next: Task 5 Steps 7–9 (merge main, push, live check).`

- [ ] **Step 7: Verify the site and the agent, then commit the docs**

Run: `npm test` — Expected: all files pass, 0 failures.
Run: `npm run build` — Expected: success.
Run: the four check scripts (`task1-check.py` … `task4-check.py`) — Expected: `OK` four times.

```bash
git add docs/agent-plan.md app/researcher/agent/page.tsx lib/topics.ts CLAUDE.md PROGRESS.md
git commit -m "Sync agent docs and site copy with topic & source quality

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 8: Bring in `main`, re-verify, push (confirm with Artem first — deploys the site and changes live agent behavior)**

```bash
git fetch origin
git merge origin/main
```

Resolve any conflict (most likely `PROGRESS.md`: keep both sides' entries). Re-run Step 7's checks. Then, after Artem confirms:

```bash
git push origin HEAD:main
gh run list --workflow deploy.yml --limit 1
```

Expected: the push fast-forwards `origin/main` (if rejected as non-fast-forward: fetch, merge, re-check, push again); the Deploy site run ends `success` (`gh run watch <id>`).

- [ ] **Step 9: Live check**

1. `gh workflow run agent-run.yml`, then `gh run list --workflow agent-run.yml --limit 1` and `gh run watch <id>` → `success`. In the run log (`gh run view <id> --log | grep -i "failed"`), expect no `collection failed` lines.
2. Copy the results and check them:

```bash
gh api "repos/hpnssflw/hpnssflw.github.io/contents/agent/state.json?ref=agent-data" -H "Accept: application/vnd.github.raw" > agent/state.json
gh api "repos/hpnssflw/hpnssflw.github.io/contents/agent/status.json?ref=agent-data" -H "Accept: application/vnd.github.raw" > .superpowers/sdd/2026-09-30-topic-source-quality/live-status.json
gh api "repos/hpnssflw/hpnssflw.github.io/contents/agent/pending.json?ref=agent-data" -H "Accept: application/vnd.github.raw" > agent/pending.json
py -3 - <<'PY'
import json
from datetime import datetime, timezone
from pathlib import Path
from agent import dedupe, rank_cache

state = dedupe.load_state(Path("agent/state.json"))
status = json.loads(Path(".superpowers/sdd/2026-09-30-topic-source-quality/live-status.json").read_text(encoding="utf-8"))
now = datetime.now(timezone.utc)
print("entries with ranks:", sum(1 for e in state.values() if e.ranks))
items = json.loads(Path("agent/pending.json").read_text(encoding="utf-8"))["items"]
assert len({i["url"] for i in items}) == len(items), "duplicate URLs in pending.json"
for slug, cap in [("ai-engineering", 4), ("tooling", 3), ("web-products", 3)]:
    queued = rank_cache.queued_in_last_24h(state, slug, now)
    print(slug, "queued in last 24h:", queued, "cap:", cap, "funnel:", status["funnel"][slug])
    assert queued <= cap, slug
PY
py -3 -m agent report --days 1
```

Expected: `entries with ranks` in the hundreds; each topic's queued count ≤ its cap; the report prints per-topic histograms.

3. Tell Artem the queue has new items to moderate on `/researcher/queue/`.

- [ ] **Step 10: Record the ship and hand off the 3-day watch**

`PROGRESS.md`:
- Content Direction status line → `**Status: sub-projects #1-#6 shipped.**`
- Sub-project #6 bullet: `in progress` → `shipped`; replace the `Task 5 in progress.` / `Latest:` / `Next:` lines with `Pushed <date> (<merge sha>); first live run <run timestamp>: <N> verdicts cached, queued per topic <ai-engineering>/<tooling>/<web-products>. Watch for 3 days (spec's success criteria 2–3): items sent to DeepSeek (the scored-per-day line of `python -m agent report`) should drop to single digits per run after the first day, at most 10 queued a day; then run python -m agent report against agent-data's state.json and decide on #7 (Web Products source).` — filled in with the real values from Steps 8–9.
- "How to resume": replace the sentence starting `Sub-project #6 (topic & source quality) is in progress` with `Sub-project #6 (topic & source quality) is shipped; its 3-day watch and the #7 decision are next (see its bullet above).`

`docs/tony-scraponi-roadmap.md` needs no change (it doesn't track status).

```bash
git add PROGRESS.md
git commit -m "Reconcile status docs with topic & source quality shipping

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push origin HEAD:main
```

Expected: fast-forward push.
