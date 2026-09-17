# Tony Scraponi MVP — Pending Queue Page — Design

Sub-project #4 of the Content Direction & Tony Scraponi initiative (see
`docs/tony-scraponi-roadmap.md` and `PROGRESS.md`). Sub-projects #1 (agent
themes rework), #2 (Telegram delivery), and #3 (Blog content & direction)
are done.

Per the roadmap, this is *not* the separate FastAPI/Postgres/Redis app the
full Obsidian-vault product plan describes — it's a single page inside this
repo, reusing the existing JSON-state-files + GitHub Actions pattern already
proven by the agent status widget. "Source/topic visibility and monitoring"
first; editing sources, triggering runs, a scraper wizard, and multi-platform
publishing are explicitly out of scope, gated on this MVP proving out.

## Problem

Two things about the agent's actual output are already public, but
unreadable:

- `agent/pending.json` — the curated queue of items ranked above threshold
  and awaiting the next Telegram delivery cadence, with full titles,
  one-line summaries, and relevance scores per item — is pushed to the
  public `agent-data` branch on every run (confirmed during the agent status
  widget's final review). Nothing on the site renders it; the only way to
  see it today is to fetch the raw JSON by hand.
- The existing `/researcher/agent/` dashboard (`components/AgentWidget.tsx`,
  `lib/agent-status.ts`, backed by `agent/status.json`) covers run *health*
  — streak, per-topic funnel counts, a recent-events ticker, a bare
  `pending_count` — but not the queue's actual *contents*.

Separately, `agent/panel.py` + `agent/panel_page.html` is a local-only,
`127.0.0.1`-bound dev tool (reviewed as groundwork for this sub-project) that
does per-run funnel/drop-reason/event-log inspection. It answers "what
happened in this one run," a different question from "what does the agent
currently have queued" — this design doesn't duplicate it or try to
generalize it to the public site.

## Goal

A public page rendering the pending queue: what's currently curated and
waiting to go out, grouped by topic, readable by anyone — the same
transparency-by-construction the status widget already has, extended to the
one piece of public data nothing renders yet.

## Scope

1. `lib/pending-queue.ts` — types, a shape guard, and a grouping transform
   for `pending.json`.
2. `lib/pending-queue.test.ts` — Vitest coverage for both.
3. `components/PendingQueue.tsx` — client-side fetch-and-render.
4. `app/researcher/queue/page.tsx` — the route.
5. Nav links from `app/researcher/page.tsx` and
   `app/researcher/agent/page.tsx` to the new route.
6. `app/globals.css` additions for the new markup, extending the existing
   token/case system.

Out of scope: anything from `agent/panel.py` (per-run funnel/log
inspection); editing/triggering/publishing controls of any kind (explicitly
later scope per the roadmap); reconciling this page with
`agent/topics/*.yaml` source config (a candidate for a later sub-project,
not this one); changing `agent/pending.py` or any Python — this is
read-only, site-side consumption of data the agent already publishes
unchanged.

## Data flow

`lib/pending-queue.ts` exports:

- `PENDING_URL` —
  `https://raw.githubusercontent.com/hpnssflw/hpnssflw.github.io/agent-data/agent/pending.json`
  (same host/branch pattern as `STATUS_URL` in `lib/agent-status.ts`).
- `PendingItem` — `{ url: string; title: string; source: string; topic:
  string; topic_name: string; summary: string; score: number;
  pending_since: string }`, mirroring `agent/pending.py`'s `PendingItem`
  dataclass field-for-field.
- `PendingQueue` — `{ last_email_at: string | null; items: PendingItem[] }`,
  mirroring `agent/pending.py`'s `PendingQueue` dataclass (the `last_email_at`
  field name is kept as-is on the wire, per that module's own docstring
  explaining the historical SMTP-era name stays private/internal — this
  design doesn't rename it, only the component-facing label reads
  "last sent").
- `isPendingQueue(value): value is PendingQueue` — a structural guard run
  before the fetched payload is trusted in render, same reasoning as
  `isAgentStatus`: fields get read during React render, not inside
  `.then()`, so a shape drift must fail closed to an "unavailable" message
  rather than crash the route.
