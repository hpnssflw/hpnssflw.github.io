# Tony Scraponi Control Room — Design

Replaces `/researcher/queue/` (sub-project #4's queue page plus #5's
owner-mode inbox) with a one-screen control room for the research agent:
its full configuration, the flow of its last run, the moderation queue and
14 days of outcomes. Part of the Content Direction & Tony Scraponi
initiative (`docs/tony-scraponi-roadmap.md`), built on #6's config shape
(include/exclude, reader profile, verdict cache, daily caps).

## Problem

Artem calls today's queue page "absolutely not UX-friendly": one long list
of 65 items grouped by topic, approve/reject under each, and nothing about
how the agent got there. The agent's configuration lives in YAML and
Python, its run numbers in `status.json`, and its outcomes only in a local
`python -m agent report`. To tune #6's criteria and caps he has to read
three places, two of them on his machine.

## Goal

One page, at desktop widths one screen with no page scroll, in the home
page's visual language, that shows:

1. **pulse** — is the agent live, when it last ran, when it runs next;
2. **flow** — every pipeline stage with its last-run numbers and what each
   stage dropped and why;
3. **config** — every parameter that decides what reaches the queue, per
   topic;
4. **queue** — fast moderation (filters, keyboard);
5. **outcomes** — what happened to queued items over 14 days, the
   relevance histogram, and how many items were sent to DeepSeek per day.

Editing the config from the page is out of scope (see § Later).

## Decisions (settled during brainstorming, 2026-10-05/06)

- **Same URL, public read-only.** `/researcher/queue/` is replaced in
  place. Visitors see everything read-only, as today; with the owner token
  the moderation controls appear. Nothing new is exposed: the YAML is in
  this public repo, and `status.json`, `pending.json`, `state.json` and
  `decisions.json` are already public.
- **Layout: the "hybrid"** (picked from rendered variants): the site's
  1040px container; a pulse strip; a rail of the nine stages with last-run
  numbers; topic chips; then two panes — queue left, config spine right
  with outcomes at its foot.
- **Config is read at build time from `main`**, never fetched. A config
  change is a push to `main`, which redeploys, so the page can't drift from
  what the agent runs.
- **Drop reasons come from a small agent change** (`status_export.py`
  only), not derived on the site.
- **Narrow screens are for moderation:** below 900px the panes stack,
  queue first.
- **The home teaser links to the control room** and drops "coming soon".

## Page

```
┌ pulse ─────────────────────────────────────────────────────────────────┐
│ [spy] tony scraponi   ● live · last run 18:22 utc (20m ago) · next 20:00 │
│       control room      in 01:37:12 · streak 237 · ▁▃▅▂… · digest 09-30  │
│                                                         owner / sign out │
├ rail ──────────────────────────────────────────────────────────────────┤
│ COLLECT  WINDOW  DEDUPE  CACHE  RANK  CAP  QUEUE  REVIEW  DELIVER        │
│  205      205     159     159    63    10    65      2     09-30         │
│  found  −0 old  −46 seen −0 …  −96…  −53…  +10…   −1 rej  approved only  │
└────────────────────────────────────────────────────────────────────────┘
 all 65 · ai engineering 12 · tooling 44 · web products 9
┌ queue ──── waiting 63 · approved · rejected · all ┐┌ config ── from main ┐
│ 10 capcom-td-oss/redox                             ││ ○ COLLECT  hn: …    │
│    github · github.com · tooling · 10-02           ││   keywords [cli]…   │
│    summary …   A approve  R reject  O open ↗       ││ ○ RANK  deepseek…   │
│  9 gemini 4 argon                                  ││   reader · criteria │
│  …                                    (scrolls)    ││ …        (scrolls)  │
│ j/k move · a approve · r reject · u undo · o open  ││ OUTCOMES · 14 DAYS  │
└────────────────────────────────────────────────────┘└─────────────────────┘
 footer (slim on this route)
```

### Pulse

Mono 10px on the home cards' `--card-bg` surface with the slow lime comet,
like the Tony teaser. Left: `TonyMark` (the spy, extracted from
`AppsStrip.tsx`), "tony scraponi" / "control room". Middle, one line:

- `● live` (lime) or `● stale` (red) — `isStale` from `lib/agent-status.ts`;
- `last run HH:MM utc (Nm ago)` — `status.updated_at`;
- `next HH:MM in hh:mm:ss` — the next slot of the workflow's cron (see
  § Config), not `updated_at + cadence`: after a manual 18:22 dispatch the
  next run is 20:00, not 22:22;
