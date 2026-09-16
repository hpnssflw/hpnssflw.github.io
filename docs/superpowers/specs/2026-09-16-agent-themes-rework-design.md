# Agent Themes Rework — Design

Sub-project #1 of the Content Direction & Tony Scraponi initiative (see
`docs/tony-scraponi-roadmap.md`). Replaces the agent's current three
topics (`ai-agents`, `data-viz`, `full-stack`) with the roadmap's three
themes (Web Products, AI Engineering, Tooling), reconciles dead source
config against what `agent/main.py`'s `CONNECTORS` dict actually wires
up, and keeps the live site's RESEARCHER section in sync with the new
topic names.

## Problem

- `agent/topics/ai-agents.yaml`, `data-viz.yaml`, `full-stack.yaml` don't
  match the roadmap's themes (Web Products, AI Engineering, Tooling) that
  both the agent and the future Tony Scraponi theme model are meant to
  share.
- Every topic YAML's `sources:` block lists `reddit`, `rss`, `releases`,
  and `web_search` keys, but `agent/main.py`'s `CONNECTORS` dict only
  wires up `hacker_news`. Those keys currently do nothing — dead config
  that reads as more capability than the agent has.
- The roadmap calls out that "Tooling" specifically needs at least one
  real connector behind it (trending GitHub repos) to mean anything as a
  theme, since Hacker News alone doesn't cover that on its own.
- The three old topic names are also hardcoded as static copy in three
  site files and one doc, all currently in sync with the agent's actual
  topics. Renaming the agent's topics without touching this copy would
  make the live site publicly disagree with the agent about what it
  covers.

## Scope

In scope:
1. Three new topic YAMLs (Web Products, AI Engineering, Tooling),
   replacing the old three.
2. Removing the dead `reddit`/`rss`/`releases`/`web_search` keys from
   topic config — nothing reads them today.
3. A new `github_trending` connector, wired into `CONNECTORS`, backing
   the Tooling theme.
4. Site copy updates so the live RESEARCHER section and agent-plan
   narrative match the new three themes.