- `groupByTopic(queue): Record<string, PendingItem[]>` — groups by
  `topic_name`, each group's items sorted by `score` descending. The TS
  mirror of `agent/pending.py`'s own `group_by_topic`.

Fetching is fully client-side (`fetch(PENDING_URL, { cache: "no-store" })`
on mount, cancelled-effect guard) — not a build-time fetch. `pending.json`
updates every 4 hours via `.github/workflows/agent-run.yml`, but the site
only rebuilds on a push to `main`; a build-time fetch would show a stale
queue between deploys, which defeats the page's purpose. This matches
`AgentWidget`'s existing fetch strategy exactly.

## Component & page

`components/PendingQueue.tsx` (`"use client"`):

- Fetches `PENDING_URL` on mount; on fetch failure or an `isPendingQueue`
  rejection, renders an "queue unavailable" message (mirrors `AgentWidget`'s
  `Unavailable` component — no retry, no polling, consistent with the site's
  fetch-once-on-load philosophy).
- On success: a header line — `N queued · last sent <date, or "never" if
  last_email_at is null>`.
- If `items.length === 0`: a "nothing queued right now" message instead of
  an empty page.
- Otherwise, one section per topic (from `groupByTopic`, iterated in the
  order topics first appear in `items`): a heading (`topic_name`), then each
  item as a row — title linked to `url` (opens the source, not an internal
  link), the one-line `summary`, `score`, `source`, and `pending_since`
  (rendered as a plain date, no relative-time library — matches the site's
  "no heavyweight dependencies" rule).

`app/researcher/queue/page.tsx`: a thin route wrapper — `Metadata` (title
"Research Queue," description in the same register as
`/researcher/agent/`'s), rendered inside the standard `article`/`wrap` shell,
mounting `<PendingQueue />`.

**Navigation:** `app/researcher/page.tsx` gets a second `plan-link`-styled
link under the existing "A Research Agent" one, pointing at
`/researcher/queue/`. `app/researcher/agent/page.tsx`'s dashboard gets a
short link to the same route (the dashboard shows *that* something's
queued via `pending_count`; this page shows *what*) — placed after
`AgentWidget`, inside the page's own body copy, not inside the widget
component itself (the widget stays a pure `status.json` consumer).

## Styling

Extends `app/globals.css` with a handful of new classes (`.queue-header`,
`.queue-topic`, `.queue-item`, `.queue-meta` or similar, exact names decided
at implementation time) following the existing hand-built token + case
system. No Tailwind, no CSS-in-JS, no component library, per `CLAUDE.md`.

## Error handling

Identical to `AgentWidget`: a failed fetch or a payload that fails
`isPendingQueue` both collapse to the same "unavailable" state. No
distinction between "network error" and "malformed JSON" is surfaced to the
visitor — matches the existing widget's behavior and the site's general
philosophy of graceful, silent degradation on this kind of ambient status
UI.

## Testing

`lib/pending-queue.test.ts` (Vitest, same file structure as
`lib/agent-status.test.ts`):

- `isPendingQueue`: accepts a well-formed payload; rejects non-objects,
  nulls, missing/wrong-typed fields, and an `items` array containing a
  malformed item.
- `groupByTopic`: groups multiple items under the same `topic_name`
  correctly; sorts each group by `score` descending; handles an empty
  `items` array; handles a tie on `score` without throwing.

No Python-side tests — `agent/pending.py` and `pending.json`'s shape are
unchanged by this work.

Manual verification: `npm run build && npm run serve`, confirm
`/researcher/queue/` renders real data fetched from the live `agent-data`
branch (mirrors how the agent status widget tasks verified against live
production JSON, not just fixtures), confirm the empty-queue and
fetch-failure states render sensibly (temporarily pointing `PENDING_URL` at
a bad URL, or checking against a moment when the queue is legitimately
empty), and confirm both new nav links resolve. `npm test` stays green.
