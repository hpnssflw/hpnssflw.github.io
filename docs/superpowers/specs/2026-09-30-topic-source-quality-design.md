# Topic & Source Quality — Design

Sub-project #6 of the Content Direction & Tony Scraponi initiative (see
`docs/tony-scraponi-roadmap.md` and `PROGRESS.md`). Sub-projects #1–#5
are shipped; #5's moderated delivery was verified live on 2026-09-30.
This one makes what reaches the inbox worth moderating.

## Problem

In 5 of the last 6 runs before 2026-09-30, `web-products` and
`ai-engineering` kept 0 items; the whole pending queue came from
`tooling`, and part of that was off-topic (a CarPlay receiver, a chat-reply
OCR helper, an Ask HN about DOS machines). Evidence gathered during
brainstorming (the last 40 `agent-data` commits plus live Algolia/GitHub
queries):

1. **Collection is the main source of noise, not ranking.** HN Algolia
   matches a keyword against title, URL, story text and author, with typo
   tolerance and prefix matching. `MCP` matches Google *Maps* stories
   (the rejected Rafah item came from here) and "Big Mac"; `SEO` matches
   "so"/"Sol" (156 hits → 0 without typos — this is how GPT-6 Sol and
   Sonnet 5.5 landed in Web Products); `CLI` matches clip/Climate/Clinic;
   `tool use` matches the body of any Show HN. Three of AI Engineering's
   six keywords (`agent framework`, `LLM inference`, `self-hosted AI`)
   return 0 — multi-word phrases rarely occur in titles.
2. **The same rejected pool is re-ranked every 4 hours.** `new` for
   ai-engineering sits at 15–20 every run while `kept` is 0: it's one
   pool, re-sent to DeepSeek for up to 10 days. Whether anything gets in
   is decided by score noise.
3. **Tooling accepts anything from GitHub.** Its description is
   "Trending GitHub repos and web development tools", so by definition
   any trending repo is relevant; and `github_trending.py` searches
   globally with no topic filter.
4. **Web Products is source-limited.** Even with strict title search, HN
   yields ~12 candidates across 19 terms in 10 days, none for market
   data, dataviz or SEO; GitHub `topic:data-visualization` returns 0.
   Precision fixes don't fix volume.
5. **The ranker sees almost nothing.** HN link posts have no excerpt, and
   the prompt carries no domain, points or stars. For a repo with no
   description the summary is invented ("likely offers…").
6. **Nothing is measurable.** Run JSONL isn't persisted in CI,
   `status.json` has no scores for dropped items, and the inbox holds 3
   decisions so far.

## Goal

Every topic's candidates match its theme by construction, each item is
scored once against explicit criteria, and the inbox receives about 10
items a day in total, most of them worth approving.

## Decisions (settled during brainstorming, 2026-09-30)

- **Scope: precision of the existing sources only.** A new source for
  Web Products (RSS or otherwise) is sub-project #7, designed once this
  one's numbers are in.
- **Ranked items are scored once; re-scored only on growth.** A
  (URL, topic) verdict is cached; it's recomputed only when the item's
  points/stars grew materially, or the topic's criteria changed.
- **AI Engineering = engineering + major releases.** Building, running
  and evaluating LLM systems, plus major model/API/platform releases
  that change what or how you build. Not policy, lawsuits, drama,
  funding or business news.
- **AI dev tools go by purpose.** A tool used while writing code
  (including AI coding tools) is Tooling; a component for building LLM
  systems is AI Engineering. Both topics' criteria state the boundary.
- **About 10 items a day in total**, enforced as a rolling 24h cap per
  topic; what doesn't fit stays eligible for later runs.
- **Approach A:** criteria as `include`/`exclude` lists in topic YAML,
  a verdict cache in `state.json`, and a local `--preview` mode for
  tuning against live data. Few-shot examples from inbox decisions are
  deferred until there are 30–50 decisions.
- **Preview runs locally** with `DEEPSEEK_API_KEY` in `agent/.env`
  (git-ignored); CI is unchanged.

