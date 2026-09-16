# Agent Themes Rework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the agent's three topics (`ai-agents`/`data-viz`/`full-stack`) with the roadmap's three themes (Web Products, AI Engineering, Tooling), remove dead source config, add a real GitHub-trending connector to back Tooling, and keep the live site's RESEARCHER copy in sync.

**Architecture:** Three new `agent/topics/*.yaml` files replace the old three (same `TopicConfig` shape, no loader changes). A new `agent/sources/github_trending.py` module follows the exact `collect(topic, now) -> (candidates, drops)` contract already established by `agent/sources/hn.py`, and gets registered in `agent/main.py`'s `CONNECTORS` dict. Four already-hardcoded site/doc surfaces get their topic-name copy swapped to match.

**Tech Stack:** Python (agent — `requests`, `pyyaml`, stdlib only, no new deps), Next.js/TypeScript (site — content-only JSX edits), Markdown (docs).

## Global Constraints

- Topic slugs are exactly `web-products`, `ai-engineering`, `tooling` (matches the parenthetical naming in `PROGRESS.md`/`docs/tony-scraponi-roadmap.md`).
- A topic's `sources:` block may only contain keys that `agent/main.py`'s `CONNECTORS` dict actually wires up (`hacker_news`, and after Task 2, `github_trending`) — no more declaring `reddit`/`rss`/`releases`/`web_search`, since nothing reads them.
- `hacker_news.min_points: 30` for all three topics (matches the two surviving old topics' value).
- `github_trending.min_stars: 200` for the Tooling topic.
- New connector uses the GitHub REST **Search API** (`api.github.com/search/repositories`), never HTML scraping of `github.com/trending`.
- `EXCERPT_MAX_CHARS = 280`, matching the existing constant in `agent/sources/hn.py`, for any excerpt truncation in the new connector.
- No new Python dependencies (no pytest). This repo's `agent/` has no committed test suite — every existing connector (`agent/sources/hn.py`) was verified with a throwaway, uncommitted script run against real and mocked data, recorded narratively in `PROGRESS.md`. Follow that same pattern; do not introduce a `tests/` directory or pytest as part of this plan.
- No CSS, component, or layout changes on the site — every site task is a content-only edit to existing JSX/TSX.
- Never stage `.claude/settings.local.json` when committing.
- Verbatim theme copy to reuse everywhere (YAML `description:` fields, `docs/agent-plan.md` bullets, and — in a shorter fragment form — site glosses) comes from `docs/tony-scraponi-roadmap.md`'s "Themes" section; exact strings are given per-task below so there's no drift between the four places this text appears.

---

### Task 1: Replace the three topic YAML files

**Files:**
- Delete: `agent/topics/ai-agents.yaml`, `agent/topics/data-viz.yaml`, `agent/topics/full-stack.yaml`
- Create: `agent/topics/web-products.yaml`, `agent/topics/ai-engineering.yaml`, `agent/topics/tooling.yaml`

**Interfaces:**
- Consumes: `agent.config.load_topics(topics_dir, defaults_path) -> list[TopicConfig]` (existing, unchanged — `agent/config.py`). `TopicConfig` fields used here: `.slug` (from filename stem), `.name`, `.sources` (dict, `agent/sources/base.py`).
- Produces: three `TopicConfig` instances with slugs `web-products`, `ai-engineering`, `tooling`, each `.sources` containing only keys later tasks (and `agent/main.py`'s `CONNECTORS`) know how to read. `tooling`'s `.sources["github_trending"]` is `{"min_stars": 200}` — Task 2's connector reads this exact key/shape.

- [ ] **Step 1: Delete the three old topic files**

```bash
git rm agent/topics/ai-agents.yaml agent/topics/data-viz.yaml agent/topics/full-stack.yaml
```

- [ ] **Step 2: Create `agent/topics/web-products.yaml`**

```yaml
name: Web Products
description: >
  Product and web trends, securities & market data, data visualization,
  browser performance, web architecture, and SEO.
keywords: [web product, market data, data visualization, browser performance, SEO]

sources:
  hacker_news: { min_points: 30 }
```

- [ ] **Step 3: Create `agent/topics/ai-engineering.yaml`**

```yaml
name: AI Engineering
description: >
  Agent and automated pipelines and harnesses, LLM assistants,
  self-hosted/private AI platform development, and LLM/inference
  optimization.
keywords: [agent framework, tool use, evals, MCP, LLM inference, self-hosted AI]

sources:
  hacker_news: { min_points: 30 }
```

- [ ] **Step 4: Create `agent/topics/tooling.yaml`**

```yaml
name: Tooling
description: >
  Trending GitHub repos and web development tools.
keywords: [dev tool, CLI, open source library, developer tooling]

sources:
  hacker_news: { min_points: 30 }
  github_trending: { min_stars: 200 }
```

- [ ] **Step 5: Verify the three topics load correctly (throwaway script, not committed)**

Run from the repo root with the Bash tool:

```bash
python3 - <<'PY'
from pathlib import Path
from agent.config import load_topics

topics = load_topics(Path("agent/topics"), Path("agent/defaults.yaml"))
slugs = sorted(t.slug for t in topics)
assert slugs == ["ai-engineering", "tooling", "web-products"], slugs

by_slug = {t.slug: t for t in topics}
assert by_slug["web-products"].name == "Web Products"
assert by_slug["ai-engineering"].name == "AI Engineering"
assert by_slug["tooling"].name == "Tooling"

for t in topics:
    assert set(t.sources) <= {"hacker_news", "github_trending"}, (t.slug, t.sources)

assert by_slug["tooling"].sources["github_trending"] == {"min_stars": 200}
assert all(t.sources["hacker_news"]["min_points"] == 30 for t in topics)

print("OK")
PY
```

Expected: prints `OK`, no assertion errors.

- [ ] **Step 6: Confirm a full dry run still works with the new topics**

```bash
python -m agent --dry-run
```

Expected: no crash; a funnel block prints for `Web Products`, `AI Engineering`, and `Tooling`, each showing real Hacker News collection numbers (the `github_trending` key in `tooling.yaml` is silently ignored at this point — `agent/main.py`'s `CONNECTORS` dict doesn't have that key yet, and `run_dry`'s loop only iterates over `CONNECTORS.items()`, so this is expected, not a bug to chase).

- [ ] **Step 7: Commit**

```bash
git add agent/topics/web-products.yaml agent/topics/ai-engineering.yaml agent/topics/tooling.yaml
git commit -m "$(cat <<'EOF'
Replace agent topics with Web Products / AI Engineering / Tooling

Drops the old ai-agents/data-viz/full-stack topics and the dead
reddit/rss/releases/web_search source keys that main.py's CONNECTORS
dict never wired up. Matches the three themes in
docs/tony-scraponi-roadmap.md.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

(The `git rm` from Step 1 stages the deletions; the `git add` above stages the new files — both land in this one commit.)

---

### Task 2: Add the GitHub-trending connector

**Files:**
- Create: `agent/sources/github_trending.py`
- Modify: `agent/main.py:12-25` (import + `CONNECTORS` dict)
- Modify: `agent/sources/base.py:17` (the `Candidate.source` comment)

**Interfaces:**
- Consumes: `TopicConfig.sources.get("github_trending")` → `{"min_stars": int} | None` (produced by Task 1's `tooling.yaml`). `TopicConfig.slug`, `.max_age_days` (existing fields, `agent/sources/base.py`).
- Produces: `github_trending.collect(topic: TopicConfig, now: datetime) -> tuple[list[Candidate], list[Drop]]` — same signature as `agent/sources/hn.py`'s `collect`, so `agent/main.py`'s `run_dry`/`run_real` loops (which call every registered connector uniformly) need no changes beyond the one dict entry.

- [ ] **Step 1: Write `agent/sources/github_trending.py`**

```python
"""GitHub trending connector. GitHub has no official "trending" API — the
github.com/trending page is unversioned HTML, not worth scraping — so
this uses the official Search API instead: recently created repos with
enough stars, ranked by stars. That's an approximation of "trending"
(newest repos gaining the most traction), not GitHub's own undisclosed
trending algorithm."""

from __future__ import annotations

import os
from datetime import datetime, timedelta

import requests

from agent.sources.base import Candidate, Drop, TopicConfig

SEARCH_URL = "https://api.github.com/search/repositories"
EXCERPT_MAX_CHARS = 280


def collect(topic: TopicConfig, now: datetime) -> tuple[list[Candidate], list[Drop]]:
    github_config = topic.sources.get("github_trending")
    if github_config is None:
        return [], []
    min_stars = github_config.get("min_stars", 0)
    cutoff = (now - timedelta(days=topic.max_age_days)).date().isoformat()

    headers = {"Accept": "application/vnd.github+json"}
    token = os.environ.get("GITHUB_TOKEN")
    if token:
        headers["Authorization"] = f"Bearer {token}"

    params = {
        "q": f"created:>{cutoff} stars:>={min_stars}",
        "sort": "stars",
        "order": "desc",
        "per_page": 30,
    }
    response = requests.get(SEARCH_URL, params=params, headers=headers, timeout=10)
    response.raise_for_status()

    candidates: list[Candidate] = []
    drops: list[Drop] = []
    for repo in response.json()["items"]:
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
        excerpt = repo.get("description")
        if excerpt:
            excerpt = excerpt[:EXCERPT_MAX_CHARS]
        candidates.append(
            Candidate(
                url=url,
                title=title,
                source="github",
                topic=topic.slug,
                published_at=datetime.fromisoformat(created_at.replace("Z", "+00:00")),
                score=repo.get("stargazers_count"),
                excerpt=excerpt,
            )
        )

    return candidates, drops
```

- [ ] **Step 2: Verify field mapping and the undated-drop path with a mocked response (throwaway script, not committed)**

```bash
python3 - <<'PY'
from datetime import datetime, timezone
from unittest.mock import patch

from agent.sources import github_trending
from agent.sources.base import TopicConfig

topic = TopicConfig(
    slug="tooling", name="Tooling", description="d", keywords=[],
    sources={"github_trending": {"min_stars": 200}},
    max_age_days=10, min_relevance=6, max_items=8,
    attention_enabled=False, attention_min_score_gain=0,
)

fake_items = {
    "items": [
        {
            "html_url": "https://github.com/foo/bar",
            "full_name": "foo/bar",
            "created_at": "2026-09-10T00:00:00Z",
            "stargazers_count": 500,
            "description": "x" * 300,
        },
        {
            "html_url": "https://github.com/baz/qux",
            "full_name": "baz/qux",
            "created_at": None,
            "stargazers_count": 10,
            "description": None,
        },
    ]
}


class FakeResponse:
    def raise_for_status(self):
        pass

    def json(self):
        return fake_items


with patch("agent.sources.github_trending.requests.get", return_value=FakeResponse()):
    now = datetime(2026, 9, 16, tzinfo=timezone.utc)
    candidates, drops = github_trending.collect(topic, now)

assert len(candidates) == 1, candidates
c = candidates[0]
assert c.url == "https://github.com/foo/bar"
assert c.source == "github"
assert c.score == 500
assert len(c.excerpt) == 280
assert c.published_at == datetime(2026, 9, 10, tzinfo=timezone.utc)

assert len(drops) == 1, drops
assert drops[0].reason == "undated"

print("OK")
PY
```

Expected: prints `OK`, no assertion errors.

- [ ] **Step 3: Wire the connector into `agent/main.py`**

In `agent/main.py`, change the import line (currently line 13):

```python
from agent.sources import hn
```

to:

```python
from agent.sources import github_trending, hn
```

And change the `CONNECTORS` dict (currently lines 23-25):

```python
CONNECTORS = {
    "hacker_news": hn.collect,
}
```

to:

```python
CONNECTORS = {
    "hacker_news": hn.collect,
    "github_trending": github_trending.collect,
}
```

- [ ] **Step 4: Update the `Candidate.source` comment in `agent/sources/base.py`**

Change (currently line 17):

```python
    source: str  # hn | reddit | rss | releases | web
```

to:

```python
    source: str  # hn | github | reddit | rss | releases | web
```

- [ ] **Step 5: Live check against real GitHub + HN infrastructure**

```bash
python -m agent --dry-run --topic tooling
```

Expected: no crash; the funnel line shows a non-zero `collected` count (combining real Hacker News results and real GitHub search results — if either API is having a bad day and returns zero, re-run once before treating it as a real failure).

- [ ] **Step 6: Commit**

```bash
git add agent/sources/github_trending.py agent/main.py agent/sources/base.py
git commit -m "$(cat <<'EOF'
Add GitHub-trending connector, wired into Tooling

Uses the official Search API (recent repos ranked by stars) rather
than scraping github.com/trending's unversioned HTML. Gives the
Tooling theme a real second source beyond Hacker News, per the
roadmap's note that Tooling needs at least one real connector to
mean anything.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Sync site and doc copy to the new themes

**Files:**
- Modify: `docs/agent-plan.md:21-27` (Topics section), `docs/agent-plan.md:79` (`GITHUB_TOKEN` line)
- Modify: `app/page.tsx:43-64` (RESEARCHER topics list)
- Modify: `app/researcher/page.tsx:4-13` (metadata), `app/researcher/page.tsx:20-43` (topics list)
- Modify: `app/researcher/agent/page.tsx:4-14` (metadata), `app/researcher/agent/page.tsx:21-25` (subtitle), `app/researcher/agent/page.tsx:33-43` (goal paragraph)

**Interfaces:**
- Consumes: nothing code-level — this task only swaps prose strings to match Task 1's three theme names (`Web Products`, `AI Engineering`, `Tooling`) and their short-form descriptions, defined below.
- Produces: nothing other tasks depend on. This is the last task in the plan.

Short-form site-gloss copy used in this task (distinct from the YAML `description:` fields, which are fuller sentences meant for the LLM ranking prompt — these are short list-item fragments matching the existing site's style, e.g. the old "BI dashboards, browser graphics, render-engine performance."):

- Web Products: `product and web trends, market data, data visualization, browser performance, web architecture, SEO.`
- AI Engineering: `agent and automated pipelines, LLM assistants, self-hosted AI platforms, inference optimization.`
- Tooling: `trending GitHub repos, web development tools.`

- [ ] **Step 1: Update `docs/agent-plan.md`'s Topics section**

Change (currently lines 21-27):

```markdown
## Topics (fixed set, matches the site's RESEARCHER section)

- **Data Viz** — BI dashboards, browser graphics, render-engine performance.
- **Full-Stack Architecture** — trends, architectures, best practices and
  patterns across the modern web stack.
- **AI Agents & Engineering** — trends, architectures and patterns for
  building and running agents in production.
```

to:

```markdown
## Topics (fixed set, matches the site's RESEARCHER section)

- **Web Products** — product and web trends, securities & market data,
  data visualization, browser performance, web architecture, and SEO.
- **AI Engineering** — agent and automated pipelines and harnesses, LLM
  assistants, self-hosted/private AI platform development, and
  LLM/inference optimization.
- **Tooling** — trending GitHub repos and web development tools.
```

- [ ] **Step 2: Update the `GITHUB_TOKEN` line in `docs/agent-plan.md`**

Change (currently line 79):

```markdown
- `GITHUB_TOKEN` — optional; raises the release-watching connector's rate limit.
```

to:

```markdown
- `GITHUB_TOKEN` — optional; raises the GitHub-trending connector's rate
  limit (and, later, the release-watching connector's).
```

- [ ] **Step 3: Update `app/page.tsx`'s topics list**

Change (currently lines 43-64):

```tsx
          <ul className="topics">
            <li>
              <span className="topic-name">Data Viz</span>
              <span className="topic-gloss">
                BI dashboards, browser graphics, render-engine performance.
              </span>
            </li>
            <li>
              <span className="topic-name">Full-Stack Architecture</span>
              <span className="topic-gloss">
                trends, architectures, best practices and patterns across the
                modern web stack.
              </span>
            </li>
            <li>
              <span className="topic-name">AI Agents &amp; Engineering</span>
              <span className="topic-gloss">
                trends, architectures and patterns for building and running
                agents in production.
              </span>
            </li>
          </ul>
```

to:

```tsx
          <ul className="topics">
            <li>
              <span className="topic-name">Web Products</span>
              <span className="topic-gloss">
                product and web trends, market data, data visualization,
                browser performance, web architecture, SEO.
              </span>
            </li>
            <li>
              <span className="topic-name">AI Engineering</span>
              <span className="topic-gloss">
                agent and automated pipelines, LLM assistants, self-hosted
                AI platforms, inference optimization.
              </span>
            </li>
            <li>
              <span className="topic-name">Tooling</span>
              <span className="topic-gloss">
                trending GitHub repos, web development tools.
              </span>
            </li>
          </ul>
```

- [ ] **Step 4: Update `app/researcher/page.tsx`'s metadata**

Change (currently lines 4-13):

```tsx
export const metadata: Metadata = {
  title: "RESEARCHER",
  description: "Data viz, full-stack architecture, and AI agent engineering.",
  openGraph: {
    title: "RESEARCHER — Artem Polozov",
    description: "Data viz, full-stack architecture, and AI agent engineering.",
    type: "website",
    url: "/researcher/",
  },
};
```

to:

```tsx
export const metadata: Metadata = {
  title: "RESEARCHER",
  description: "Web products, AI engineering, and tooling.",
  openGraph: {
    title: "RESEARCHER — Artem Polozov",
    description: "Web products, AI engineering, and tooling.",
    type: "website",
    url: "/researcher/",
  },
};
```

- [ ] **Step 5: Update `app/researcher/page.tsx`'s topics list**

Change (currently lines 20-43):

```tsx
        <ul className="topics">
          <li>
            <span className="topic-name">Data Viz</span>
            <span className="topic-gloss">
              BI dashboards, browser graphics, render-engine performance.
            </span>
          </li>
          <li>
            <span className="topic-name">Full-Stack Architecture</span>
            <span className="topic-gloss">
              trends, architectures, best practices and patterns across the
              modern web stack.
            </span>
          </li>
          <li>
            <Link className="topic-name" href="/researcher/agent/">
              AI Agents &amp; Engineering
            </Link>
            <span className="topic-gloss">
              trends, architectures and patterns for building and running agents
              in production.
            </span>
          </li>
        </ul>
```

to (the `/researcher/agent/` link stays on the third `<li>`, now naming AI Engineering — that link position isn't specific to the old "AI Agents" name, it's just where the plan-page link has always lived in this list):

```tsx
        <ul className="topics">
          <li>
            <span className="topic-name">Web Products</span>
            <span className="topic-gloss">
              product and web trends, market data, data visualization,
              browser performance, web architecture, SEO.
            </span>
          </li>
          <li>
            <span className="topic-name">Tooling</span>
            <span className="topic-gloss">
              trending GitHub repos, web development tools.
            </span>
          </li>
          <li>
            <Link className="topic-name" href="/researcher/agent/">
              AI Engineering
            </Link>
            <span className="topic-gloss">
              agent and automated pipelines, LLM assistants, self-hosted AI
              platforms, inference optimization.
            </span>
          </li>
        </ul>
```

(AI Engineering is kept last, same position "AI Agents & Engineering" held before, since that's the `<li>` carrying the `/researcher/agent/` link — Tooling takes the old Full-Stack slot in the middle.)

- [ ] **Step 6: Update `app/researcher/agent/page.tsx`'s metadata**

Change (currently lines 4-14):

```tsx
export const metadata: Metadata = {
  title: "A Research Agent",
  description:
    "A living plan for a background agent that watches data viz, full-stack architecture, and AI engineering.",
  openGraph: {
    title: "A Research Agent",
    description:
      "A living plan for a background agent that watches data viz, full-stack architecture, and AI engineering.",
    type: "article",
  },
};
```

to:

```tsx
export const metadata: Metadata = {
  title: "A Research Agent",
  description:
    "A living plan for a background agent that watches web products, AI engineering, and tooling.",
  openGraph: {
    title: "A Research Agent",
    description:
      "A living plan for a background agent that watches web products, AI engineering, and tooling.",
    type: "article",
  },
};
```

- [ ] **Step 7: Update `app/researcher/agent/page.tsx`'s subtitle**

Change (currently lines 21-25):

```tsx
        <p className="subtitle">
          A living plan for a background agent that watches data viz, full-stack
          architecture, and AI engineering so research doesn&apos;t compete with
          writing time.
        </p>
```

to:

```tsx
        <p className="subtitle">
          A living plan for a background agent that watches web products, AI
          engineering, and tooling so research doesn&apos;t compete with
          writing time.
        </p>
```

- [ ] **Step 8: Update `app/researcher/agent/page.tsx`'s goal paragraph**

Change (currently lines 33-43):

```tsx
          <p>
            The agent&apos;s only job is to read so I don&apos;t have to read
            everything myself. It checks every few hours; a curated digest of
            what actually moved in data viz, full-stack architecture, and AI
            engineering — links and a sentence each — rolls up once a day.
            Nothing is emailed until it&apos;s ready, but nothing here is private
            either — the agent&apos;s full working state (what it found, ranked,
            and is holding for the next digest) is public the moment it&apos;s
            written, not just the summary status the widget above shows. Raw
            material for LAB posts, not a LAB post itself.
          </p>
```

to:

```tsx
          <p>
            The agent&apos;s only job is to read so I don&apos;t have to read
            everything myself. It checks every few hours; a curated digest of
            what actually moved in web products, AI engineering, and tooling
            — links and a sentence each — rolls up once a day. Nothing is
            emailed until it&apos;s ready, but nothing here is private either
            — the agent&apos;s full working state (what it found, ranked, and
            is holding for the next digest) is public the moment it&apos;s
            written, not just the summary status the widget above shows. Raw
            material for LAB posts, not a LAB post itself.
          </p>
```

- [ ] **Step 9: Confirm no stale topic names remain in the touched files**

```bash
grep -rn "Data Viz\|Full-Stack Architecture\|AI Agents & Engineering\|data viz, full-stack" docs/agent-plan.md app/page.tsx app/researcher/page.tsx app/researcher/agent/page.tsx
```

Expected: no output (empty match). If anything prints, a replacement above was missed — fix it before continuing.

- [ ] **Step 10: Build the static export and run the test suite**

```bash
npm run build
npm test
```

Expected: `npm run build` completes without error (static export into `out/`). `npm test` passes — `lib/agent-status.test.ts` uses `"ai-agents"` purely as arbitrary fixture data for a generic shape-validator test (`isAgentStatus`), not as an assertion about real topic config, so it needs no change and should already pass.

- [ ] **Step 11: Manually check the rendered pages**

```bash
npm run dev
```

Open `http://localhost:3000/`, `http://localhost:3000/researcher/`, and `http://localhost:3000/researcher/agent/`. Confirm the RESEARCHER topic lists show Web Products / Tooling / AI Engineering (in that order on `/` and `/researcher/`) with the new glosses, and the agent plan page's subtitle/goal paragraph read naturally. Stop the dev server when done.

(If `next dev`'s TCP handshake hangs in this environment, per `CLAUDE.md`, kill node and retry, or fall back to verifying against the `npm run build` output already confirmed in Step 10 plus a read-through of the diffs.)

- [ ] **Step 12: Commit**

```bash
git add docs/agent-plan.md app/page.tsx app/researcher/page.tsx app/researcher/agent/page.tsx
git commit -m "$(cat <<'EOF'
Sync site and agent-plan copy to the new theme names

Web Products / AI Engineering / Tooling replace Data Viz / Full-Stack
Architecture / AI Agents & Engineering across the homepage RESEARCHER
list, /researcher/, the agent plan narrative page, and docs/agent-plan.md
— keeping the public-facing copy honest about what the agent actually
covers now that agent/topics/ has been reworked.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Post-plan housekeeping (not a task — do after Task 3's commit)

Update `PROGRESS.md`'s "Content Direction & Tony Scraponi" section: mark sub-project #1 as shipped, note the three commits above, and update "Active sub-project" to point at #2 (Telegram delivery) per `docs/tony-scraponi-roadmap.md`'s ordering — pending the user's confirmation that #2 is still next, per `CLAUDE.md`'s session-start protocol. Per `CLAUDE.md`'s "Clean context after each micro-task" rule, remind the user to `/clear` and hand off a self-contained prompt for that confirmation step, rather than starting sub-project #2's brainstorming in the same session.
