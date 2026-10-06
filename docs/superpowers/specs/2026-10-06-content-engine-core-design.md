# Content Engine Core + Presets (sub-project A) — Design

First of four sub-projects that turn the research agent ("Tony") into a
configurable content-pipeline engine, part of the Content Direction &
Tony Scraponi initiative (`docs/tony-scraponi-roadmap.md`,
`PROGRESS.md`). Background research and the decisions it led to
(2026-10-06) are in the local, uncommitted notes
`docs/research/oss-reuse.md`, sections 1, 3, 6 and 7; everything this
spec relies on from them is restated here.

| # | Sub-project | Status |
|---|---|---|
| **A** | Engine core + presets (this spec) | designing |
| B | Stories: one news item across sources, "who was first", facts tied to sources | later |
| C | Approval and delivery: Telegram buttons as a second approval adapter, several delivery targets per preset | later |
| D | Preset switcher in the control room: the site reads each preset's run result | after the control room ships |

## Problem

Tony is one pipeline for one reader: paths, prompt, digest header,
delivery chat and reader are hard-wired (`agent/main.py:15-20`,
`agent/summarize.py`, `agent/digest.py:21`, `agent/deliver.py:25`), and
collection only works as "topic → keywords → query a source"
(`agent/pipeline.py:19-22`). A newsroom or an agro distributor reads
whole feeds whose items get a topic only after they're read. There are
no Python tests, so any refactor risks breaking the live Tony.

## Goal

A pipeline engine — sources → filter → processing → formatting →
approval → delivery — where one preset file describes one client. Tony
runs on the engine exactly as before; two demo presets (a newsroom and
an agro distributor) run end to end offline on fixtures; every run
writes a stable JSON result that the control room can later show per
preset.

## Decisions (settled during brainstorming, 2026-10-06)

From the research (`oss-reuse.md` §7):

- **The engine is the product; a client is a config.** Newsroom and agro
  are test cases (configs + sample feeds as fixtures, run offline); the
  first real config is Tony, which must work as before.
- **No Telegram parsing.** A preset may carry a `telegram_public`
  section, validated and shown as "coming soon"; enabling it is an
  error. Telegram's terms (research §5) stand when this is revisited.
- **Data paths come from `--data-dir`**, so a later move to a VPS needs
  no code change. Client data never goes to the public `agent-data`
  branch.
- **Code stays in `agent/`.**
- **The run result is a stable JSON contract**; the static site never
  runs the engine.
- **Don't break the control room**
  (`docs/superpowers/specs/2026-10-06-tony-control-room-design.md`,
  branch `worktree-admin-panel`): at build time it reads
  `agent/defaults.yaml`, `agent/topics/*.yaml`, and by regex
  `RANK_BATCH_SIZE`, `RANK_PROMPT_VERSION`, `temperature=` in
  `agent/summarize.py`, `QUEUE_WINDOW` in `agent/rank_cache.py` and the
  `cron:` line in `.github/workflows/agent-run.yml`.

From this brainstorm:

- **Two source scopes.** Query sources (Hacker News, GitHub, and an RSS
  feed attached to a topic) stay inside a topic and keep Tony's
  per-topic ranking, prompt and `rubric_hash` unchanged. Feed sources
  declared at preset level produce items without a topic; one LLM call
  per batch classifies them across all the preset's topics.
- **Full text via `trafilatura`**, as Horizon does, with Horizon's SSRF
  guard.
- **Synthetic fixtures**: hand-written fictional feeds and articles, a
  verdicts file instead of DeepSeek, a decisions file instead of the
  inbox. No third-party texts in the public repo.
- **Tony's preset is a thin file pointing at the legacy layout**
  (`defaults.yaml` + `topics/`), which stays where the control room reads
  it. It moves into its own file after D.
