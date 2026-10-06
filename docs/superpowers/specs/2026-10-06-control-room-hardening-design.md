# Control Room Hardening — Design

Closes three items the control room's final whole-branch review deferred
(sub-project #8, `PROGRESS.md`: M1, M2, M4) and one item from its "Later"
list (the home countdown). Site-only: nothing under `agent/` changes.
Settled with Artem during brainstorming on 2026-10-06.

## Problem

- **M1: a malformed date crashes the control room.** `ControlPulse`
  renders `new Date(status.updated_at).toISOString()`, which throws on an
  invalid date, and nothing catches it — `/researcher/queue/` goes blank.
  `isAgentStatus` checks `updated_at` is a string, not that it parses.
  The same gap runs deeper: the guard never looks inside `topics[]`,
  `run_history[]` or `recent_events[]`, and never checks `last_sent_at`.
  A `recent_events` entry without `ts` crashes `/researcher/agent/`
  (`e.ts.slice`); a numeric `last_sent_at` crashes the control room's pulse
  and rail (`.slice` in `ControlPulse` and `lib/pipeline-stages.ts`).
- **M2: one guard, three consumers.** `AgentWidget` (home, `/researcher/
  agent/`), `AppsStrip` (home teaser) and `ControlRoom` share
  `isAgentStatus`. A malformed `drops` or `failures` — fields only the
  control room's rail reads — rejects the whole payload, so the home
  widget and teaser show "unavailable" too.
- **M4: queue links aren't scheme-checked.** `QueuePane` puts each
  pending item's `url` straight into `href` and `window.open`. React 19
  already blocks `javascript:` URLs; other schemes (`file:`, `data:`, app
  handlers such as `vscode:`) are not checked. The owner's inbox token
  lives in this page's `localStorage`, so links there should be http(s)
  only. Defense in depth — the URLs come from HN and GitHub via the agent.
- **Countdown.** The home agent widget's "next check" countdown (the
  `compact` variant of `AgentWidget`; `#8`'s "Later" note misplaced it on
  `/researcher/agent/`, which shows the `dashboard` variant and has no
  countdown) uses `updated_at + cadence_hours`. The agent runs on
  `agent-run.yml`'s cron, so after a manual run at 09:35 it counts down to
  13:35 while the control room — which uses `lib/cron.ts`'s `nextRun` —
  correctly says 12:00.

## Goal

1. No malformed `status.json` can crash a route; it shows "unavailable".
2. A malformed `drops`/`failures` costs only the rail's drop reasons, not
   the home widget, the teaser, or the rest of the control room.
3. Only http(s) queue links are clickable or openable.
4. The home countdown and the control room agree on the next run.

## Decisions (settled during brainstorming, 2026-10-06)

- **The `AgentStatus` type is the contract.** The guard checks every field
  the type declares, at every level — not only the fields read today. A
  rename or new value on the agent side must be mirrored in
  `lib/agent-status.ts`, as `lib/agent-config.ts` already demands for
  agent constants.
- **Required fields fail closed, optional fields fail soft.**
  Parse-and-strip, not two guards and not error boundaries: one
  `parseAgentStatus` returns `null` when a required field is bad, and drops
  a malformed `drops`/`failures` while accepting the rest.