Out of scope (tracked elsewhere): Reddit/RSS/release-watching/web-search
connectors (`docs/agent-plan.md`'s "remains out of scope" list, unchanged
by this work), Telegram delivery (sub-project #2), a fuller editorial
pass on LAB/RESEARCHER content (sub-project #3), Tony Scraponi itself
(sub-project #4).

## Design

### 1. Topic config rework

`agent/topics/ai-agents.yaml`, `data-viz.yaml`, `full-stack.yaml` are
deleted and replaced with:

- **`web-products.yaml`** — name "Web Products". Description: product
  and web trends, securities & market data, data visualization, browser
  performance, web architecture, SEO (the roadmap's own theme-1
  description). Keywords reworded to match (e.g. `web product`, `data
  visualization`, `browser performance`, `web architecture`, `SEO`).
  `sources: { hacker_news: { min_points: 30 } }`.
- **`ai-engineering.yaml`** — name "AI Engineering". Description:
  agent/automated pipelines and harnesses, LLM assistants, self-hosted/
  private AI platform development, LLM/inference optimization (the
  roadmap's theme-2 description). Keywords carry forward the useful
  parts of the old `ai-agents.yaml` list (`agent framework`, `tool use`,
  `evals`, `MCP`) plus additions for inference/self-hosted platforms.
  `sources: { hacker_news: { min_points: 30 } }`.
- **`tooling.yaml`** — name "Tooling". Description: trending GitHub
  repos and web development tools (the roadmap's theme-3 description).
  Keywords for the HN side (`dev tool`, `CLI`, `open source library`,
  `developer tooling`). `sources: { hacker_news: { min_points: 30 },
  github_trending: { min_stars: 200 } }`.

Slugs (the YAML filenames) are `web-products`, `ai-engineering`,
`tooling` — matching the parenthetical naming already used in
`PROGRESS.md`'s task description for this sub-project.

No changes to `agent/config.py`'s loader or `TopicConfig` — the merge/
load logic is already generic over whatever's in `topics/*.yaml`.

### 2. `agent/sources/github_trending.py` — new connector

Same contract as `agent/sources/hn.py`: `collect(topic, now) ->
(list[Candidate], list[Drop])`. Reads `topic.sources.get(
"github_trending")`; returns `([], [])` immediately if that key is
absent, so it's a no-op for the other two topics.

- **Query**: GitHub REST Search API —
  `GET https://api.github.com/search/repositories` with
  `q=created:>{cutoff}+stars:>={min_stars}`, `sort=stars`,
  `order=desc`, `per_page=30`. `cutoff` is `(now -
  timedelta(days=topic.max_age_days)).date()`, formatted `YYYY-MM-DD`.
  `min_stars` comes from the topic's `github_trending` config
  (default `0` if unset). This is a "recent repos ranked by stars"
  proxy for trending, not GitHub's own (undisclosed) trending
  algorithm — documented as such in the module docstring so a future
  reader isn't surprised when it doesn't match `github.com/trending`
  exactly.
- **Auth**: if `GITHUB_TOKEN` is set in the environment, send
  `Authorization: Bearer {token}` (raises the Search API's
  unauthenticated 10/min rate limit). Same env var `docs/agent-plan.md`
  already documents as optional — its description gets reworded from
  "raises the release-watching connector's rate limit" (that connector
  doesn't exist) to cover this one.
- **Mapping to `Candidate`**: `url` = `html_url`, `title` = `full_name`,
  `source` = `"github"`, `published_at` = the repo's `created_at`
  (parsed, tz-aware), `score` = `stargazers_count`, `excerpt` =
  `description` truncated to 280 chars (same `EXCERPT_MAX_CHARS`
  pattern as `hn.py`).
- **Errors**: `response.raise_for_status()`, same as `hn.py` — no
  special retry/backoff.
- A response entry missing `created_at` is dropped with reason
  `"undated"`, same defensive pattern as `hn.py` (expected not to fire
  in practice, since GitHub always populates this field).

`agent/main.py`'s `CONNECTORS` dict gains `"github_trending":
github_trending.collect`.

`agent/sources/base.py`'s `Candidate.source` field comment (`# hn |
reddit | rss | releases | web`) gets `github` added.

### 3. Site copy updates

Content-only changes, no layout/component/CSS changes:

- **`app/page.tsx`** — the three `<li>` entries under `#researcher`
  (`topic-name` + `topic-gloss`) become Web Products / AI Engineering /
  Tooling, glosses matching the roadmap's one-line theme descriptions.
- **`app/researcher/page.tsx`** — same three entries, plus its two
  "Data viz, full-stack architecture, and AI agent engineering"
  description strings (page metadata + body copy).
- **`app/researcher/agent/page.tsx`** — the "watches data viz,
  full-stack architecture, and AI engineering" phrasing (appears 3x:
  metadata description, OG description, body paragraph) becomes
  "watches web products, AI engineering, and tooling" (or equally
  natural phrasing preserving each occurrence's sentence structure).
- **`docs/agent-plan.md`** — the "Topics (fixed set, matches the site's
  RESEARCHER section)" list gets the three new theme names/descriptions
  (pulled from the roadmap's own wording), and the `GITHUB_TOKEN`
  environment line gets reworded per section 2 above.

No changes to `assets/agent-widget.js`, `status_export.py`, or any CSS —
the widget/dashboard are already topic-agnostic (keyed dynamically off
whatever slugs exist under `agent/topics/`).

## Verification

Follows this repo's existing pattern for the agent (no pytest suite —
synthetic no-network checks plus live runs against real infra, recorded
in `PROGRESS.md`):

- Synthetic, no-network check for `github_trending.collect`: feed it a
  canned API response (mocked `requests.get`) and confirm correct field
  mapping, excerpt truncation, and that an entry missing `created_at` is
  dropped with reason `undated`.
- Live check: `python -m agent --dry-run --topic tooling` against real
  GitHub + HN infrastructure — funnel should show non-zero `collected`
  counts, no crash.
- `python -m agent --dry-run` (no `--topic` filter) once, confirming all
  three renamed topics load and run end-to-end.
- Site: `npm run build` must still succeed (static export), plus a
  manual look at `npm run dev`'s `/`, `/researcher/`, and
  `/researcher/agent/` to confirm the new copy renders as intended.
- `npm test` (Vitest): `lib/agent-status.test.ts` uses `"ai-agents"` as
  fixture data for testing `lib/agent-status.ts`'s parsing logic
  generically (not asserting against real topic config), so it likely
  needs no change — confirm this during implementation rather than
  assuming it.

## Open questions

None outstanding — all scoping decisions (site-copy inclusion, dead-key
removal + one real connector, Tooling's HN+GitHub dual-source shape,
Search-API-over-scraping) were made during brainstorming and are
reflected above.
