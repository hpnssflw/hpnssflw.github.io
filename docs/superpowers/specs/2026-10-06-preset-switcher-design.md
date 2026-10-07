# Preset Switcher (content engine sub-project D) — Design

Fourth sub-project of the content engine (`docs/tony-scraponi-roadmap.md`,
"Content engine (sub-projects A–D)"; A's spec:
`docs/superpowers/specs/2026-10-06-content-engine-core-design.md`). It
also closes two deferred review items of the control room (#8,
`docs/superpowers/specs/2026-10-06-tony-control-room-design.md`): M1 and
M2.

## Problem

- The engine runs three presets (Tony, `newsroom-demo`, `agro-demo`), but
  the site shows only Tony. The demo presets exist to be shown to
  prospective clients (a newsroom, an agro distributor), and today
  there's nothing to show them.
- Tony's settings still live in `agent/defaults.yaml` +
  `agent/topics/*.yaml` (`legacy:` in `agent/presets/tony.yaml`), because
  the control room parses those files at build time
  (`lib/agent-config.ts`) and reads constants from `agent/summarize.py` and
  `agent/rank_cache.py` by regex. The legacy loader (`agent/config.py`)
  doesn't read `sources.rss`, so #7 (an RSS source for Web Products) is
  blocked.
- `run-result.json` — the engine's per-run contract, which A built for
  exactly this — isn't published: `agent-run.yml` copies back only
  state, pending and status.
- M2: `isAgentStatus` (`lib/agent-status.ts`) rejects the whole
  `status.json` when `drops` or `failures` is malformed, which blanks the
  home teaser (`AppsStrip`) and the agent widget, not just the rail. M1:
  it doesn't validate dates; a malformed `updated_at` reaches
  `toISOString()` in `ControlPulse` and crashes the route.

## Goal

1. A bad optional field in `status.json` costs only that field; a bad
   date can't crash a page.
2. Tony is an ordinary self-contained preset in `agent/presets/tony.yaml`,
   and every run publishes `run-result.json` to `agent-data`.
3. The control room reads its config and rail from `run-result.json`; the
   site no longer parses agent YAML or agent source code (the workflow's
   `cron:` line excepted).
4. An unlisted demo section, `/researcher/demo/<slug>/`, shows each demo
   preset in its own language: both recorded runs, a sandbox where the
   visitor moderates the queue and watches the digest build, the digest
   the engine actually produced, the config, and the Telegram sources
   marked "coming soon".

## Decisions (settled during brainstorming, 2026-10-06)