- **A lives in its own worktree** (branch `worktree-engine`) and is
  merged into `main` and pushed only after the live regression check
  and Artem's go-ahead — every push to `main` changes the code the next
  scheduled agent run executes. (CLAUDE.md's "work directly on `main`"
  is set aside for this sub-project at Artem's request.)
- **Filter = recency window + dedupe**, as today. Rule filters before
  the LLM (rssbrew's model) come later.

## Model

### `Item` (`agent/item.py`)

Replaces `Candidate` (`agent/sources/base.py`) everywhere. Frozen
dataclass:

| Field | Type | Notes |
|---|---|---|
| `url` | `str` | the original; the state key, hashed exactly as today |
| `title` | `str` | |
| `kind` | `str` | `hn` \| `github` \| `rss` — the strings `Candidate.source` holds today, so `pending.json`, events and the ranking prompt's `hn · 312 points · example.com` don't change |
| `source_id` | `str` | `hacker_news` / `github_trending` / the feed's `id` from the preset |
| `source_name` | `str` | `Hacker News` / `GitHub` / the feed's `name` |
| `topic` | `str \| None` | topic slug for query sources; `None` for preset feeds until classified, then set with `dataclasses.replace` |
| `published_at` | `datetime` | mandatory, timezone-aware UTC; undated → `Drop(reason="undated")` |
| `score` | `int \| None` | HN points / GitHub stars; `None` for RSS |
| `text` | `str \| None` | the excerpt (≤ 280 chars for HN/GitHub, as today); for RSS the cleaned feed text, replaced by the full text when fetched, ≤ 2000 chars |

`Drop` stays as is. Fields for B (`linked_url`, `forwarded_from`,
`text_hash`, `fetched_at`) are added by B.

### Presets (`agent/preset.py`)

A preset is one YAML file. `load_preset(path) -> Preset` validates the
whole file before any network call and raises `PresetError` with a key
path (`topics[2].incldue: unknown key`). Two forms:

**Self-contained** (newsroom, agro, later real clients):

```yaml
preset: { slug: newsroom-demo, name: "Редакция (демо)", language: ru }
defaults:                      # applies to every topic unless the topic overrides it
  max_age_days: 2
  min_relevance: 6
  max_items_per_day: 5
  attention: { enabled: false }
sources:                       # preset-level feeds: items are classified into topics
  rss:
    - { id: agency, name: "Информагентство (пример)", url: "https://example-agency.ru/rss", full_text: true }
  telegram_public:             # validated, never run in A
    enabled: false
    channels:
      - { handle: example_agency, name: "Информагентство (пример)" }
topics:
  - slug: incidents
    name: Происшествия
    description: ЧП, ДТП, пожары и аварии в регионе.
    include: ["ЧП, ДТП, пожары, аварии на коммунальных сетях в регионе"]
    exclude: ["происшествия за пределами региона без местных пострадавших"]
    # optional per-topic overrides of `defaults`, optional `keywords`,
    # optional topic-scoped sources: hacker_news / github_trending / rss
ranking:
  reader: >
    Выпускающий редактор регионального издания…
llm: { base_url: "https://api.deepseek.com", model: deepseek-v4-flash, api_key_env: DEEPSEEK_API_KEY }
approval: { type: file, path: fixtures/decisions.json, expire_days: 3 }
delivery: { type: file, title: "Сводка редакции", cadence_hours: 4 }
offline:                       # used only with --offline
  now: "2026-10-06T09:00:00+00:00"
  http: fixtures/http.yaml     # url -> fixture file
  llm: fixtures/verdicts.json  # url -> {topic, score, summary}
```

Relative paths resolve against the preset file's directory. Topic
fields are those of `agent/topics/*.yaml` plus `slug`; `keywords` is
required only when the topic has `hacker_news`. Validation: unknown keys
at every level; types; unique topic slugs (`^[a-z0-9-]+$`) and feed ids;
`telegram_public.enabled: true` → "Telegram sources aren't supported
yet"; `approval.type` ∈ {`inbox`, `file`}; `delivery.type` ∈
{`telegram`, `file`}; with `--offline`, a preset without `offline` or
with any `hacker_news`/`github_trending` source is an error (those
connectors have no offline mode). Secrets are never in a preset — only
the names of environment variables.

**Legacy** (Tony only) — `agent/presets/tony.yaml`:

```yaml
preset: { slug: tony, name: Tony Scraponi, language: en }
legacy: { defaults: ../defaults.yaml, topics: ../topics }
```

No other keys are allowed next to `legacy`. The loader reads both
through the existing `config.load_settings` / `config.load_topics`
(unchanged, no new strictness — the control room depends on these
files) and maps them onto the same `Preset` with today's semantics:
approval `inbox` (`inbox.decisions_url`, `inbox.expire_days`, token from
`GITHUB_TOKEN`), delivery `telegram` (`delivery.telegram_channel`,
`delivery.delivery_cadence_hours`, token from `TELEGRAM_BOT_TOKEN`),
title "Research digest", LLM key from `DEEPSEEK_API_KEY`, default data
dir `agent/`, and it is the only preset that writes `status.json`. After
D moves the control room onto the run result, Tony's settings move into
`tony.yaml` and `legacy` is deleted.

### Two source scopes

- **Topic scope** — a source declared under a topic. `hacker_news` and
  `github_trending` keep their signature `collect(topic, now)`; an `rss`
  list under a topic produces items with `topic` set. These items go
  through `pipeline.process_topic` as today: per-topic ranking with
  `RANK_SYSTEM_PROMPT`, `rubric_hash`, the verdict cache keyed by
  (URL, topic slug). The one addition is the enrich step (full text for
  items from feeds with `full_text: true`, right before ranking), a
  no-op for HN and GitHub. This is the path Tony uses, and #7 (an RSS
  source for Web Products) needs nothing more.
- **Preset scope** — feeds under the preset's `sources`. Their items have
  `topic = None` and are classified (§ Classification).

## Run

### Command line

```
python -m agent [--preset PATH] [--data-dir DIR] [--offline] [--dry-run | --preview] [--topic SLUG]
python -m agent report [--preset PATH] [--data-dir DIR] [--days N]
python -m agent panel [--data-dir DIR]
```

- `--preset` defaults to `agent/presets/tony.yaml`; the legacy preset's
  data dir defaults to `agent/`. So `python -m agent` in `agent-run.yml`
  does what it does today, and the workflow isn't touched.
- A self-contained preset without `--data-dir` is an error, so a demo
  can't overwrite Tony's local `agent/state.json`.
- Data dir layout: `state.json`, `pending.json`, `status.json` (legacy
  only), `runs/<run_id>.jsonl`, `run-result.json`, `outbox/`.
- `--topic` restricts the topic path to one topic and skips preset
  feeds (it stays a Tony debugging aid).
- `PresetError` exits with code 2 and its message, before any network.

### Stages of a real run (`agent/engine.py`)

`run_real`, `run_preview` and `run_dry` move from `main.py` into
`engine.py`, which takes a `Preset`, data paths, `now`, and the
adapters (fetcher, ranker, approval, delivery) — real ones from the
preset, or offline/fake ones from `--offline` and tests. `main.py` keeps
argument parsing only.

1. **Approval** — the approval adapter returns `{url: approve|reject}` or
   raises `DecisionsUnavailable` (then nothing is dropped or delivered,
   as today); `inbox.apply_decisions` runs unchanged.
2. **Topic path** — for each topic, `process_topic` as today (plus the
   enrich step before ranking), with connectors from a registry instead
   of the hard-coded dict.
3. **Feed path** — once per preset, after all topics:
   collect every preset feed → `record_seen` → recency window
   (`defaults.max_age_days`) → `filter_seen` → `filter_already_pending`
   → drop URLs already collected this run (by the topic path or another
   feed; `reason="seen"`, `detail.duplicate_in_run`) → classification
   cache → **full text** for items about to be classified, from feeds
   with `full_text: true` → classify → per assigned topic: that topic's
   `min_relevance`, then its daily cap (shared with the topic path: the
   cap counts `queued_at` in `state.json`, which the topic path has
   already set this run) → `pending.add_kept`.
4. **Format** — `digest.build(grouped, title, language)`. The count
   phrase depends on the language: `en` reproduces today's header byte
   for byte (`Research digest — 3 items`), `ru` reads
   `Сводка редакции — материалов: 3`.
5. **Deliver** — when due (`pending.is_email_due`, unchanged), the
   delivery adapter sends the approved items only; then `mark_sent_url`
   and the queue update, as today.
6. **Save** — `state.json`, `pending.json`, `status.json` (legacy only,
   via the untouched `status_export.build_status`), `run-result.json`.

`--preview` runs steps 2–3 against in-memory copies and prints, writing
nothing, reading no approvals, delivering nothing (as today). Topic
sections print exactly as today; preset feeds add one section per
assigned topic, `== <name> (<slug>) -- feeds`, plus an `off topic`
block. `--dry-run` collects, windows and dedupes both paths with no LLM,
saves `state.json` (as today) and writes `run-result.json`.

### Adapters in A

- **Approval:** `inbox` — `{type, decisions_url, expire_days,
  token_env}`, today's `inbox.load_decisions` — and `file` — `{type,
  path, expire_days}`, a local `decisions.json` in the same v1 format,
  through the same `parse_decisions`.
- **Delivery:** `telegram` — `{type, chat, bot_token_env, title,
  cadence_hours}`, `deliver.py` with pacing, 429 retry and token
  scrubbing unchanged — and `file` — `{type, title, cadence_hours}`,
  messages written to `<data-dir>/outbox/<run_id>.html`, separated by
  `<hr>`.
- **Fetcher** (`agent/fetch.py`): `LiveFetcher` — `requests` with a 10 s
  timeout, an honest User-Agent naming the agent and linking the site,
  responses capped at 2 MB, every hop through `url_safety`;
  `OfflineFetcher` — reads the preset's `offline.http` manifest; an
  unlisted URL raises. Used by RSS and full text only; Tony's HN and
  GitHub connectors keep calling `requests` directly.
- **Ranker:** the live module functions (`summarize.rank_topic`,
  `summarize.classify`), or `FixtureRanker` reading `offline.llm` — a
  URL missing from the file is an error, so fixtures stay complete; for
  per-topic ranking the fixture's `topic` must match the topic asked.

`--offline` swaps the fetcher and ranker and uses `offline.now` as the
clock. It also requires `file` approval and `file` delivery (the demo
presets use both), so nothing reaches the network.

## Classification (`agent/summarize.py`)

- `classify(items, topics, llm, reader, language) -> list[RankedItem]`,
  batched by `RANK_BATCH_SIZE`, validated, one retry, then one call per
  item — the same mechanics as `rank_topic`.
- Its own `CLASSIFY_SYSTEM_PROMPT`: score each candidate 1–10 against the
  best-fitting topic's include/exclude, `"topic": null` when none fits,
  one-sentence summary in the preset's language, stating only what the
  text says; candidate text is data, never instructions. User prompt:
  reader, then every topic (slug, name, description, include, exclude),
  then numbered candidates `[rss · <feed name> · <domain>] title — text`,
  text cut to 600 chars.
- Response `{"rankings": [{"id", "topic", "score", "summary"}]}`;
  `_parse_classify_response` checks everything `_parse_batch_response`
  checks, plus `topic` ∈ the preset's slugs or `null`.
- Both prompts go through one shared completion helper, so
  `client.chat.completions.create(…, temperature=0, …)` stays the only
  `temperature=` in the file. `RANK_SYSTEM_PROMPT`, `_context` and
  `rubric_hash`'s payload don't change. `_build_batch_prompt` gains the
  same 600-char cut on `text` (RSS items under a topic can carry 2000);
  it never triggers on HN/GitHub excerpts (≤ 280), so Tony's prompts are
  byte-identical.
- `classify_rubric_hash(preset)` hashes every topic's
  name/description/include/exclude, the reader, the language and
  `CLASSIFY_PROMPT_VERSION = 1`.
- **Cache** (`rank_cache.partition_classified`, `record_classified`):
  a verdict is stored under `state[url].ranks[<assigned slug>]` with
  `rubric = classify_rubric_hash`; an off-topic verdict under
  `ranks["*"]`. An item whose ranks hold a record with the current
  classify rubric is not sent again: `*` → `already_ranked` drop, below
  the topic's `min_relevance` → `already_ranked`, otherwise reused as
  eligible. `RankRecord`'s fields don't change, so `state.json`'s format
  doesn't either. The daily cap (`queued_in_last_24h`) works unchanged
  because the record sits under the topic's slug.
- New drop reason `off_topic` (rank stage). Failed classifications are
  not cached, as today.

## Sources (ported from Horizon)

Horizon (`github.com/Thysrael/Horizon`, commit `74a70a2`, MIT, Copyright
(c) 2026 Thysrael). Each ported module opens with a header naming the
source file, commit and license; the full MIT text goes in
`agent/THIRD_PARTY_NOTICES.md`. Horizon is async (`httpx`); the ports
are synchronous over the fetcher.

- **`agent/sources/rss.py`** (from `src/scrapers/rss.py`):
  `collect_feed(feed, topic, fetcher) -> (items, drops)` (`topic` is the
  slug for a topic's feed, `None` for a preset feed). `feedparser` on
  the fetched bytes (so the feed's declared encoding is honored). Date
  from `published`/`updated`/`created`, structured first, then RFC 822;
  no date → `undated` drop (Tony's rule, where Horizon skips silently);
  no link → a new `no_link` drop (Horizon falls back to the feed's URL).
  Text prefers `content` over `summary`/`description` (Horizon prefers
  the summary), HTML stripped with `html.parser`, whitespace collapsed,
  cut to 2000 chars. A feed that fails to fetch or parse raises; the
  engine records a failure for that feed and carries on with the others
  (Horizon logs and returns nothing). Not ported: `${ENV}` URL
  substitution, tags, author.
- **`agent/sources/fulltext.py`** (from `src/extractors/trafilatura.py`):
  `fetch_text(url, fetcher) -> str | None`; `trafilatura` is imported
  inside the function, so a Tony run never loads it. Any failure returns
  `None` and the item keeps its feed text; the enrich stage counts
  fetched and failed.
- **`agent/sources/url_safety.py`** (from `src/url_security.py`): http(s)
  only, no credentials, no localhost, every resolved address globally
  routable, re-checked on each redirect hop (max 10). Article URLs come
  from feed content, so they're untrusted input. As in Horizon, the
  address is resolved for the check and again by `requests` (no DNS
  pinning) — acceptable for this use.
- `agent/requirements.txt` gains `trafilatura>=2.1,<3`; pytest goes in a
  new `agent/requirements-dev.txt` (`-r requirements.txt`, `pytest`).

## Run result — `<data-dir>/run-result.json`

Written by real runs and `--dry-run` (never by `--preview`),
overwritten each run. Schema version 1:

```json
{
  "schema_version": 1,
  "preset": {"slug": "newsroom-demo", "name": "Редакция (демо)", "language": "ru"},
  "run": {"id": "2026-10-06T0900Z", "mode": "real", "offline": true, "at": "2026-10-06T09:00:00+00:00"},
  "config": {"…": "the assembled preset, below"},
  "stages": [
    {"stage": "collect", "group": "sources", "scopes": {
      "*":         {"in": 42, "out": 40, "drops": {"undated": 2}},
      "incidents": {"in": 0,  "out": 0,  "drops": {}}}},
    {"stage": "rank", "group": "processing", "scopes": {
      "*": {"in": 18, "out": 9, "drops": {"below_relevance": 6, "off_topic": 3},
            "assigned": {"incidents": 4, "power": 3, "economy": 2}}}}
  ],
  "failures": [{"stage": "collect", "scope": "*", "source": "agency", "error_type": "HTTPError"}],
  "queue": {"count": 7, "by_topic": {"incidents": 3, "power": 2, "economy": 2},
            "items": [{"…": "PendingItem fields as in pending.json", "decision": "approve"}]},
  "delivery": {"target": "file", "due": true, "sent_items": 3, "messages": 1, "last_sent_at": "2026-10-06T09:00:00+00:00"}
}
```

- **`stages`** — always all eleven, in logical order (the control room's
  rail order plus `enrich` and `format`), not execution order:

  | stage | group | in → out, drops |
  |---|---|---|
  | `collect` | sources | raw found → dated; `undated` |
  | `window` | filter | `outside_window` |
  | `dedupe` | filter | `seen`, `dismissed` |
  | `cache` | processing | `already_ranked` |
  | `enrich` | processing | no drops; `notes: {full_text, full_text_failed}` |
  | `rank` | processing | `below_relevance`, `off_topic`; `assigned` on `*` |
  | `cap` | processing | `over_max_items` |
  | `queue` | approval | kept this run → queue size after |
  | `review` | approval | queue before → after decisions; `rejected`, `expired`; `notes: {approved}` |
  | `format` | formatting | approved items due → messages (scope `*`) |
  | `deliver` | delivery | messages → messages sent (scope `*`) |

  Scopes are topic slugs plus `*` for preset feeds before
  classification. Counts are tallied where each stage runs (a small
  `Tally` passed alongside the event writer), not re-derived from
  events. The JSONL events keep today's stage names (`date_guard`,
  `inbox`, …) because `status_export.py` and the panel read them.
- **`config`** — the assembled preset: `preset`, `defaults`, feeds (with
  `telegram_public` as `{"enabled": false, "status": "coming_soon",
  "channels": […]}`), topics fully merged, `ranking` (reader, model,
  `temperature`, batch size, both prompt versions, every topic's
  `rubric_hash` and the classify rubric hash), the cap window in hours,
  `approval`, `delivery`. Environment variables appear by name only.
  This is everything the control room now reads from YAML and regexes.
- **`failures`** — `stage`, `scope`, `source`, `error_type` (the
  exception class name). No error text: it can carry request URLs (the
  control room's rule). The text stays in the local `runs/*.jsonl`.
  Because of that, the file is safe to publish as is.
- **Deterministic** — no finish timestamp; an offline run with
  `offline.now` produces the same bytes every time (`sort_keys`, 2-space
  indent). Golden tests pin the shape; D can commit the demo results.
- **Versioning** — adding fields keeps `schema_version`; renaming or
  removing bumps it.
- Not published anywhere in A (`agent-run.yml` is untouched); D decides.

## Tony without regression

1. **Characterization tests come first**, against today's code, before
   any refactor (task 1). A full real run of Tony with HN and GitHub
   served from synthetic Algolia/Search JSON (monkeypatched
   `requests.get`), a fake DeepSeek client with canned rankings, fake
   inbox decisions, Telegram POSTs captured, a fixed `now`, and seeded
   `state.json`/`pending.json`/`status.json` (a cached verdict, a sent
   item, a dismissed item, an item queued inside the cap window, pending
   items approved, rejected, undecided and expired). Golden files:
   `state.json`, `pending.json`, `status.json` (event `ts` normalized —
   `EventWriter` reads the wall clock), the sent messages, the
   `--preview` and `--dry-run` output. Plus the `rubric_hash` of each of
   the three real topics, as literals: this is the guarantee that the
   verdict cache survives the rollout. **No golden is regenerated in A**;
   one that would need to change is a regression — stop and find out
   why. The test harness itself may follow the refactor (module-constant
   monkeypatching before task 3, `--data-dir` and a preset after); each
   such change must feed identical inputs, and its review checks that.
2. **Live check before merging.** Old code (a scratch worktree at
   `ec82c98`) and new code run `--preview` and `--dry-run` back to back
   on the same copies of `agent-data`'s `state.json` and `pending.json`.
   The outputs must match. The only tolerated difference: the wording or
   score of rows DeepSeek scored fresh in both runs (rare at temperature
   0). Any difference in cached rows, caps, headers or the set of items
   sent to ranking is a regression. Needs `DEEPSEEK_API_KEY` in
   `agent/.env` — the main checkout's copy lost it around 2026-09-18.
3. **Control room contract**, held byte for byte, each once in its file:
   `RANK_BATCH_SIZE = 40`, `RANK_PROMPT_VERSION = 2` and the single
   `temperature=0` in `agent/summarize.py`; `QUEUE_WINDOW =
   timedelta(hours=23)` in `agent/rank_cache.py`. Not edited:
   `agent/defaults.yaml`, `agent/topics/*.yaml`,
   `.github/workflows/agent-run.yml`, `agent/status_export.py` (the
   control room changes it; `build_status`'s call stays the same). File
   formats unchanged: `state.json`, `pending.json`, `status.json`,
   `decisions.json` v1. `test_control_room_contract.py` reads those lines
   with equivalent regexes, so an accidental edit fails pytest before it
   fails the site build.
4. **Rollout.** Merge `worktree-engine` into `main` and push only after
   2 passes and Artem says so. Then dispatch `agent-run.yml` by hand and
   check `agent-data` (not `gh run view --log`, which auto mode blocks):
   `status.json`'s `streak` +1 and fresh `updated_at`; `python -m agent
   report` on the new `state.json` shows no jump in items scored that
   day (no mass re-scoring).

## Testing

pytest under Python 3.12 (CI's version) from a local `agent/venv`
(already git-ignored): `py -3.12 -m pytest agent/tests`. Not run in CI
in A.

- `test_tony_characterization.py` — above.
- `test_control_room_contract.py` — above.
- Pure functions: `dedupe.filter_seen`; `rank_cache` (`is_valid`,
  `partition`, `partition_classified`, `select`, `queued_in_last_24h`);
  `_parse_batch_response`, `_parse_classify_response`; `digest.build`
  (`en` header unchanged, `ru`, splitting); `inbox.apply_decisions`;
  `preset.load_preset` (both forms, and each validation error);
  `rss.collect_feed` (RSS 2.0, Atom, undated, HTML, encoding);
  `fulltext.fetch_text` (fixture HTML, failure → `None`);
  `url_safety` (private, loopback, link-local, credentials, scheme, a
  redirect into a private address); `OfflineFetcher`; `run_result`.
- `test_presets_offline.py` — both demo presets end to end in a temp data
  dir: golden `run-result.json` and `outbox`; a second run with the same
  `now` makes zero ranker calls and queues nothing new.

### Fixtures (`agent/tests/fixtures/`, synthetic, fictional)

- `tony/` — Algolia and GitHub search responses, canned DeepSeek
  rankings, seeded state, decisions, goldens.
- `newsroom-demo/` — `preset.yaml`; three preset feeds (an RSS 2.0 feed
  with `full_text: true` and article pages, an Atom feed, an RSS feed
  where some items have no date), about 20 fictional regional news items;
  three topics (incidents, power, economy); `telegram_public` disabled
  with three placeholder channels. Deliberate cases: an item outside the
  window, HTML in a description, one URL in two feeds, an off-topic item
  (`topic: null`), an item below threshold, a topic over its cap, and
  decisions approve / reject / none.
- `agro-demo/` — two preset feeds plus one RSS feed under the "prices"
  topic (both scopes in one preset); four topics (prices, regulation,
  market players, season); `delivery.cadence_hours: 168`.

Placeholders are `example-…` domains and handles; no real outlet is
named or fetched.

## Docs

- `PROGRESS.md` — the engine and sub-projects A–D under Content
  Direction & Tony Scraponi; A's status.
- `docs/tony-scraponi-roadmap.md` — the engine sub-projects; #7 (an RSS
  source for Web Products) becomes a topic-scoped `rss` entry in
  `agent/topics/web-products.yaml` once A ships — a control-room-visible
  config change, so it's done after D or together with the control
  room's support for it.
- `docs/agent-plan.md` — a "Presets and engine" section (two scopes,
  run result, `--data-dir`, `--offline`). The `/researcher/agent/`
  narrative doesn't change: Tony behaves the same.
- `CLAUDE.md` — the pytest command next to `npm test`, and the control
  room's constants rule.
- `.gitignore` — `agent/run-result.json` (Tony's local runs write it
  into `agent/`) and `.pytest_cache/`.

## Order of work

Each task keeps the characterization goldens green.

1. pytest setup (`requirements-dev.txt`, `agent/venv`), characterization
   tests and pure-function tests against today's code.
2. `Item` replaces `Candidate`.
3. Data paths from `--data-dir` (events, report, panel included).
4. `preset.py`: legacy and self-contained forms, validation, the
   disabled Telegram section; `--preset`.
5. `engine.py`: runs moved out of `main.py`; approval and delivery
   adapters; digest title and language.
6. `run-result.json` and the `Tally`.
7. Fetchers (live, offline) and `url_safety`.
8. RSS connector.
9. Full text.
10. Classification: prompt, validator, cache, `FixtureRanker`.
11. Feed path in the engine; topic-scoped RSS.
12. Newsroom and agro presets with fixtures and offline end-to-end tests.
13. Live old/new comparison, docs, merge on Artem's word.

## Success criteria

- `py -3.12 -m pytest agent/tests` is green; the characterization
  goldens and pinned rubric hashes are byte-identical to those recorded
  on `ec82c98`.
- The live old/new `--preview` comparison shows no difference beyond
  freshly scored rows.
- `python -m agent --preset agent/tests/fixtures/newsroom-demo/preset.yaml
  --data-dir <tmp> --offline` (and agro) writes a `run-result.json` equal
  to its golden, with no network access.
- After the merge, the first live run completes with no mass re-scoring.

## Out of scope

Stories, "who was first", fact attribution (B); Telegram approval
buttons and several delivery targets (C); the preset switcher and
publishing run results (D); reading Telegram; rule filters before the
LLM; conditional feed requests (ETag/Last-Modified); state pruning;
sites without RSS; fail-fast checks of environment variables (today's
lazy behavior stays); running pytest in CI; a private data store or a
VPS.
