# Research Agent — Technical Plan

This is the **canonical, implementation-facing** version of the plan. The
public-facing narrative version lives at `app/researcher/agent/page.tsx`
(rendered at `/researcher/agent/`) on the site — keep the two in sync at a
high level (goal, sources, pipeline,
stack) whenever this changes materially; they don't need to match
word-for-word.

## Goal

A background agent that reads so Artem doesn't have to read everything
himself. It checks every 4 hours; a short, curated list of what actually
moved in three topics rolls up into a Telegram post once a day — links and
a one-line summary each, and only the items he's approved on
`/researcher/queue/`. Nothing is posted until it's ready, but nothing
here is private either — the agent's full working state (what it found,
ranked, and is holding for the next digest) is public the moment it's
written, not just the summary status the widget shows. Raw material
for his own LAB writing, not a LAB post itself.

## Topics (fixed set, matches the site's RESEARCHER section)

- **Web Products** — product and web trends, securities & market data,
  data visualization, browser performance, web architecture, and SEO.
- **AI Engineering** — agent and automated pipelines and harnesses, LLM
  assistants, self-hosted/private AI platform development, and
  LLM/inference optimization.
- **Tooling** — tools developers use to build software: editors, CLIs,
  libraries, and AI coding tools.

Each topic's YAML also carries `include`/`exclude` criteria, which the
ranker scores against (see Pipeline).

## Sources

- Hacker News — public Algolia search API, matching each topic's keywords
  against story titles only (whole words, no typo tolerance, no prefix
  matching).
- GitHub — GitHub's Search API: recently created repos tagged with one of
  each topic's GitHub topics (`topic:cli`, `topic:llm`, …), ranked by
  stars; every topic uses it.