- `streak N` and the kept-per-run sparkline (`sparklineCells`);
- `digest MM-DD` — `status.last_sent_at`, or `never`.

Right: the owner slot — `owner` opens the token field inline in the strip;
signed in, `sign out`. Owner-mode errors show under the line in red.

### Rail

Nine stages, in reading order. Each node: label (uppercase meta), a number
(sans, light, 20px), and one muted line of what the stage removed. Numbers
follow the topic chips (one topic, or the sum over all three). A stage
that failed this run (see `failures`, § Agent change) gets a red label and
`failed: <source>` as its line. Clicking a node highlights and scrolls to
that stage in the config spine; clicking it again clears the highlight.

| Stage | Number | Line |
|---|---|---|
| collect | `funnel.collected` | `found`, or `−N undated` / `−N below min points` if collect dropped any |
| window | `funnel.in_window` | `−N too old` (`outside_window`) |
| dedupe | `in_window − seen − dismissed` | `−N seen · −N dismissed` |
| cache | `funnel.new` | `−N cached below` (`already_ranked`) |
| rank | `new − below_relevance` | `−N below <min_relevance>` |
| cap | `funnel.kept` | `−N over cap` (`over_max_items`) |
| queue | items in `pending.json` (for the topic filter) | `+N this run` (`kept`) |
| review | approved items in the queue (from `decisions.json`) | `−N rejected · −N expired` (last run's `inbox` drops) |
| deliver | `last_sent_at` as `MM-DD`, or `—` | `approved only` |

`review` is placed where moderation sits logically, between queue and
deliver. Its tooltip says what the old owner-mode note said: approved
items go out with the next digest, and the agent picks up decisions at
the start of its next run, every 4 hours.

Until `status.json` carries `drops` (§ Agent change), the nodes that need
them — dedupe's and rank's numbers, and every node's line except
collect's `found` and queue's `+N this run` — show `—` or nothing; the
rest (collect, window, cache, cap, queue, review's count, deliver) work
from today's `status.json`.

### Topic chips

`all 65 · ai engineering 12 · tooling 44 · web products 9` — counts are
pending items per topic. The chip filters the queue, the rail, the config
spine and the outcomes. The page opens on `all`.

### Queue pane

- Header: `QUEUE` and status chips `waiting · approved · rejected · all`
  with counts; default `waiting`. Statuses come from `decisions.json`
  (owner: the API copy, as in #5; visitor: the public raw file).
- Rows, sorted by score then newest `pending_since`: score (lime at ≥ 8),
  title (sans 12px, one line, ellipsis), and a meta line —
  `hn|github · domain · topic (only under "all") · MM-DD`.
- The selected row (lime left edge) unfolds: full title, summary, and for
  the owner `a approve · r reject · o open ↗` (or `u undo` once decided).
  Visitors get `o open ↗` only.
- Keys: `j`/`k` move, `o` opens the link; owner only: `a`, `r`, `u`.
  Ignored while focus is in an input. After a decision the selection
  moves to the next row of the current filter.
- Footer: the key hints (visitors see only `j/k move · o open`).

Moderation writes are #5's, unchanged: optimistic update, PUT
`decisions.json` to `hpnssflw/tony-inbox` with the stored sha, one retry
on a 409/422 conflict after re-reading, prune with `PRUNE_GRACE_MS`, sign
out on 401/403.

### Config spine

A vertical spine of the same nine stages; each row: a dot on a 1px line,
the label, and that stage's parameters in one line. Rows highlight from
the rail; clicking a row highlights its rail node. With a topic chip
selected, two rows unfold:

- **collect** — HN keywords as tags (first 8, then `+N`), GitHub topics as
  tags; the line itself: `hn: 25 title keywords, ≥30 points · github: 6
  topics, ≥50★`.
- **rank** — `reader` (the profile text) and `criteria`: `include` lines
  prefixed `+` in lime, `exclude` lines prefixed `−` in red.

Under "all", collect shows the shared shape (`hn title search, ≥30 points
· github topic search, ≥50–100★ · per topic`) and rank says `pick a topic
to see its include / exclude`.

| Stage | Parameters shown |
|---|---|
| collect | HN `min_points`, keyword count + tags; GitHub `min_stars`, topics |
| window | `max_age_days` |
| dedupe | fixed text: already sent, queued, rejected or expired; same URL twice in a run |
| cache | one verdict per URL × topic; topic's current `rubric` hash and number of cached verdicts (from `state.json`); re-score at `2×` and `+min_score_gain` points/stars (or `attention off`) |
| rank | `llm.model`, `temperature`, batch size, prompt version, `min_relevance`; reader + criteria when unfolded |
| cap | `max_items_per_day` (per topic, or `4 + 3 + 3`), rolling `23h` window |
| queue | fixed text: held for review |
| review | inbox repo, `expire_days` |
| deliver | `telegram_channel`, `delivery_cadence_hours`, approved only |

Every value is rendered through one `ConfigValue` component, so a later
editing step can swap values for inputs in one place.

### Outcomes (foot of the config pane)

A TS port of `agent/report.py`'s `build_report`, over the public
`state.json`, for the last 14 days and the topic filter:

- `queued N` — `ranks[slug].queued_at` in range — split into `sent`
  (lime), `rejected` (red), `expired`, `pending`;
- relevance histogram 1–10 (`ranked_at` in range), bars at and above
  `min_relevance` in lime;
- `scored / day` — verdicts per UTC day, the number of items sent to
  DeepSeek: #6's success measure, as 14 small bars with the latest count.

Only verdicts written since #6 carry a topic, so older items don't appear,
as in `report.py`.

### Narrow screens (< 900px)

The page scrolls. Order: pulse (wraps to two lines), topic chips, queue
(capped at ~70svh with its own scroll so the rest stays reachable), rail
as a 3×3 grid, config spine, outcomes. Rows unfold on tap; the
approve/reject buttons are the same.

### Style

A new "Control room" section in `app/globals.css`, after the "Inbox"
section, whose `.inbox-*` button, status and token classes are reused;
the queue no longer uses `.feed`. Same tokens and case system:
labels and chrome UPPERCASE, content lowercase; `--card-bg` surfaces with
blur and no borders; lime and red only where they already mean
kept/approved and dropped/rejected/stale. On this route the footer's
bottom padding shrinks so header + page + footer fit one screen; below
~690px of window height the page scrolls rather than cut anything off
(the home page's rule).

## Config at build time — `lib/agent-config.ts`

`loadAgentConfig(repoRoot)` returns a plain, serializable `AgentConfig`
passed from the server `page.tsx` to the client tree:

- `agent/defaults.yaml` and each `agent/topics/*.yaml`, merged exactly as
  `agent/config.py`'s `_deep_merge` does (topic keys win; nested dicts
  merge key by key), topics sorted by file name like `load_topics`;
- constants that live in code, read with anchored regexes:
  `RANK_BATCH_SIZE` and `RANK_PROMPT_VERSION` and `temperature=` from
  `agent/summarize.py`, `QUEUE_WINDOW = timedelta(hours=N)` from
  `agent/rank_cache.py`, and the `cron:` line from
  `.github/workflows/agent-run.yml`.

If a file or constant is missing or doesn't parse, it throws, and the
build fails: the page must not show a config the agent no longer has. Only
these YAML fields are read; `agent/.env` and secrets are never touched.
YAML is parsed with the `yaml` package (2.x, no dependencies), added as a
direct dependency — it's already in the lockfile under vitest.

`lib/cron.ts` (`parseCron`, `nextRun`) supports the every-N-hours shape
the workflow uses (`0 */4 * * *`) and plain daily `M H * * *`; anything
else throws at build time, so a cron change can't silently break the
countdown. It's client-safe, so the pulse uses it for the countdown.

## Agent change — `agent/status_export.py`

`build_status` gains two keys, computed from the run's events only (it
still never reads `TopicConfig`, per the widget spec's redaction rule):

```python
"drops": {slug: {stage: {reason: count}}},   # every drop event, per topic
"failures": [{"stage": str, "topic": str | None, "source": str | None}],
```

`failures` lists every `event == "failed"` (`collect` with topic and
source, `rank` with topic, `inbox` and `deliver` with neither). Error text
is deliberately left out: it can carry request URLs and isn't needed to
show which stage broke. Inbox drops already carry the item's topic, so
`rejected`/`expired` land under that topic's `inbox` stage. Drops for a
topic that no longer exists are skipped, as today.

Verified like the earlier agent plans: a throwaway, no-network script in
`.superpowers/sdd/2026-10-06-control-room/` feeding synthetic events to
`build_status`. Nothing else in the agent changes; `agent-run.yml` is
untouched.

## Site code

- `app/researcher/queue/page.tsx` — server; `loadAgentConfig()`;
  metadata "Tony Scraponi"; renders `<ControlRoom config={…} />`.
- `components/ControlRoom.tsx` — client; fetches `status.json`,
  `pending.json`, `state.json` (each independently) and owns topic/status/
  selection state; lays out the panes.
- `components/ControlPulse.tsx`, `PipelineRail.tsx`, `ConfigSpine.tsx`,
  `QueuePane.tsx`, `Outcomes.tsx`, `TonyMark.tsx`.
- `components/useInbox.ts` — the owner-mode logic moved out of
  `PendingQueue.tsx` unchanged (token, snapshot, `decide`, conflict retry,
  prune). `PendingQueue.tsx` is deleted; `InboxControls.tsx` keeps the
  token storage helpers and the token form.
- `lib/agent-status.ts` — `AgentStatus` gains optional `drops` and
  `failures`; `isAgentStatus` accepts their absence and rejects a
  malformed shape.
- `lib/pipeline-stages.ts` — pure: `(config, status, queue, decisions,
  topic) → Stage[]` with numbers and lines per the rail table.
- `components/useJson.ts` — fetch one public JSON file with a shape check.
- `lib/outcomes.ts` — pure: the `report.py` port over a `state.json` shape
  guard (`isAgentState`).
- `lib/queue-view.ts` — pure: filter by topic and status, sort, counts,
  next selection after a decision.
- `components/AppsStrip.tsx` — "coming soon" removed; an `open ↗`
  `card-action` to `/researcher/queue/` added; "follow the build ↗" stays.
- Link labels: `/researcher/`'s "Research Queue" → "Tony Scraponi";
  `/researcher/agent/`'s "See the full pending queue →" → "Open the control
  room →".

## Error handling

Every live source fails on its own:

| Source fails | Shown |
|---|---|
| `status.json` | pulse: `status unavailable`; rail numbers `—` (queue and review still count from the queue) |
| `pending.json` | queue pane: `queue unavailable`; queue/review nodes `—` |
| `state.json` | outcomes: `outcomes unavailable`; cache row without rubric/verdict count |
| `decisions.json` | statuses hidden, status chips hidden, review node `—` (as #5) |
| owner write | #5's handling: red message in the pulse; 401/403 signs out |

A shape guard rejects a malformed file to its "unavailable" state rather
than crashing the route (the existing `isAgentStatus` /
`isPendingQueue` pattern). Config problems fail the build (§ Config).

## Testing

- Vitest:
  - `lib/agent-config.ts` against the real `agent/` files (three topics,
    the AI Engineering cap override of 4, include/exclude present, batch
    40, prompt version, 23h, cron), and against fixtures for the merge
    rule and for each missing-constant throw;
  - `nextRun` across a day boundary and right on a slot;
  - `lib/pipeline-stages.ts` — numbers with and without `drops`, topic vs
    all, failures;
  - `lib/outcomes.ts` — a synthetic state reproducing `report.py`'s
    buckets, histogram and per-day counts;
  - `lib/queue-view.ts` — filters, counts, sort, next selection;
  - `isAgentStatus` with and without the new keys.
- The agent change: the throwaway script above.
- `npm run build` and `npm run serve`, then headless-Chrome screenshots at
  1440×900, 1280×720 and 375×812, and one keyboard pass (j/k, a, u) in
  owner mode against the live `tony-inbox` with the gh CLI token (approve
  then undo one item, as #5 was verified).

## Order of work

1. Site: config loader, pure modules, the page (works with today's
   `status.json`, without drop reasons).
2. Agent: `status_export.py` drops and failures.
3. Home teaser and link labels.
4. Docs: `PROGRESS.md`; `docs/tony-scraponi-roadmap.md` (this
   sub-project); `CLAUDE.md`'s `npm test` module list. The
   `/researcher/agent/` narrative's three mentions of "the queue page"
   stay true and don't change; `docs/agent-plan.md` doesn't describe
   `status.json`'s fields, so it doesn't change either.

Merging into `main` and pushing happen only when Artem says so.

## Later (out of scope)

- **Editing the config from the page.** It can't commit to this repo from
  the browser (a token that pushes here can change agent code that runs
  with the Telegram and DeepSeek secrets). Editable settings would live in
  a separate repo the agent only reads, like `hpnssflw/tony-inbox`, with
  `ConfigValue` becoming inputs.
- Triggering runs from the page, per-run history beyond `status.json`'s
  24 runs, and a `/researcher/agent/` redesign.
- The `/researcher/agent/` widget's countdown still uses
  `updated_at + cadence`; fixing it is a one-line follow-up using
  `nextRun`.