- **M2 + M1 are Task 1 of this plan**, not a separate cycle.
- **One source for the control room: `run-result.json`** (approach 1 of
  3). Tony's control room fetches it from `agent-data` client-side; the
  demo pages read the committed goldens at build time. Rejected: Tony's
  config parsed from `tony.yaml` at build time (TS would duplicate
  `preset.py`'s merge rules and the page would have two config adapters),
  and "demo only now, Tony later" (keeps #7 blocked).
- Consequence accepted: Tony's config spine shows the config of the last
  run, not of `main` — up to one cadence (4 h) behind a config push, and
  empty while `run-result.json` can't be fetched.
- **The demo is its own section**, `/researcher/demo/<slug>/`, not tabs on
  `/researcher/queue/`; Tony's control room keeps its URL.
- **Unlisted**: `noindex, nofollow`, no link from any other page, no index
  page. Artem sends direct links.
- **The demo UI speaks the preset's language** (both demos: Russian).
  Tony's control room stays English.
- **The demo shows both recorded runs** (run 1: the queue fills; run 2:
  decisions applied, digest sent), **a sandbox** in run 1 (clicks are
  local, never saved; a live digest preview follows them), **the recorded
  digest** in run 2, and **the Telegram stub**.
- **Two pushes**: (1) the guard, Tony's migration and the control room on
  `run-result.json`; (2) the demo section.

## 1. A softer status guard (M2, M1)

`isAgentStatus(value): value is AgentStatus` becomes
`parseAgentStatus(value): AgentStatus | null`, which returns a cleaned
copy:

- **Core** — `cadence_hours`, `streak`, `pending_count` (numbers),
  `updated_at`, `topics` with a `funnel` entry per topic slug,
  `run_history`, `recent_events` (arrays). Any of these malformed →
  `null`, as today ("agent status unavailable").
- **New (M1):** `updated_at` must parse as a date (`Date.parse` not
  `NaN`), else `null`.
- **Optional fields are dropped one by one (M2):**
  - `drops` malformed → omitted; `failures` malformed → omitted (the
    rail shows its lines without reasons, as for a `status.json` written
    before #8);
  - `last_sent_at` not a parseable date → `null`;
  - a `run_history` or `recent_events` entry with a missing or
    unparseable `ts` (or otherwise malformed) is left out.
- `delivery_cadence_hours` stays unvalidated, as today: no component
  reads it from `status.json`.
- Callers switch to it: `AgentWidget`, `AppsStrip`, `ControlRoom`; the
  comment in `lib/pending-queue.ts` that points at `isAgentStatus` is
  updated.
- Vitest: each core field rejects; each optional field is dropped while
  the rest survives (the headline case: bad `drops` with a sound core
  returns a status without `drops`, not `null`); a bad `updated_at`
  rejects.

## 2. Agent: Tony as a self-contained preset, `run-result.json` published

### `agent/presets/tony.yaml`

Rewritten in the self-contained form (A's spec, § Presets):

- `preset: {slug: tony, name: Tony Scraponi, language: en}`;
- `defaults: {max_age_days: 10, min_relevance: 6, max_items_per_day: 3,
  attention: {enabled: true, min_score_gain: 50}}`;
- `topics:` — today's three topic files as a list, **in today's order**
  (`config.load_topics` sorts by file name: `ai-engineering`, `tooling`,
  `web-products`), every text copied verbatim (name, description,
  include, exclude, keywords, sources with `hacker_news.min_points` and
  `github_trending.{min_stars, topics}`), with the comments that explain
  them;
- `ranking.reader`, verbatim;
- `llm: {base_url: https://api.deepseek.com, model: deepseek-v4-flash,
  api_key_env: DEEPSEEK_API_KEY}` (with the model comment);
- `approval: {type: inbox, decisions_url: …/tony-inbox/contents/decisions.json,
  token_env: GITHUB_TOKEN, expire_days: 7}`;
- `delivery: {type: telegram, chat: "@hypnosisflow", bot_token_env:
  TELEGRAM_BOT_TOKEN, title: Research digest, cadence_hours: 24}`;
- `data:` — below.

**No re-scoring.** `rubric_hash` covers name, description, include,
exclude, reader and the prompt version; both loaders `.strip()` the
description and the reader. The three hashes today (computed and in
`agent-data`'s `state.json`) are `ai-engineering 3472af8a46e1`,
`tooling 02189e2467e9`, `web-products 080b24af813c`.

- Migration check, while the legacy loader still exists: the new file's
  topics equal `config.load_topics(agent/topics, agent/defaults.yaml)`
  and its reader, LLM, approval and delivery equal what `_load_legacy`
  builds.
- Then a permanent test pins the three hashes above.

### `legacy` goes away

Removed: `legacy:` handling (`_load_legacy`, `Preset.legacy`),
`agent/defaults.yaml`, `agent/topics/`, `config.load_settings`,
`config.load_topics` and their dataclasses. `agent/config.py` keeps
`load_env`. Docstrings that point at the old files
(`agent/preset.py`, `agent/sources/base.py`, `agent/rank_cache.py`) are
updated.

`legacy` decided two things; a new optional preset section replaces it:

```yaml
data:
  default_dir: ..     # relative to the preset file; tony.yaml → agent/
  status_json: true   # write status.json (the home teaser and the widget read it)
```

- `Preset.default_data_dir` comes from `data.default_dir` (resolved
  against the preset's folder), `None` without it. `paths.for_preset`
  is unchanged: a preset with no `default_dir` still needs
  `--data-dir`, so a demo can't overwrite Tony's local state.
- `Preset.status_json` (default `false`) replaces `preset.legacy` where
  `engine.py` decides whether to write `status.json`. The printed lines
  follow the files actually written: a real run prints `Status written: …`
  when it wrote `status.json` and `Run result: …` always; a dry run
  prints `Run result: …` always (it always writes the file).
- Unknown keys under `data` are a `PresetError`, as everywhere else.

### `run-result.json` schema v2

`config.preset.legacy` is removed, and by A's rule removing a field bumps
`SCHEMA_VERSION` to 2. Nothing else in the file changes. The site
accepts version 2 only.

### Goldens

Re-recorded once. The reviewed diff may contain only:

- `schema_version: 2` and no `legacy` in every `run-result.json` /
  `run1.json` / `run2.json` (Tony real and dry, both demos);
- one added `Run result: <DATA>/run-result.json` line in Tony's
  `real/stdout.txt` and in `dry/stdout.txt` (today both skip it because
  Tony is legacy).

Anything else changing is a regression.

### `agent-run.yml`

- "Copy updated state back" also copies `code/agent/run-result.json`.
- The commit step adds `agent/run-result.json`.
- The run command stays `python -m agent` (the default preset is
  `tony.yaml`, whose `data.default_dir` is `agent/`).
- The file carries no secrets and no error text (A's design), so it can
  be public like the other three.

### `test_control_room_contract.py`

Keeps the cron check only. The site no longer reads `summarize.py` or
`rank_cache.py`; those values reach it through `run-result.json`'s
`config.ranking` and `cap_window_hours`, which `test_run_result.py`
already checks against the code.

### #7 afterwards

Web Products' RSS source becomes a `rss:` list under that topic's
`sources` in `tony.yaml`. The self-contained loader already reads it, and
the control room shows it with no site change (§ 3).

## 3. Site: the `run-result` contract and Tony's control room

### `lib/run-result.ts`

- Types for schema v2: `preset`, `run`, `config` (preset, max_age_days,
  sources — `rss` and `telegram_public` — topics, ranking,
  cap_window_hours, approval, delivery, offline), `stages`, `failures`,
  `queue`, `delivery`. `RUN_RESULT_URL` =
  `https://raw.githubusercontent.com/hpnssflw/hpnssflw.github.io/agent-data/agent/run-result.json`.
- `parseRunResult(value): RunResult | null`, on section 1's principle:
  - **core** — `schema_version === 2`, `preset` (slug, name, `language`
    ∈ en/ru), `run.at` a parseable date, `config.topics` (each with slug,
    name and the fields the spine shows), `stages` (each stage's
    `scopes` with numeric `in`/`out` and numeric `drops`). Malformed →
    `null`;
  - **optional, dropped when malformed** — `failures` → `[]`; a queue
    item missing url/title/topic → left out; `delivery.last_sent_at`
    unparseable → `null`; `config.sources.telegram_public` malformed →
    `null`.

### Adapters (pure, tested on the goldens)

- **`configView(config)`** → what `ConfigSpine` renders: per topic (slug,
  name, description, include, exclude, keywords, max age, threshold,
  daily cap, attention, Hacker News, GitHub, RSS feeds), plus LLM (model,
  base URL, temperature, batch size, prompt version), reader, cap window,
  approval (type; for `inbox` the repo parsed from `decisions_url`;
  expiry), delivery (type, chat, title, cadence), preset feeds, and the
  Telegram stub. `ConfigSpine` takes this view instead of today's
  `AgentConfig`.
- **`buildStages(result, live, topic, text)`** keeps the rail's nine
  stages, computed from `stages` over the scopes in view:
  - value = summed `out`; line from `drops`: `undated` /
    `below_min_points` (collect), `outside_window` (window), `seen` ·
    `dismissed` (dedupe), `already_ranked` (cache), `below_relevance` ·
    `off_topic` (rank), `over_max_items` (cap), `rejected` · `expired`
    (review);
  - `enrich` folds into rank's line ("+N full text" when its notes say
    so); `format` folds into deliver's ("N items · M messages");
  - queue: the live queue length in view when there is one (Tony),
    otherwise `queue.out`; line "+`queue.in` this run";
  - review: approved count from live decisions when given (Tony's inbox,
    the demo sandbox), otherwise `review.notes.approved`;
  - deliver: `delivery.last_sent_at`'s date, or "never";
  - failures from `result.failures`, mapped to rail stages (`enrich` →
    rank, `format` → deliver, the rest by name).
- **Shared feeds (`*`).** Scopes in view are the selected topic's slug,
  or every slug plus `*` for "all". With a topic selected:
  - at collect, window, dedupe and cache, if the topic's scope is empty
    (`in` and `out` 0) while `*` isn't, the stage shows `*`'s numbers
    marked "shared feeds, before sorting";
  - at rank, the value adds `*`'s `assigned[slug]` (the shared-feed items
    sorted into this topic), and `*`'s drops stay marked as shared.

  Tony has no `*` scope; this serves the demos.

### Tony's control room

- `ControlRoom` fetches `RUN_RESULT_URL` with `useJson`, next to status,
  pending and state; each fails on its own, as today.
- The rail and the config spine come from `run-result.json`. The spine's
  caption "from main" becomes "as of last run hh:mm UTC"; while it can't
  be fetched the spine says it's unavailable and the rail shows dashes.
- Topic chips, topic names and thresholds come from `run-result.json`'s
  config, falling back to `status.json`'s `topics` (slug, name) when it's
  missing.
- Unchanged live layers: the pulse (`status.json` + the cron schedule),
  the queue from `pending.json` with owner moderation, live decisions on
  the review stage, 14 days of outcomes from `state.json`.
- `lib/agent-config.ts` shrinks to `loadSchedule(root)`: the `cron:` line
  of `agent-run.yml` parsed with `lib/cron.ts`, still failing the build
  when it isn't there exactly once. YAML parsing, `deepMerge` and the
  `summarize.py`/`rank_cache.py` regexes are deleted; `lib/agent-config.test.ts`
  shrinks with it. `yaml` leaves `package.json` (this file is its only
  importer today).

### Interface text in two languages

Every interface string in the control room's components (stage names and
hints, drop-reason labels, queue statuses and filters, pane headings,
empty and unavailable states, the digest panel, the Telegram stub) moves
into `lib/control-room-text.ts`: `const TEXT = { en: {…}, ru: {…} }`,
typed so both languages have the same keys. Components take the
dictionary as a prop; Tony's control room passes `en` and renders exactly
as it does today. Topic names, titles and summaries are content and stay
as the preset wrote them.

## 4. The demo section

### Routes and data

- `app/researcher/demo/[slug]/page.tsx`, `generateStaticParams` from
  `lib/demo-presets.ts` — `newsroom-demo` and `agro-demo`, each mapped to
  its fixture folder `agent/tests/fixtures/<slug>/` — and
  `dynamicParams = false`. No page at `/researcher/demo/`.
- Metadata: `robots: {index: false, follow: false}`; title from the
  preset's name. The page's root element carries `lang` = the preset's
  language.
- At build time the page reads `golden/run1.json` and `golden/run2.json`
  through `parseRunResult`. A file that doesn't parse fails the build:
  these are committed files. A golden re-recorded by agent work updates
  the demo with it.
- No other page links to the section.

### Screen

Same shell and CSS classes as the control room (`.cr…`), all interface
text from the preset's dictionary:

- **Header** (in place of the pulse): the preset's name; "demo ·
  synthetic data · offline runs of <date>" (the date of `run.at` only:
  both recorded runs share the fixture's clock, `offline.now` — A's
  deferred item); a switcher — the other demo presets, plus "Tony live ↗"
  to `/researcher/queue/`; a run toggle: "Run 1 — the queue fills" /
  "Run 2 — decisions applied, digest sent".
- **Rail** from the selected run (§ 3, with the shared-feeds rule).
- **Topic chips** filter the rail, the queue and the config. The digest stays whole: it is one message, and a filtered one was never sent.
- **Queue:**
  - run 1 is the **sandbox**: every item starts undecided (the decisions
    recorded in `run1.json` are ignored); approve / reject / undo with
    the buttons and a/r/u, j/k to move, status filters, and a
    "reset" control. State lives in React only and resets on reload. The
    review stage on the rail follows the sandbox's decisions;
  - run 2 is read-only: `run2.json`'s queue.
- **Right pane:**
  - **digest** — run 1: a live preview of what the editor would receive,
    built from the sandbox's approved items, with an empty state ("approve
    items to build the digest"); run 2: the digest the engine sent,
    built by the same renderer from run 1's recorded decisions. It is
    styled like a Telegram message. In the demo, item titles aren't links
    and the queue has no "open" action (no `o` key): the demo goldens'
    URLs are synthetic (`example-*.ru`, unregistered domains);
  - **config** from the run's `config`: preset RSS feeds (with "full
    text" where `full_text`), topics with include/exclude, threshold, daily
    cap, reader;
  - **Telegram channels — coming soon**: the channels listed in
    `telegram_public`, with one line saying the engine doesn't read
    Telegram yet.
- Not in the demo: the live pulse, owner mode, 14-day outcomes (a demo
  has no `state.json`).

### `lib/digest.ts`

- `digestBlocks(items, title, language)` mirrors `pending.group_by_topic`
  + `digest.build`'s single-message path: groups by `topic_name` in
  first-appearance order, sorts each group by score (descending, stable),
  header "<title> — <count phrase>" with `digest.COUNT_PHRASES`' en/ru
  forms.
- `digestHtml(blocks)` returns the same string `digest.build` returns
  when everything fits in one message (escaped as Python's `html.escape`
  does: `&`, `<`, `>`, and quotes in the href).
- React renders the blocks, never the HTML string.
- Splitting at Telegram's 4096-character limit isn't mirrored; a demo
  digest never reaches it.
- Vitest: for both demos, `digestHtml` of `run1.json`'s queue items with
  decision `approve` equals `golden/outbox.html` byte for byte.

## Testing

- **pytest** (`agent/venv/Scripts/python -m pytest agent/tests -q`):
  - the `data` section: `default_dir` resolved against the preset's
    folder, `status_json`, unknown keys rejected, a demo preset without
    `--data-dir` still refused;
  - `tony.yaml` loads; the migration equality check (§ 2) in the task
    that writes it; the three pinned rubric hashes;
  - goldens re-recorded with the allowed diff only (§ 2);
  - the contract test reduced to the cron line.
- **Vitest** (`npm test`):
  - `parseAgentStatus` (§ 1);
  - `parseRunResult` on Tony's `real/run-result.json` and both demos'
    `run1.json`/`run2.json`, plus malformed variants for each core and
    optional rule;
  - `configView` on the same goldens;
  - `buildStages` on Tony's golden with explicit expected numbers and
    lines, and on a demo golden with a topic selected (shared-feeds rule);
  - `digestHtml` against both `outbox.html` files;
  - `lib/demo-presets.ts` resolves and parses both demos;
  - the dictionaries' key parity is a type check (`tsc` during build);
  - `loadSchedule`.
- `npm run build` + `npm run serve`, headless checks
  (`reference_headless_browser_checks`): `/researcher/queue/` at
  1440×900 against a local `run-result.json` (Tony's golden served in
  place of the live one), both demo pages at 1440×900 and 390 px wide.

## Rollout

Built on branch `worktree-engine` (this worktree), as A was: every push
to `main` changes the code the next scheduled agent run executes, so
`main` gets each push only after its checks and Artem's go-ahead.

**Push 1 — §§ 1–3** (with the two unpushed commits already on this
branch: the `test_status_export.py` port and its status reconcile).

- Before: Tony from this branch vs `origin/main` on copies of
  `agent-data`'s `state.json`/`pending.json` — `--preview` identical
  except rows DeepSeek scores fresh in both runs, `--dry-run` identical
  bar live HN points/stars.
- After: dispatch `agent-run.yml` by hand right away.
  - `agent-data` gains `agent/run-result.json` with `schema_version: 2`
    and `failures: []`.
  - `state.json` changes only as a normal run would.
  - `python -m agent report` shows no items re-sent to DeepSeek.
  - The live `/researcher/queue/`: rail numbers equal the summed
    `stages`, the spine shows three topics "as of last run", the home
    teaser and the widget render.
- Until that dispatch finishes (minutes), the live spine reads
  "unavailable" — expected.

**Push 2 — § 4.**

- Both demo pages render in Russian at both widths.
- Sandbox clicks change the rail's review stage and the digest preview.
- Run 2's digest matches `outbox.html`.
- The pages carry the `noindex` meta.
- No file in `out/` outside `out/researcher/demo/` contains
  `/researcher/demo`.

## Docs

- `CLAUDE.md`: the "`/researcher/queue/` … reads the agent's config at
  build time" bullet becomes: the control room reads `run-result.json`
  from `agent-data` client-side; only the `cron:` line is read at build
  time; Tony's config is `agent/presets/tony.yaml`; renaming a
  `run-result.json` field means a schema bump and a site change in the
  same push. Add the demo section (unlisted, built from the demo
  goldens).
- `PROGRESS.md`, `docs/tony-scraponi-roadmap.md` (D shipped; #7 is a
  `rss:` entry in `tony.yaml`).
- `docs/agent-plan.md` and `/researcher/agent/` (high level only: Tony's
  settings live in one preset file).

## Out of scope

- Editing the config from the page.
- Persisting the sandbox across reloads.
- Splitting the digest preview at 4096 characters.
- An index page for `/researcher/demo/`.
- #8's M4 (refusing non-http(s) item URLs in the queue).
- Sub-projects B (stories) and C (Telegram approval buttons, several
  delivery targets).
- Publishing demo runs anywhere but the site build (they stay
  committed fixtures).