- **Non-http(s) items stay in the queue, unlinked.** Filtering them out
  would leave Artem unable to reject them (they'd expire after 7 days) and
  put the queue's counts out of step with `status.json`'s `pending_count`.

## Design

### 1. `lib/agent-status.ts` — `parseAgentStatus` (M1, M2)

`parseAgentStatus(value: unknown): AgentStatus | null` replaces
`isAgentStatus`, which is removed (its three callers move over).

**Required — any failure returns `null`:**

| field | check |
|---|---|
| `cadence_hours`, `delivery_cadence_hours`, `streak`, `pending_count` | number |
| `updated_at` | date string |
| `last_sent_at` | `null` or date string |
| `topics` | array; each entry has `slug`, `name` (strings), `collected`, `kept` (numbers) |
| `funnel` | object; every value has `collected`, `in_window`, `new`, `kept` (numbers); every topic's `slug` has an entry |
| `run_history` | array; each entry has `kept` (number), `ts` (date string) |
| `recent_events` | array; each entry has `ts` (date string), `verdict` (`"kept"` or `"drop"`), `topic`, `title` (strings), `reason` (absent or string), `score` (absent or number) |

A *date string* is a string `Date.parse` accepts — a local `isDate`
helper, the same two lines as `lib/claude-presence.ts`'s.

Unknown extra keys pass through untouched (the agent writes `source` on
kept events, which the type doesn't declare).

**Optional — a malformed value is left out of the result:**

- `drops` — must pass the existing `isDropCounts`.
- `failures` — must be an array of entries passing the existing
  `isRunFailure`.

Absent stays absent. With either one stripped, the rail renders exactly
as it did for `status.json` written before 2026-10: `lib/pipeline-stages.ts`
already shows `—` and no drop lines when `drops` is undefined.

The returned object is a shallow copy of the input minus any stripped
optional field; the input is not mutated.

`nextRunAt` is deleted — its only caller was the home countdown (§2).
`isStale`, `sparklineCells`, `fmtCountdown` are unchanged.

### 2. Consumers and the countdown

- `AgentWidget`: `const status = parseAgentStatus(data); if (status)
  setStatus(status); else setFailed(true);`
- `AppsStrip`: same, still silent on failure (the proof line stays hidden).
- `ControlRoom`: `acceptStatus` becomes `parseAgentStatus` itself — a
  stable, module-level function, as `useJson` requires.

**Countdown.** `AgentWidget`'s props become a discriminated union:

```ts
type Props = { variant: "compact"; schedule: CronSchedule } | { variant: "dashboard" };
```

`app/page.tsx` (a server component) passes
`schedule={loadAgentConfig().schedule}`. The compact variant's 1-second
tick computes `nextRun(schedule, new Date())` and renders
`next check {fmtCountdown(...)}` — the same slot the control room's pulse
shows. `/researcher/agent/` (`dashboard`) is unchanged.

Side effect: the home page now reads `agent/` at build time, so an agent
constant `lib/agent-config.ts` can't find fails the home page's build as
well as `/researcher/queue/`'s. The site build already fails as a whole
in that case, so nothing new can break.

### 3. `lib/pending-queue.ts` + `QueuePane` — http(s)-only links (M4)

`safeHref(url: string): string | null` returns `url` when
`new URL(url).protocol` is `http:` or `https:`, otherwise `null`
(including when `new URL` throws, e.g. a relative path).

In `components/QueuePane.tsx`, for an item where `safeHref` is `null`:

- **open ↗** renders as a disabled `inbox-button` `<button>` (no `href`),
  titled "not an http(s) link", same label.
- The **o** key does nothing (`window.open` only gets a non-null
  `safeHref`).
- The **domain** line shows the scheme (`javascript:`) for a parseable
  URL and `invalid url` for an unparseable one, instead of a blank —
  so the reason the link is missing is visible.

The item's title, summary, score and approve/reject/undo are untouched;
`isPendingQueue` is unchanged.

## Error handling

| bad input | home widget + teaser | `/researcher/agent/` | control room |
|---|---|---|---|
| required field missing/malformed, incl. bad date | "unavailable" / hidden | "unavailable" | pulse "status unavailable", rail `—`, rest live |
| malformed `drops` | normal | normal | normal, rail without drop reasons |
| malformed `failures` | normal | normal | normal, no failure marks |
| queue item with non-http(s) URL | — | — | item listed, no link, scheme shown |

## Testing

Vitest (`npm test`):

- `parseAgentStatus` (replaces the `isAgentStatus` suites in
  `lib/agent-status.test.ts`):
  - a full valid payload comes back deep-equal; one with extra keys too;
  - each required field rejected when missing or the wrong type,
    including entry-level cases (`topics` entry without `name`,
    `run_history` entry without `ts`, `recent_events` entry with
    `verdict: "maybe"`, `score: "7"`);
  - invalid dates rejected: `updated_at: "yesterday"`,
    `last_sent_at: 5`, `last_sent_at: "not a date"`,
    a `run_history`/`recent_events` `ts` that doesn't parse;
  - `last_sent_at: null` accepted;
  - malformed `drops` (the existing bad cases) → payload accepted,
    `drops` absent, `failures` kept; same the other way round;
  - absent `drops`/`failures` stay absent; the input object is not mutated.
- `nextRunAt` tests removed.
- `safeHref` (`lib/pending-queue.test.ts`): `http://`, `https://` kept;
  `javascript:alert(1)`, `data:text/html,x`, `mailto:a@b`, `file:///etc`,
  `/relative`, `not a url` → `null`.

Site verification (`CLAUDE.md`): `npm run build` + `npm run serve`, then
a headless check:

- the home widget's "next check" counts down to the same UTC slot the
  control room's pulse shows as "next";
- `/researcher/queue/` and `/researcher/agent/` render as before against
  live data;
- `npm test` passes.

The non-http(s) queue path and the stripped-`drops` path are covered by
unit tests; no live data exercises them.

## Order of work

1. `parseAgentStatus` + its three consumers + tests (M1, M2).
2. Home countdown from the cron schedule; `nextRunAt` removed.
3. `safeHref` + `QueuePane` + tests (M4).
4. `PROGRESS.md`: mark M1, M2, M4 and the countdown done in #8's bullet,
   correct the countdown's location.

## Out of scope

- `isPendingQueue` stays all-or-nothing: one bad item still blanks the
  queue pane. Not one of the deferred items, and the queue's producer is
  as strict as `status.json`'s.
- `pending_since` date validation (rendered via `.slice`, can't crash).
- Item URLs in the agent's Telegram digest — agent-side, not site work.
- #8's other deferred task-review minors and config editing from the page.