- Blog and RSS feeds — a curated list maintained by hand per topic, as the topic's `sources.rss` in `agent/presets/tony.yaml`. Since roadmap item 7 (2026-10-07) Web Products reads 11 feeds; AI Engineering and Tooling have none yet.
- Repo release watching — GitHub releases API for a handful of watched repos per topic; a version bump is unambiguous news.
- A handful of subreddits per topic — chosen once, revisited later if the signal is bad.
- Web search — broad net via a dedicated search API with a freshness filter (not Claude's built-in web search, which has no date parameter), catches whatever isn't covered above.

Every source returns a publish date for each candidate; undated candidates
are dropped rather than passed through. Full detail:
`docs/superpowers/specs/2026-08-12-research-agent-design.md`.

## Pipeline

1. **Collect** — each source connector runs independently, returns candidate links with a mandatory publish date.
2. **Recency window** — candidates published outside the topic's `max_age_days` are dropped; inside the window, an item already scored below the threshold is re-scored if its points/stars took off (the attention window).
3. **Dedupe** — every link's URL gets hashed against a store of what's already been sent or dismissed from the inbox, and against the topic's verdict cache: an item this topic already scored below the threshold isn't sent to the LLM again unless its points/stars at least doubled and grew by `attention.min_score_gain`, or the topic's criteria changed (`rank_cache.py`). Above-threshold verdicts that lost to the daily cap are reused as-is on later runs, without another LLM call. Only new or re-scorable links continue.
4. **Rank** — batched LLM calls per topic (at most 40 candidates each) score every uncached candidate 1–10 against the topic's `include`/`exclude` criteria and a short reader profile, returning a one-line summary per item; anything below the threshold is dropped, and at most `max_items_per_day` items per topic enter the queue in any rolling 23 hours (scheduled runs start minutes late, so a full 24h would free the slot one run later) — the rest stay eligible for later runs.
5. **Assemble** — surviving items get grouped by topic into a digest, ordered by relevance within each group.
6. **Deliver** — the items Artem approved on `/researcher/queue/` go out to a public Telegram channel on a fixed schedule. Rejected items are dismissed for good; undecided ones expire after `inbox.expire_days` — see `docs/superpowers/specs/2026-09-28-tony-scraponi-inbox-design.md`.

Every stage emits a structured event to a per-run log, so a run is
inspectable after the fact — see the run panel plan,
`docs/superpowers/specs/2026-08-12-run-panel-design.md`.

## Presets and engine

Since sub-project A (`docs/superpowers/specs/2026-10-06-content-engine-core-design.md`)
the pipeline is an engine run on a preset, one YAML file per client:
`python -m agent --preset PATH --data-dir DIR`. Tony is the default
preset, `agent/presets/tony.yaml` — its topics, reader, LLM, approval and delivery in one file; its `data` section keeps its data in `agent/` and writes `status.json`. Sources come in two scopes:
query sources and RSS feeds declared under a topic belong to it and are
ranked against it, as above; RSS feeds declared at preset level are
classified across all the preset's topics in batched calls. Feeds can
fetch each article's full text (trafilatura, behind an SSRF guard).
Approval (`inbox` or a local `file`) and delivery (`telegram` or a local
`file`) are adapters the preset chooses. Every real run and dry run
writes `run-result.json` — the assembled config, numbers per stage, drop
reasons, failures, the queue and delivery — the contract the control room and the demo section read (`docs/superpowers/specs/2026-10-06-preset-switcher-design.md`). `--offline` runs a preset on its fixtures with no network;
the newsroom and agro demo presets in `agent/tests/fixtures/` run that
way. Tests: `agent/venv/Scripts/python -m pytest agent/tests -q`.

Since sub-project B (`docs/superpowers/specs/2026-10-07-content-engine-stories-design.md`)
a preset can turn on `stories:`: reports of one event across its preset
feeds become one story (preset feeds only — `stories:` with topic-scoped
sources is a preset error). Stories live in `<data-dir>/stories.json`,
written by real runs only (`--preview` groups in memory, `--dry-run`
doesn't group). After rank, reports are grouped by identical text, then
near-identical text (word-shingle overlap), then one LLM merge over what's
still unmatched; a merge call with fewer than two entries is skipped, and
a failed merge holds those reports to the next run. The story is the unit
of moderation, cap and delivery: one queue entry keyed by its opener's
URL, so `pending.json` and `decisions.json` keep their format. A report of
a closed story drops as `same_story`, stale waiting stories are pruned
before grouping and the cap, and an approval taken back reopens its story.
After the cap, a multi-report story gets facts citing its reports, and the
digest adds a "who was first" line. `run-result.json` gains
`config.stories`, the `group` and `facts` stages and `queue.items[].story`
only when stories are on. The newsroom demo has them on; Tony and agro
don't. Known limits: held reports can wait indefinitely if the LLM merge
keeps failing (no fallback yet), and turning `stories:` on or off for a
preset with an existing queue has no migration — turning it off would
re-queue the non-opener reports of queued stories.

## Proposed stack

- A single Python script, run on a schedule rather than a long-lived service.
- `feedparser` for RSS/blog sources; the Hacker News Algolia API, Reddit's public JSON endpoints, and the GitHub releases API for the other aggregators; a dedicated search API (Brave) for the broad net, chosen because it returns a publish date per result.
- A flat JSON file (or SQLite if it outgrows that) holding seen-URL hashes and score history.
- DeepSeek for summarization and relevance scoring, via the OpenAI-compatible `openai` SDK — cheap enough at this volume that ranking quality, not price, is the thing to tune.
- GitHub Actions on a schedule for the trigger (`0 */4 * * *`); the Telegram Bot API for delivery on its own, coarser cadence — see `docs/superpowers/specs/2026-09-17-telegram-delivery-design.md`.

## Cadence & format

Collection and ranking run every 4 hours; Telegram delivery rolls up
everything approved once a day (`delivery.cadence_hours` in `presets/tony.yaml`).
Each digest groups items under the three topic headers, one line of
summary and a link each.

## Proposed module layout

See `docs/superpowers/specs/2026-08-12-research-agent-design.md` for the
current module layout, YAML control surface, and candidate/event
contracts — this section is superseded there.

## Environment / secrets needed

- `DEEPSEEK_API_KEY` — DeepSeek, for summarization/ranking.
- `BRAVE_API_KEY` — the web search connector.
- `GITHUB_TOKEN` — effectively required for local runs: a run makes 15
  search requests against GitHub's 10/min unauthenticated search limit
  (CI passes it); it raises the GitHub-trending connector's rate
  limit (and, later, the release-watching connector's).
- `TELEGRAM_BOT_TOKEN` — Telegram Bot API, for delivery.

`agent/.env` is gitignored.

## Task breakdown for the first build session

Superseded by the build order in
`docs/superpowers/specs/2026-08-12-research-agent-design.md`. As of this
writing, TASK-001 through TASK-006 are complete — the agent runs
end-to-end on Hacker News and GitHub, ranked by DeepSeek and delivered by Telegram.
Reddit, RSS, release watching, web search, the attention window,
scheduling, and self-refreshing keywords remain.

## Open questions

- Whether once-a-day is the right Telegram rollup — watch whether the channel feels stale or noisy and adjust from there.
- Resurfacing — a link dismissed once shouldn't come back just because dedupe only tracks URLs verbatim.
- Where it runs — resolved: GitHub Actions (`.github/workflows/agent-run.yml`), secrets in repo settings; `agent/.env` still used for local `--dry-run`/manual runs.
- Budget — search and LLM calls cost money per run, and collection now runs 6x/day instead of weekly; watch GitHub Actions minutes and DeepSeek spend once this has run for a while.

## Status

v1 code-complete: collect (Hacker News, GitHub) → recency window → dedupe → rank
(DeepSeek) → assemble → deliver (Telegram), running by hand. The Telegram
send path is implemented but not yet exercised against a real channel —
the bot/channel don't exist yet (see the TODO in `agent/deliver.py`).
Remaining sources, scheduling, and the attention window are tracked in
`docs/superpowers/specs/2026-08-12-research-agent-design.md`.