## Collection

### HN — `agent/sources/hn.py`

Every Algolia query becomes strict — not a per-topic option, since loose
matching is the defect:

```python
params = {
    "query": keyword,
    "tags": "story",
    "numericFilters": f"created_at_i>{cutoff_epoch},points>={min_points}",
    "restrictSearchableAttributes": "title",
    "typoTolerance": "false",
    "queryType": "prefixNone",
    "hitsPerPage": 50,
}
```

All four parameters were confirmed live against `hn.algolia.com` on
2026-09-30. A multi-word keyword now means "all these words in the
title". Keywords are rewritten as short title-level terms:

- **ai-engineering:** `LLM, agent, agentic, MCP, RAG, inference, eval,
  benchmark, Claude, GPT, Gemini, DeepSeek, Qwen, Llama, llama.cpp, vLLM,
  Ollama, open-weight, fine-tuning, prompt, embeddings`
- **tooling:** `CLI, terminal, editor, IDE, compiler, debugger, Git,
  GitHub, Rust, TypeScript, Python, Postgres, SQLite, database, Show HN,
  open source, library, framework, Neovim, VS Code`
- **web-products:** `browser, Chrome, Firefox, Safari, WebKit,
  WebAssembly, JavaScript, CSS, HTML, React, frontend, SEO,
  visualization, chart, dashboard, D3, stock, trading, fintech, Stripe,
  SaaS`

Broad terms (`agent`, `Show HN`, `stock`) will still catch unrelated
titles ("Foreign Agents", "Nvidia stock"); that's accepted — the word
really is in the title now, and topic fit is the ranker's job.

### GitHub — `agent/sources/github_trending.py`

The global "recently created, most starred" query is removed. The source
config gains a required `topics` list; the connector runs one search per
GitHub topic and merges results by `full_name`:

```
q = f"topic:{t} created:>{cutoff} stars:>={min_stars}"   # sort=stars, per_page=30
```

A topic config without `topics` is a config error (`KeyError` at
collection, caught by `main.py`'s per-source guard and logged as
`collect failed`). The excerpt becomes `description[:280]`, followed by
` · topics: a, b, c` (the repo's first six GitHub topics); if the repo
has no description, the excerpt is just `topics: …`. Every repo found
by a `topic:` query has topics, so no repo reaches the ranker with an
empty excerpt.

The source is enabled for all three topics:

| Topic | `topics` | `min_stars` |
|---|---|---|
| ai-engineering | `llm, mcp, ai-agents, rag, llm-inference` | 100 |
| tooling | `developer-tools, cli, devtools, terminal, vscode-extension, neovim` | 50 |
| web-products | `data-visualization, web-performance, frontend, seo` | 50 |

Web Products will likely stay near-empty here; it costs nothing to try.

15 search requests per run fits the authenticated Search API limit (30
per minute). Unauthenticated it's 10 per minute, so a local preview must
set `GITHUB_TOKEN` (e.g. from `gh auth token`).

## Ranking

### Topic criteria

`description` stays: one human-facing line. It's also still sent to the
ranker. Two new lists are read only by the ranker:

```yaml
# agent/topics/ai-engineering.yaml
include:
  - building, running or evaluating LLM systems: agent harnesses, tool use, MCP, RAG, evals
  - inference and serving: self-hosted/local models, quantization, speed and cost
  - major model, API or dev-platform releases that change what or how you build
exclude:
  - AI policy, lawsuits, regulation, company drama, funding and business news
  - AI tools used while writing code (they belong to Tooling)
  - consumer AI apps with no engineering substance
```

```yaml
# agent/topics/tooling.yaml
description: >
  Tools developers use to build software: editors, CLIs, libraries,
  and AI coding tools.
include:
  - tools used while building software: editors and IDEs, CLIs, terminals, debuggers, build tools, package managers, version control, databases
  - AI tools used while writing code: coding agents, editor plugins, Claude Code skills and hooks
  - new or notably improved open-source libraries and frameworks for building software
exclude:
  - components for building LLM systems: agent frameworks, inference servers, evals (they belong to AI Engineering)
  - games, consumer apps, and utilities with no role in software development
  - nostalgia or legacy-systems threads, career and workplace discussion
```

```yaml
# agent/topics/web-products.yaml
include:
  - the web platform and browsers: new APIs, standards, rendering and browser performance
  - frontend engineering and web architecture: frameworks, CSS, performance, SEO
  - data visualization, and products built on market or financial data
  - product and web trends: notable launches and how web products make money
exclude:
  - general tech-company news, earnings and stock moves with no product angle
  - AI model releases (AI Engineering) and developer tools (Tooling)
  - games and demos that merely run in a browser
```

Tooling's description drops "Trending GitHub repos": a trending repo
that isn't a developer tool no longer qualifies. This changes the theme
wording in `docs/tony-scraponi-roadmap.md`, which is updated to match.

### Reader profile

`agent/defaults.yaml` gains a global block, loaded into
`Settings.ranking.reader`:

```yaml
ranking:
  reader: >
    Artem, a full-stack engineer who builds web products and LLM agents
    and writes about both. He wants items he can learn from or act on
    as a builder, not general tech news.
```

### Prompt — `agent/summarize.py`

- The system prompt carries the scale anchors: **9–10** squarely inside
  `include` and substantial; **6–8** inside `include`; **3–5**
  tangential, or the given text doesn't make clear what it is; **1–2**
  matches `exclude` or is off-topic. It also carries the summary rule:
  state only what the title and excerpt say, and never guess what
  something "likely" does.
- The user prompt carries the reader, topic name, description,
  `include` and `exclude`, then the candidates.
- Each candidate line gets its context:
  `3. [hn · 312 points · github.com] Title — excerpt` /
  `4. [github · 1204 stars] owner/repo — description · topics: cli, rust`.
  The domain is the URL's hostname without `www.`.
- `temperature=0`.
- Candidates are ranked in batches of at most 40. The first run after
  rollout will re-rank the whole in-window pool (100+ items for
  ai-engineering), and one oversized batch failing validation twice
  would fall back to one call per candidate.
- `RANK_PROMPT_VERSION = 2` is a module constant, bumped whenever the
  prompt text changes.

### Rubric hash

`summarize.rubric_hash(topic, settings) -> str` is the first 12 hex
characters of the SHA-256 of a canonical JSON object:
`{name, description, include, exclude, reader, prompt_version}`. It's
stored with every verdict, so editing any of those invalidates that
topic's cached verdicts on the next run — tuning the criteria is what
this sub-project is for.

`min_relevance` stays 6. Revisit it with `report` data and inbox
decisions, not up front.

## Verdict cache and daily cap

### State — `agent/dedupe.py`

```python
@dataclass
class RankRecord:
    relevance: int            # 1-10
    summary: str
    rubric: str               # rubric_hash at scoring time
    source_score: int | None  # HN points / GitHub stars at scoring time
    ranked_at: str            # ISO 8601
    queued_at: str | None = None  # set when this topic put it in the pending queue

@dataclass
class StateEntry:
    first_seen: str
    last_score: int | None
    times_sent: int
    dismissed: str | None = None
    ranks: dict[str, RankRecord] = field(default_factory=dict)  # keyed by topic slug
```

Verdicts are keyed per topic: the same URL can be a candidate in two
topics with different fit. `load_state`/`save_state` convert `ranks`
to and from plain dicts; old entries without `ranks` load with an empty
dict. **Rollback caveat:** the pre-#6 `StateEntry(**value)` raises
`TypeError` on the new `ranks` key, exactly like `dismissed` — this is
added to `CLAUDE.md`'s existing rollback note.

### New: `agent/rank_cache.py`

Pure functions, no I/O:

- `is_valid(record, candidate, rubric, topic) -> bool` — `False` if
  `record.rubric != rubric`, or if attention is enabled and the item
  grew. **Growth** means both scores are known, and
  `current >= 2 * record.source_score` and
  `current - record.source_score >= topic.attention_min_score_gain`
  (50 by default). So 35 → 85 HN points counts as growth, 300 → 350
  stars doesn't, and 300 → 600 stars does. This wires up
  `defaults.yaml`'s existing `attention` block, which no code read
  before.
- `partition(candidates, state, topic, rubric) -> (to_rank, cached, drops)`
  — no valid record → `to_rank`; valid and `relevance < min_relevance`
  → `Drop(reason="already_ranked", detail={"relevance": …})`; valid and
  at or above threshold (it lost to the cap earlier) → `cached`, reused
  as-is.
- `record(state, ranked_items, topic, rubric, now)` — writes or
  overwrites `ranks[slug]` for freshly scored items.
- `queued_in_last_24h(state, slug, now) -> int` — counts records for
  that topic with `queued_at` in the last 24 hours.
- `select(eligible, remaining) -> (keep, over_cap)` — sorts by
  relevance, then source score, both descending, and splits at
  `remaining`.

### Per-topic flow — `agent/main.py`

The body of `run_real`'s topic loop moves into
`process_topic(topic, state, queue, settings, now, writer) -> list[RankedItem]`,
shared by the real run and preview:

1. collect → `date_guard` → `dedupe.filter_seen` →
   `pending.filter_already_pending` (unchanged)
2. `rank_cache.partition` — `already_ranked` drops are emitted at stage
   `dedupe`
3. `summarize.rank_topic(to_rank)` → `rank_cache.record`
4. fresh items below `min_relevance` → `below_relevance` (stage `rank`,
   as today)
5. `eligible` = fresh items at or above threshold, plus `cached`;
   `remaining = max(0, topic.max_items_per_day - queued_in_last_24h)`;
   `select` → `keep` gets `queued_at = now` and is added to the pending
   queue (a cached item carries its stored summary and relevance);
   `over_cap` → `over_max_items` with detail
   `{"max_items_per_day": …, "queued_last_24h": …}`

`already_ranked` is added to `Drop.reason`'s documented vocabulary.

### Config

`max_items` (per run) is replaced by `max_items_per_day` in
`defaults.yaml` (3) and `TopicConfig`; `ai-engineering.yaml` overrides
it to 4, for a total of at most 10 a day. The 7 tooling items already
queued have no `queued_at`, so they don't count against the cap; Artem
moderates them or they expire after 7 days.

### Funnel

`status_export` already subtracts every `dedupe`-stage drop from `new`,
so the dashboard's `new` becomes honest: only items that actually need
scoring, instead of the same ~17 every run. `agent/funnel.py` and
`agent/panel_page.html` (the local panel) subtract only `seen` today;
both change to subtract `seen + dismissed + already_ranked`, which also
fixes the missing `dismissed`. The site renders drop reasons as raw
strings (`components/AgentWidget.tsx`), so no site code changes.

The first run after rollout re-scores the whole in-window pool against
the new criteria: a few hundred items, in batches of 40. From then on,
DeepSeek sees only genuinely new items, grown ones, and anything whose
topic criteria changed.

## Preview — `python -m agent --preview [--topic SLUG]`

Loads `agent/state.json` and `agent/pending.json` if present (both
git-ignored; to be realistic, first copy them from `origin/agent-data`),
then calls `process_topic` for each topic against in-memory state, with
a writer that collects events into a list. It writes nothing — no
state, queue, status or run file — never reads the inbox and never
delivers. Per topic it prints one row per item: verdict (`queue`,
`over cap`, `below`, `cached-below`), relevance, source, title, summary.
It needs `DEEPSEEK_API_KEY` (and `GITHUB_TOKEN` for the rate limit) in
the environment or `agent/.env`.

## Report — `python -m agent report [--days 14]`

New `agent/report.py`: a pure function over `state.json`, dispatched
like `panel` in `main()`. Per topic, over the last N days:

- queued, from `ranks[slug].queued_at`;
- sent (`times_sent > 0`), rejected / expired (from `dismissed`), and
  still pending (the rest);
- the relevance histogram of verdicts (`ranked_at` in range).

Plain text to stdout. It reads a local `state.json` copied from
`agent-data`. This is how `min_relevance` and the caps get tuned
later.

## Error handling

- One failing request (HN keyword or GitHub topic query) fails that
  source for that topic for this run, as today (`collect failed` event,
  other sources and topics continue). No new retries: the next run is 4
  hours away, and the cached verdicts mean nothing is lost.
- A batch that fails validation twice falls back to per-candidate calls
  (unchanged); with batches of 40, a failure costs at most 40 single
  calls. A candidate whose single call also fails gets `relevance=1`
  and "(ranking failed)" as today. `RankedItem` gains a `failed: bool`
  flag for this case, and `rank_cache.record` skips flagged items, so
  that verdict **is not cached** and the item is retried next run.
- A missing `topics` in a `github_trending` config → `KeyError` → logged
  `collect failed`.

## Testing

As in previous agent plans: throwaway fail-first verification scripts in
`.superpowers/sdd/2026-09-30-topic-source-quality/` (git-ignored), run
with `py -3 - < script` from the worktree root. No network — `requests`
and the OpenAI client are mocked:

- HN sends the four strict params; GitHub runs one query per topic,
  merges duplicates, builds the `topics` excerpt, and fails without
  `topics`.
- The prompt contains reader, include and exclude; the candidate lines
  carry domain, points and stars; `rubric_hash` changes when include,
  exclude, reader or prompt version change, and not otherwise; batches
  are split at 40.
- `rank_cache`: valid / rubric-changed / grown / not grown / attention
  disabled; `partition` routing; `queued_in_last_24h` boundaries;
  `select` ordering and cap; failed-ranking verdicts not cached.
- State round-trip with and without `ranks` (old `state.json` loads).
- Funnel counts with `already_ranked` and `dismissed` drops.
- `report` over a synthetic state.

Then one live `--preview` with the real key against state copied from
`agent-data`. If `app/researcher/agent/page.tsx` changes, also
`npm test` and `npm run build`.

## Rollout

1. Live `--preview`; Artem reviews the `queue` rows and the criteria get
   tuned until most of them are on-topic (success criterion 1).
2. Push to `main`, trigger `agent-run.yml` by `workflow_dispatch`.
3. On `agent-data`, check that `state.json` entries carry `ranks`, that
   pending additions respect the caps, and that on the next run each
   topic's `new` is in single digits.

## Success criteria

1. Before push: in the live preview, most `queue` rows are on-topic by
   Artem's judgement.
2. After rollout: `new` no longer sits flat at 15–20 per run.
3. Over the first 3 days: at most 10 queued a day. AI Engineering
   contributes on most days, and Tooling contributes only developer
   tools. Web Products may contribute nothing — that's the known
   limitation feeding #7.
4. The inbox approval rate is watched via `report`: a signal, not a
   gate.

## Docs

- `docs/agent-plan.md` (technical) and `app/researcher/agent/page.tsx`
  (narrative) — strict title search, GitHub topic queries, per-topic
  criteria, the verdict cache, the daily cap. Kept in sync at a high
  level, per `CLAUDE.md`.
- `docs/tony-scraponi-roadmap.md` — add #6 (this) and #7 (a Web Products
  source); update Tooling's theme wording; note inbox-decision few-shot
  as a later candidate.
- `PROGRESS.md` — status and "How to resume".
- `CLAUDE.md` — the `ranks` rollback caveat alongside `dismissed`.

## Out of scope

- New sources (RSS, Lobsters, Reddit): sub-project #7.
- Few-shot examples from inbox decisions in the prompt.
- Persisting run JSONL or score histograms in CI or `status.json`.
- Site changes beyond the narrative copy on `/researcher/agent/`.
- Pruning `state.json`.
