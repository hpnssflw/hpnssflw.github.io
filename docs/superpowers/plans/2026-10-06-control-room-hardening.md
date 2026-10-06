# Control Room Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** No malformed `status.json` can crash a route or blank widgets that don't read the bad field, the control room links only http(s) queue items, and the home widget's countdown agrees with the control room's next cron slot.

**Architecture:** `parseAgentStatus` in `lib/agent-status.ts` replaces the shallow `isAgentStatus` guard: it checks every field the `AgentStatus` type declares (entries included, dates must parse) and returns `null` on a bad required field, but strips a malformed optional `drops`/`failures` and accepts the rest. Its three consumers switch over. The home `AgentWidget` gets the cron schedule from `lib/agent-config.ts` at build time and counts down with `lib/cron.ts`'s `nextRun`. `lib/pending-queue.ts` gains `safeHref`/`itemDomain`, which `QueuePane` uses for its open link, `o` key and domain line.

**Tech Stack:** Next.js 16 App Router, static export, React 19, TypeScript, Vitest 4. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-06-control-room-hardening-design.md`

## Global Constraints

- Site-only: never edit `agent/` or `.github/workflows/agent-run.yml`.
- The `AgentStatus` type is the contract: `parseAgentStatus` checks every field the type declares, at every level. Required fields fail closed (`null`); `drops` and `failures` fail soft (left out of the result). Unknown extra keys pass through. The input is never mutated.
- A *date string* is a string for which `Date.parse` is not `NaN`.
- Non-http(s) queue items stay in the queue, unlinked: disabled "open ↗" button titled `not an http(s) link`, `o` does nothing, domain line shows the scheme (`javascript:`) or `invalid url`.
- No new dependencies. No Tailwind/CSS-in-JS/component library; this plan needs no CSS (`.inbox-button:disabled` already exists in `app/globals.css`).
- No React state set synchronously in an effect body except through a local `tick()` as `AgentWidget.tsx` already does (eslint `react-hooks/set-state-in-effect`). Don't call `Date.now()`/`new Date()` without arguments during render.
- Client components never import `lib/agent-config.ts` (it uses `node:fs`); `lib/cron.ts` is safe to import from the client.
- Work happens in the worktree `C:\A\polozov\.claude\worktrees\admin-panel` on branch `worktree-admin-panel`. Don't merge into `main` or push until Artem says so (Task 3, Step 12). Never enter another worktree.
- Serve the export with `npx serve out -l 3100` (3000 belongs to the main checkout); if 3100 is taken, use the port `serve` prints. Don't run `npm run build` while a dev server is up.
- Throwaway check scripts live in `.superpowers/sdd/2026-10-06-control-room-hardening/` (git-ignored). Python on this machine is `py -3`.
- Never stage `.claude/settings.local.json`. Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- After each task: update `PROGRESS.md` in the task's commit as the task says, then stop and hand off per `CLAUDE.md` ("Clean context after each micro-task").

## File map

| File | Change | Task |
|---|---|---|
| `lib/agent-status.ts` | `parseAgentStatus` replaces `isAgentStatus`; `nextRunAt` removed | 1, 2 |
| `lib/agent-status.test.ts` | `parseAgentStatus` suites; `nextRunAt` suite removed | 1, 2 |
| `components/AgentWidget.tsx` | uses `parseAgentStatus`; compact variant takes `schedule` | 1, 2 |
| `components/AppsStrip.tsx` | uses `parseAgentStatus` | 1 |
| `components/ControlRoom.tsx` | `useJson(STATUS_URL, parseAgentStatus)` | 1 |
| `lib/pending-queue.ts` | doc comment (Task 1); `safeHref`, `itemDomain` (Task 3) | 1, 3 |
| `lib/pending-queue.test.ts` | `safeHref`, `itemDomain` tests | 3 |
| `components/QueuePane.tsx` | http(s)-only open link and `o` key, `itemDomain` | 3 |
| `app/page.tsx` | passes the cron schedule to the widget | 2 |
| `CLAUDE.md` | status.json contract (Task 1); home reads the cron too (Task 2) | 1, 2 |
| `PROGRESS.md` | #8 bullet, "How to resume" | 1, 2, 3 |

---

### Task 1: `parseAgentStatus` and its consumers (M1, M2)

**Files:**
- Modify: `lib/agent-status.ts:89-116` (the `isAgentStatus` doc comment and function)
- Modify: `lib/agent-status.test.ts`
- Modify: `components/AgentWidget.tsx`, `components/AppsStrip.tsx`, `components/ControlRoom.tsx`
- Modify: `lib/pending-queue.ts:36-39` (doc comment only)
- Modify: `CLAUDE.md`, `PROGRESS.md`

**Interfaces:**
- Consumes: the existing `AgentStatus`, `TopicStatus`, `FunnelCounts`, `RunHistoryEntry`, `RecentEvent` types and the private `isRecord`, `isDropCounts`, `isRunFailure` helpers in `lib/agent-status.ts`.
- Produces: `export function parseAgentStatus(value: unknown): AgentStatus | null` in `lib/agent-status.ts`. `isAgentStatus` no longer exists.

- [ ] **Step 1: Write the failing tests**

In `lib/agent-status.test.ts`, replace the import block (lines 1-9) with:

```ts
import { describe, expect, it } from "vitest";
import {
  type AgentStatus,
  fmtCountdown,
  isStale,
  nextRunAt,
  parseAgentStatus,
  sparklineCells,
} from "./agent-status";
```

Directly after `makeStatus` (after line 25), add the shared fixture:

```ts
const good = makeStatus({
  last_sent_at: "2026-09-30T04:08:45.319706+00:00",
  topics: [{ slug: "tooling", name: "Tooling", collected: 3, kept: 1 }],
  funnel: { tooling: { collected: 3, in_window: 3, new: 2, kept: 1 } },
  run_history: [{ kept: 1, ts: "2026-09-09T08:00:00+00:00" }],
  recent_events: [
    { ts: "2026-09-09T08:00:00+00:00", verdict: "kept", topic: "tooling", title: "A tool", score: 7 },
    { ts: "2026-09-09T07:59:00+00:00", verdict: "drop", topic: "tooling", title: "Not a tool", reason: "below_threshold" },
  ],
});
const [keptEvent, dropEvent] = good.recent_events;

function without(key: keyof AgentStatus): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...good };
  delete copy[key];
  return copy;
}
```

Replace the whole `describe("isAgentStatus", ...)` block (old lines 27-54) with:

```ts
describe("parseAgentStatus", () => {
  it("returns a well-formed payload unchanged", () => {
    expect(parseAgentStatus(good)).toStrictEqual(good);
  });

  it("passes unknown keys through (kept events carry source)", () => {
    const withSource = { ...good, recent_events: [{ ...keptEvent, source: "hacker_news" }] };
    expect(parseAgentStatus(withSource)).toStrictEqual(withSource);
  });

  it("rejects non-objects", () => {
    for (const value of [null, undefined, "nope", 3, []]) expect(parseAgentStatus(value)).toBeNull();
  });

  it.each([
    "cadence_hours",
    "delivery_cadence_hours",
    "streak",
    "pending_count",
    "updated_at",
    "last_sent_at",
    "topics",
    "funnel",
    "run_history",
    "recent_events",
  ] as (keyof AgentStatus)[])("rejects a payload without %s", (key) => {
    expect(parseAgentStatus(without(key))).toBeNull();
  });

  it("rejects wrong-typed top-level fields", () => {
    expect(parseAgentStatus({ ...good, streak: "1" })).toBeNull();
    expect(parseAgentStatus({ ...good, topics: {} })).toBeNull();
    expect(parseAgentStatus({ ...good, funnel: null })).toBeNull();
    expect(parseAgentStatus({ ...good, last_sent_at: 5 })).toBeNull();
  });

  it("rejects dates that don't parse", () => {
    expect(parseAgentStatus({ ...good, updated_at: "yesterday" })).toBeNull();
    expect(parseAgentStatus({ ...good, last_sent_at: "not a date" })).toBeNull();
    expect(parseAgentStatus({ ...good, run_history: [{ kept: 1, ts: "soon" }] })).toBeNull();
    expect(parseAgentStatus({ ...good, recent_events: [{ ...keptEvent, ts: "" }] })).toBeNull();
  });

  it("accepts last_sent_at null (nothing sent yet)", () => {
    expect(parseAgentStatus({ ...good, last_sent_at: null })).toStrictEqual({ ...good, last_sent_at: null });
  });

  it("rejects malformed entries inside the collections", () => {
    expect(parseAgentStatus({ ...good, topics: [{ slug: "tooling", collected: 3, kept: 1 }] })).toBeNull();
    expect(parseAgentStatus({ ...good, funnel: { tooling: { collected: 3, in_window: 3, kept: 1 } } })).toBeNull();
    expect(parseAgentStatus({ ...good, funnel: { ...good.funnel, retired: 5 } })).toBeNull();
    expect(parseAgentStatus({ ...good, run_history: [{ ts: "2026-09-09T08:00:00+00:00" }] })).toBeNull();
    expect(parseAgentStatus({ ...good, recent_events: [{ ...keptEvent, verdict: "maybe" }] })).toBeNull();
    expect(parseAgentStatus({ ...good, recent_events: [{ ...keptEvent, score: "7" }] })).toBeNull();
    expect(parseAgentStatus({ ...good, recent_events: [{ ...dropEvent, reason: 3 }] })).toBeNull();
    expect(parseAgentStatus({ ...good, recent_events: [{ ...dropEvent, title: undefined }] })).toBeNull();
  });

  it("rejects a topic with no funnel entry", () => {
    expect(parseAgentStatus({ ...good, funnel: {} })).toBeNull();
  });
});
```

Replace the whole `describe("isAgentStatus — drops and failures", ...)` block (old lines 108-142) with:

```ts
describe("parseAgentStatus — drops and failures", () => {
  const drops = { tooling: { dedupe: { seen: 2, already_ranked: 1 } } };
  const failures = [
    { stage: "collect", topic: "tooling", source: "github_trending" },
    { stage: "deliver", topic: null, source: null },
  ];

  it("leaves them absent when the payload has none (written before 2026-10)", () => {
    const status = parseAgentStatus(good);
    expect(status).not.toBeNull();
    expect(status).not.toHaveProperty("drops");
    expect(status).not.toHaveProperty("failures");
  });

  it("keeps well-formed drops and failures", () => {
    expect(parseAgentStatus({ ...good, drops, failures })).toStrictEqual({ ...good, drops, failures });
  });

  it.each([
    ["a non-number count", { tooling: { dedupe: { seen: "2" } } }],
    ["an array", []],
    ["an array of stages", { tooling: [] }],
  ])("strips drops with %s and keeps the rest", (_, bad) => {
    expect(parseAgentStatus({ ...good, drops: bad, failures })).toStrictEqual({ ...good, failures });
  });

  it.each([
    ["an object", {}],
    ["a numeric stage", [{ stage: 1, topic: null, source: null }]],
    ["a numeric topic", [{ stage: "rank", topic: 3, source: null }]],
  ])("strips failures with %s and keeps the rest", (_, bad) => {
    expect(parseAgentStatus({ ...good, drops, failures: bad })).toStrictEqual({ ...good, drops });
  });

  it("does not modify its input", () => {
    const input = { ...good, drops: [], failures };
    const before = structuredClone(input);
    parseAgentStatus(input);
    expect(input).toStrictEqual(before);
  });
});
```

Leave the `isStale`, `fmtCountdown`, `sparklineCells` and `nextRunAt` suites as they are.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/agent-status.test.ts`
Expected: FAIL — `parseAgentStatus` is not exported (`TypeError: parseAgentStatus is not a function` or an import error), across the new suites.

- [ ] **Step 3: Implement `parseAgentStatus`**

In `lib/agent-status.ts`, replace the doc comment and function from `/**` at line 89 (" * Structural guard for a fetched `status.json`...") through the closing `}` of `isAgentStatus` (line 116) with:

```ts
function isDate(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

const isNumber = (value: unknown): value is number => typeof value === "number";
const isString = (value: unknown): value is string => typeof value === "string";

function isTopicStatus(value: unknown): value is TopicStatus {
  return isRecord(value) && isString(value.slug) && isString(value.name) && isNumber(value.collected) && isNumber(value.kept);
}

function isFunnelCounts(value: unknown): value is FunnelCounts {
  return (
    isRecord(value) &&
    isNumber(value.collected) &&
    isNumber(value.in_window) &&
    isNumber(value.new) &&
    isNumber(value.kept)
  );
}

function isRunHistoryEntry(value: unknown): value is RunHistoryEntry {
  return isRecord(value) && isNumber(value.kept) && isDate(value.ts);
}

function isRecentEvent(value: unknown): value is RecentEvent {
  return (
    isRecord(value) &&
    isDate(value.ts) &&
    (value.verdict === "kept" || value.verdict === "drop") &&
    isString(value.topic) &&
    isString(value.title) &&
    (value.reason === undefined || isString(value.reason)) &&
    (value.score === undefined || isNumber(value.score))
  );
}

function hasRequiredFields(
  s: Record<string, unknown>,
): s is Record<string, unknown> & Omit<AgentStatus, "drops" | "failures"> {
  const { topics, funnel } = s;
  return (
    isNumber(s.cadence_hours) &&
    isNumber(s.delivery_cadence_hours) &&
    isNumber(s.streak) &&
    isNumber(s.pending_count) &&
    isDate(s.updated_at) &&
    (s.last_sent_at === null || isDate(s.last_sent_at)) &&
    Array.isArray(topics) &&
    topics.every(isTopicStatus) &&
    isRecord(funnel) &&
    Object.values(funnel).every(isFunnelCounts) &&
    topics.every((t) => isFunnelCounts(funnel[t.slug])) &&
    Array.isArray(s.run_history) &&
    s.run_history.every(isRunHistoryEntry) &&
    Array.isArray(s.recent_events) &&
    s.recent_events.every(isRecentEvent)
  );
}

/**
 * Validates a fetched `status.json` against `AgentStatus`. Its fields are
 * read during React render, so a payload that doesn't match the type has
 * to be caught here or it crashes the route. Every required field is
 * checked, entries included, and dates must parse: any failure returns
 * null, which the pages show as "unavailable". The optional `drops` and
 * `failures` (only the control room's rail reads them) fail soft — a
 * malformed one is left out, so it can't blank the home widgets. Returns
 * a copy; unknown keys pass through.
 */
export function parseAgentStatus(value: unknown): AgentStatus | null {
  if (!isRecord(value)) return null;
  const { drops, failures, ...rest } = value;
  if (!hasRequiredFields(rest)) return null;
  const status: AgentStatus = { ...rest };
  if (isDropCounts(drops)) status.drops = drops;
  if (Array.isArray(failures) && failures.every(isRunFailure)) status.failures = failures;
  return status;
}
```

(`funnel[t.slug]` goes through `isFunnelCounts`, so a slug such as `toString` that only exists on the prototype is rejected too.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/agent-status.test.ts`
Expected: PASS, all suites.

- [ ] **Step 5: Move the three consumers to `parseAgentStatus`**

`components/AgentWidget.tsx` — in the import from `@/lib/agent-status`, replace `isAgentStatus,` with `parseAgentStatus,` (keep the list alphabetical: after `nextRunAt,`):

```ts
import {
  type AgentStatus,
  type SparkCell,
  STATUS_URL,
  fmtCountdown,
  isStale,
  nextRunAt,
  parseAgentStatus,
  sparklineCells,
} from "@/lib/agent-status";
```

and replace the second `.then`:

```ts
      .then((data: unknown) => {
        if (cancelled) return;
        if (isAgentStatus(data)) setStatus(data);
        else setFailed(true);
      })
```

with:

```ts
      .then((data: unknown) => {
        if (cancelled) return;
        const parsed = parseAgentStatus(data);
        if (parsed) setStatus(parsed);
        else setFailed(true);
      })
```

`components/AppsStrip.tsx` — change the import to:

```ts
import { type AgentStatus, isStale, parseAgentStatus, STATUS_URL } from "@/lib/agent-status";
```

and replace:

```ts
      .then((data: unknown) => {
        if (!cancelled && isAgentStatus(data)) setStatus(data);
      })
```

with:

```ts
      .then((data: unknown) => {
        const parsed = parseAgentStatus(data);
        if (!cancelled && parsed) setStatus(parsed);
      })
```

`components/ControlRoom.tsx` — change the import to:

```ts
import { STATUS_URL, parseAgentStatus } from "@/lib/agent-status";
```

delete the line:

```ts
const acceptStatus = (value: unknown): AgentStatus | null => (isAgentStatus(value) ? value : null);
```

and change `const status = useJson(STATUS_URL, acceptStatus);` to:

```ts
  const status = useJson(STATUS_URL, parseAgentStatus);
```

(`parseAgentStatus` is a module-level function, so it is stable, as `useJson` requires. `AgentStatus` is no longer used in `ControlRoom.tsx`; if `tsc` or eslint says otherwise, keep the type import.)

`lib/pending-queue.ts` — in the `isPendingQueue` doc comment, replace:

```ts
 * Structural guard for a fetched `pending.json`. Mirrors
 * `lib/agent-status.ts`'s `isAgentStatus`: fields get read during React
```

with:

```ts
 * Structural guard for a fetched `pending.json`. Mirrors
 * `lib/agent-status.ts`'s `parseAgentStatus`: fields get read during React
```

- [ ] **Step 6: Typecheck, lint, full tests**

Run: `npx tsc --noEmit`
Expected: no output, exit 0.

Run: `npx eslint app components lib`
Expected: no errors.

Run: `npm test`
Expected: all suites pass.

Run: `git grep -n "isAgentStatus" -- app components lib`
Expected: no matches.

- [ ] **Step 7: Build and check the three pages against live data**

Run: `npm run build`
Expected: static export into `out/` with no errors. (The home page fetches Telegram at build time; if t.me is unreachable the build still succeeds.)

Create `.superpowers/sdd/2026-10-06-control-room-hardening/` and copy `.superpowers/sdd/2026-10-06-control-room/cdp.mjs` into it. If that file is gone, recreate it from `docs/superpowers/plans/2026-10-06-tony-control-room.md` (search for "Create `.superpowers/sdd/2026-10-06-control-room/cdp.mjs`"). Usage: `node --experimental-websocket cdp.mjs <url> <out.png> <width> <height> [script.js ...]` — it prints each script's return value.

Create `.superpowers/sdd/2026-10-06-control-room-hardening/t1-render.js`:

```js
(async () => {
  await new Promise((r) => setTimeout(r, 4000));
  return {
    unavailable: [...document.querySelectorAll(".agent-unavailable")].map((n) => n.textContent),
    widget: (document.querySelector(".agent-widget-card, .agent-dashboard-header")?.textContent ?? null)?.slice(0, 80),
    proof: document.querySelector(".tony-proof")?.textContent ?? null,
    pulse: document.querySelector(".cr-pulse-line")?.textContent ?? null,
    rail: [...document.querySelectorAll(".cr-rail .cr-node-line")].map((n) => n.textContent).filter(Boolean),
  };
})()
```

Run (separate terminal, leave running): `npx serve out -l 3100`

Run, from the worktree root:

```
node --experimental-websocket .superpowers/sdd/2026-10-06-control-room-hardening/cdp.mjs http://localhost:3100/ .superpowers/sdd/2026-10-06-control-room-hardening/t1-home.png 1440 900 .superpowers/sdd/2026-10-06-control-room-hardening/t1-render.js
node --experimental-websocket .superpowers/sdd/2026-10-06-control-room-hardening/cdp.mjs http://localhost:3100/researcher/agent/ .superpowers/sdd/2026-10-06-control-room-hardening/t1-agent.png 1440 900 .superpowers/sdd/2026-10-06-control-room-hardening/t1-render.js
node --experimental-websocket .superpowers/sdd/2026-10-06-control-room-hardening/cdp.mjs http://localhost:3100/researcher/queue/ .superpowers/sdd/2026-10-06-control-room-hardening/t1-queue.png 1440 900 .superpowers/sdd/2026-10-06-control-room-hardening/t1-render.js
```

Expected:
- home: `unavailable: []`, `widget` starts with `● agent online` or `● agent stale`, `proof` reads `● agent live · N found · N kept · N queued` (or `paused`);
- `/researcher/agent/`: `unavailable: []`, `widget` starts with `● AGENT`;
- `/researcher/queue/`: `unavailable: []`, `pulse` contains `last run`, `rail` has drop-reason lines such as `−56 seen · −0 dismissed` (proves live `drops` survive the parser).

Look at the three screenshots. Stop the server.

- [ ] **Step 8: Document the contract and update PROGRESS**

`CLAUDE.md` — at the end of the `/researcher/queue/` bullet, after "update `lib/agent-config.ts` in the same change.", add (same indentation, rewrapped to the file's width):

```
  `status.json` is held to `lib/agent-status.ts`'s `AgentStatus` type the
  same way at run time: `parseAgentStatus` checks every field the type
  declares, so an agent change that renames, removes or retypes one (or
  adds a `recent_events` verdict) must update that type and guard in the
  same change, or every agent widget shows "unavailable".
```

`PROGRESS.md` — in the #8 bullet, replace:

```
  Deferred: M1 (`isAgentStatus` doesn't validate dates — a malformed date
  would crash the route), M2 (`isAgentStatus` is shared, so a bad
  `drops`/`failures` would blank the home teaser and agent widget too —
  consider a softer guard before sub-project D), M4 (the queue could
  refuse non-http(s) item URLs), plus the remaining task-review minors.
```

with:

```
  Deferred: M4 (the queue could refuse non-http(s) item URLs), plus the
  remaining task-review minors.
  **Hardening (in progress, 2026-10-06):** spec
  `docs/superpowers/specs/2026-10-06-control-room-hardening-design.md`,
  plan `docs/superpowers/plans/2026-10-06-control-room-hardening.md`.
  Task 1 done: `parseAgentStatus` replaces `isAgentStatus` — every field
  the `AgentStatus` type declares is checked, entries included, dates
  must parse; a malformed `drops`/`failures` is stripped instead of
  blanking the home widgets (M1, M2). Next: Task 2 (home countdown).
```

- [ ] **Step 9: Commit**

```bash
git add lib/agent-status.ts lib/agent-status.test.ts components/AgentWidget.tsx components/AppsStrip.tsx components/ControlRoom.tsx lib/pending-queue.ts CLAUDE.md PROGRESS.md
git commit -m "Validate every status.json field and strip a bad drops/failures

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Then hand off per `CLAUDE.md`.

---

### Task 2: Home countdown from the cron schedule

**Files:**
- Modify: `components/AgentWidget.tsx`
- Modify: `app/page.tsx`
- Modify: `lib/agent-status.ts` (delete `nextRunAt`, the last function in the file)
- Modify: `lib/agent-status.test.ts` (delete the `nextRunAt` suite)
- Modify: `CLAUDE.md`, `PROGRESS.md`

**Interfaces:**
- Consumes: `type CronSchedule` and `nextRun(schedule: CronSchedule, now: Date): Date` from `lib/cron.ts` (first slot strictly after `now`; already tested in `lib/cron.test.ts`); `loadAgentConfig(): AgentConfig` from `lib/agent-config.ts`, whose `schedule: CronSchedule` is parsed from `agent-run.yml`'s `cron:` line; `parseAgentStatus` from Task 1.
- Produces: `AgentWidget` props are `{ variant: "compact"; schedule: CronSchedule } | { variant: "dashboard" }`. `nextRunAt` no longer exists.

- [ ] **Step 1: Remove `nextRunAt` and its test**

In `lib/agent-status.test.ts`, delete the whole `describe("nextRunAt", ...)` block and remove `nextRunAt,` from the import.

In `lib/agent-status.ts`, delete:

```ts
/** Epoch ms of the next expected run. */
export function nextRunAt(status: AgentStatus): number {
  return (
    new Date(status.updated_at).getTime() +
    status.cadence_hours * 3600 * 1000
  );
}
```

- [ ] **Step 2: Typecheck to see the one caller break**

Run: `npx tsc --noEmit`
Expected: FAIL — `components/AgentWidget.tsx`: `Module '"@/lib/agent-status"' has no exported member 'nextRunAt'.`

- [ ] **Step 3: Give the compact widget the schedule**

In `components/AgentWidget.tsx`:

Replace the agent-status import and add the cron import:

```ts
import {
  type AgentStatus,
  type SparkCell,
  STATUS_URL,
  fmtCountdown,
  isStale,
  parseAgentStatus,
  sparklineCells,
} from "@/lib/agent-status";
import { type CronSchedule, nextRun } from "@/lib/cron";
```

Replace `type Variant = "compact" | "dashboard";` with:

```ts
/** The home card counts down to agent-run.yml's next cron slot, read at build time. */
type Props = { variant: "compact"; schedule: CronSchedule } | { variant: "dashboard" };
```

Replace the component's opening:

```ts
export default function AgentWidget({ variant }: { variant: Variant }) {
  const mountId = variant === "compact" ? "agent-widget" : "agent-dashboard";
```

with:

```ts
export default function AgentWidget(props: Props) {
  const { variant } = props;
  const schedule = props.variant === "compact" ? props.schedule : null;
  const mountId = variant === "compact" ? "agent-widget" : "agent-dashboard";
```

Replace the countdown effect:

```ts
  useEffect(() => {
    if (!status || variant !== "compact") return;
    const target = nextRunAt(status);
    const tick = () => {
      const remaining = Math.round((target - Date.now()) / 1000);
      setCountdown(`next check ${fmtCountdown(remaining)}`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [status, variant]);
```

with:

```ts
  useEffect(() => {
    if (!status || schedule === null) return;
    const tick = () => {
      const now = new Date();
      const remaining = Math.round((nextRun(schedule, now).getTime() - now.getTime()) / 1000);
      setCountdown(`next check ${fmtCountdown(remaining)}`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [status, schedule]);
```

In `app/page.tsx`, add the import (after the `@/lib/home-feed` import, keeping `@/lib` imports together):

```ts
import { loadAgentConfig } from "@/lib/agent-config";
```

inside `HomePage`, after the `slides` constant, add:

```ts
  // The agent widget counts down to agent-run.yml's next cron slot.
  const { schedule } = loadAgentConfig();
```

and change `<AgentWidget variant="compact" />` to:

```tsx
          <AgentWidget variant="compact" schedule={schedule} />
```

`app/researcher/agent/page.tsx` keeps `<AgentWidget variant="dashboard" />` unchanged.

- [ ] **Step 4: Typecheck, lint, tests**

Run: `npx tsc --noEmit`
Expected: exit 0.

Run: `npx eslint app components lib`
Expected: no errors.

Run: `npm test`
Expected: all pass.

Run: `git grep -n "nextRunAt" -- app components lib`
Expected: no matches.

- [ ] **Step 5: Build and check the countdown**

Run: `npm run build`
Expected: no errors.

Check the schedule the check assumes: `grep -n "cron:" .github/workflows/agent-run.yml` — expected `- cron: "0 */4 * * *"`. If it differs, change `SLOT_HOURS` below to match (the check only handles `0 */N * * *`).

Create `.superpowers/sdd/2026-10-06-control-room-hardening/t2-countdown.js`:

```js
(async () => {
  await new Promise((r) => setTimeout(r, 4000));
  const SLOT_HOURS = 4; // agent-run.yml: "0 */4 * * *"
  const text = document.querySelector(".agent-widget-card")?.textContent ?? "";
  const m = /next check (\d\d):(\d\d):(\d\d)/.exec(text);
  if (!m) return { noCountdown: text.slice(-80) };
  const now = Date.now();
  const at = now + (+m[1] * 3600 + +m[2] * 60 + +m[3]) * 1000;
  const slot = SLOT_HOURS * 3600 * 1000;
  const expected = Math.floor(now / slot) * slot + slot;
  return {
    countdown: m[0],
    next: new Date(at).toISOString().slice(11, 16),
    expected: new Date(expected).toISOString().slice(11, 16),
    offBySeconds: Math.round((at - expected) / 1000),
  };
})()
```

Create `.superpowers/sdd/2026-10-06-control-room-hardening/t2-pulse.js`:

```js
(async () => {
  await new Promise((r) => setTimeout(r, 4000));
  return /next (\d\d:\d\d)/.exec(document.querySelector(".cr-pulse-line")?.textContent ?? "")?.[1] ?? null;
})()
```

Run (separate terminal, leave running): `npx serve out -l 3100`

Run:

```
node --experimental-websocket .superpowers/sdd/2026-10-06-control-room-hardening/cdp.mjs http://localhost:3100/ .superpowers/sdd/2026-10-06-control-room-hardening/t2-home.png 1440 900 .superpowers/sdd/2026-10-06-control-room-hardening/t2-countdown.js
node --experimental-websocket .superpowers/sdd/2026-10-06-control-room-hardening/cdp.mjs http://localhost:3100/researcher/queue/ .superpowers/sdd/2026-10-06-control-room-hardening/t2-queue.png 1440 900 .superpowers/sdd/2026-10-06-control-room-hardening/t2-pulse.js
```

Expected: the home result has `next` equal to `expected`, `offBySeconds` within ±2, and the control room's result is the same `HH:MM` as `next`. (Before this task, the home countdown pointed at `updated_at + 4h` — e.g. 13:35 after a 09:35 manual run — instead of the 12:00 slot.)

Stop the server.

- [ ] **Step 6: Update CLAUDE.md and PROGRESS**

`CLAUDE.md` — in the `/researcher/queue/` bullet, replace:

```
- **`/researcher/queue/` (Tony Scraponi's control room) reads the agent's
  config at build time.** `lib/agent-config.ts` parses
```

with:

```
- **`/researcher/queue/` (Tony Scraponi's control room) reads the agent's
  config at build time** (the home agent widget reads its cron schedule
  the same way, for its countdown). `lib/agent-config.ts` parses
```

`PROGRESS.md` — in the #8 bullet, replace the line:

```
  blanking the home widgets (M1, M2). Next: Task 2 (home countdown).
```

with:

```
  blanking the home widgets (M1, M2). Task 2 done: the home widget's
  "next check" counts down to `nextRun` of `agent-run.yml`'s cron (read at
  build time), the same slot the control room shows. Next: Task 3 (M4).
```

and replace:

```
  Later: editing config from the page (a repo the agent only reads, like
  the inbox); `/researcher/agent/`'s countdown still uses
  `updated_at + cadence` — switch it to `lib/cron.ts`'s `nextRun`.
```

with:

```
  Later: editing config from the page (a repo the agent only reads, like
  the inbox).
```

- [ ] **Step 7: Commit**

```bash
git add components/AgentWidget.tsx app/page.tsx lib/agent-status.ts lib/agent-status.test.ts CLAUDE.md PROGRESS.md
git commit -m "Count the home widget down to the next cron slot

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Then hand off per `CLAUDE.md`.

---

### Task 3: http(s)-only queue links (M4)

**Files:**
- Modify: `lib/pending-queue.ts` (add `safeHref`, `itemDomain`)
- Modify: `lib/pending-queue.test.ts`
- Modify: `components/QueuePane.tsx`
- Modify: `PROGRESS.md`

**Interfaces:**
- Consumes: `PendingItem` from `lib/pending-queue.ts`.
- Produces: `export function safeHref(url: string): string | null` (the URL itself if its protocol is `http:`/`https:`, else `null`) and `export function itemDomain(url: string): string` (hostname without `www.` for http(s); the protocol, e.g. `javascript:`, for other parseable URLs; `invalid url` otherwise), both in `lib/pending-queue.ts`.

- [ ] **Step 1: Write the failing tests**

In `lib/pending-queue.test.ts`, extend the import:

```ts
import {
  type PendingItem,
  type PendingQueue,
  groupByTopic,
  isPendingQueue,
  itemDomain,
  safeHref,
} from "./pending-queue";
```

and append at the end of the file:

```ts
describe("safeHref", () => {
  it("keeps http(s) links as they are", () => {
    expect(safeHref("https://example.com/a")).toBe("https://example.com/a");
    expect(safeHref("http://example.com/a?b=1")).toBe("http://example.com/a?b=1");
  });

  it.each([
    "javascript:alert(1)",
    "  JavaScript:alert(1)",
    "data:text/html,x",
    "mailto:a@b.c",
    "file:///etc/passwd",
    "vscode://file/x",
    "/relative",
    "not a url",
    "",
  ])("refuses %j", (url) => {
    expect(safeHref(url)).toBeNull();
  });
});

describe("itemDomain", () => {
  it("shows the hostname of an http(s) link, without www.", () => {
    expect(itemDomain("https://www.example.com/a")).toBe("example.com");
    expect(itemDomain("http://news.ycombinator.com/item?id=1")).toBe("news.ycombinator.com");
  });

  it("shows the scheme of any other link", () => {
    expect(itemDomain("javascript:alert(1)")).toBe("javascript:");
    expect(itemDomain("file:///etc/passwd")).toBe("file:");
  });

  it("says so when the url doesn't parse", () => {
    expect(itemDomain("/relative")).toBe("invalid url");
    expect(itemDomain("")).toBe("invalid url");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/pending-queue.test.ts`
Expected: FAIL — `safeHref` / `itemDomain` are not functions.

- [ ] **Step 3: Implement the helpers**

In `lib/pending-queue.ts`, after the `PendingQueue` interface, add:

```ts
function parseUrl(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

const isWebLink = (parsed: URL) => parsed.protocol === "http:" || parsed.protocol === "https:";

/**
 * The item's URL if it is an http(s) link, else null. The control room
 * (where the owner's inbox token lives) only links or opens these;
 * React already blocks `javascript:`, this also stops `file:`, `data:` and
 * app schemes.
 */
export function safeHref(url: string): string | null {
  const parsed = parseUrl(url);
  return parsed && isWebLink(parsed) ? url : null;
}

/**
 * A queue row's domain: the hostname without `www.` for an http(s) link,
 * otherwise the scheme (`javascript:`) or "invalid url" — so a row with no
 * open link says why.
 */
export function itemDomain(url: string): string {
  const parsed = parseUrl(url);
  if (!parsed) return "invalid url";
  return isWebLink(parsed) ? parsed.hostname.replace(/^www\./, "") : parsed.protocol;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/pending-queue.test.ts`
Expected: PASS.

- [ ] **Step 5: Use them in `QueuePane`**

In `components/QueuePane.tsx`:

Replace `import type { PendingItem } from "@/lib/pending-queue";` with:

```ts
import { type PendingItem, itemDomain, safeHref } from "@/lib/pending-queue";
```

Delete the local `domain` function:

```ts
function domain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}
```

In the component's doc comment, change `Keys: j/k move and o opens for everyone; a/r/u` to `Keys: j/k move and o opens an http(s) link for everyone; a/r/u`.

In the keydown handler, replace:

```ts
      } else if (key === "o" && selected) {
        window.open(selected.url, "_blank", "noopener,noreferrer");
```

with:

```ts
      } else if (key === "o" && selected) {
        const href = safeHref(selected.url);
        if (href) window.open(href, "_blank", "noopener,noreferrer");
```

In `rows.map`, after `const status = itemStatus(decisions, item.url);`, add:

```ts
              const href = safeHref(item.url);
```

Change the meta line `{item.source} · {domain(item.url)}` to:

```tsx
                    {item.source} · {itemDomain(item.url)}
```

Replace the open link:

```tsx
                        <a
                          className="inbox-button"
                          href={item.url}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(event) => event.stopPropagation()}
                        >
                          <kbd>o</kbd> open ↗
                        </a>
```

with:

```tsx
                        {href ? (
                          <a
                            className="inbox-button"
                            href={href}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(event) => event.stopPropagation()}
                          >
                            <kbd>o</kbd> open ↗
                          </a>
                        ) : (
                          <button type="button" className="inbox-button" disabled title="not an http(s) link">
                            <kbd>o</kbd> open ↗
                          </button>
                        )}
```

- [ ] **Step 6: Typecheck, lint, tests**

Run: `npx tsc --noEmit`
Expected: exit 0.

Run: `npx eslint app components lib`
Expected: no errors.

Run: `npm test`
Expected: all pass.

- [ ] **Step 7: Build and check the queue against live data**

Run: `npm run build`
Expected: no errors.

Create `.superpowers/sdd/2026-10-06-control-room-hardening/t3-queue.js`:

```js
(async () => {
  await new Promise((r) => setTimeout(r, 4000));
  const row = document.querySelector(".cr-row");
  if (!row) return "no rows";
  row.click();
  await new Promise((r) => setTimeout(r, 300));
  const open = document.querySelector('.cr-row[data-selected="true"] .cr-actions .inbox-button:last-child');
  return {
    rows: document.querySelectorAll(".cr-row").length,
    metas: [...document.querySelectorAll(".cr-meta")].slice(0, 3).map((n) => n.textContent),
    openTag: open?.tagName ?? null,
    href: open?.getAttribute("href") ?? null,
    disabled: open?.hasAttribute("disabled") ?? null,
  };
})()
```

Run (separate terminal, leave running): `npx serve out -l 3100`

Run:

```
node --experimental-websocket .superpowers/sdd/2026-10-06-control-room-hardening/cdp.mjs http://localhost:3100/researcher/queue/ .superpowers/sdd/2026-10-06-control-room-hardening/t3-queue.png 1440 900 .superpowers/sdd/2026-10-06-control-room-hardening/t3-queue.js
```

Expected: `rows` > 0 (live `pending.json` has waiting items — if it has none, the status filter shows "nothing here"; say so and rely on the unit tests), `metas` show hostnames such as `hacker_news · github.com · …`, `openTag: "A"`, `href` starts with `https://`, `disabled: false`. Every live item URL is http(s), so the disabled branch is covered by the unit tests only (the spec accepts this).

Stop the server.

- [ ] **Step 8: Final PROGRESS update**

`PROGRESS.md` — in the #8 bullet, replace the whole paragraph from `  Deferred: M4 (the queue could refuse non-http(s) item URLs), plus the` through `build time), the same slot the control room shows. Next: Task 3 (M4).` with:

```
  Deferred: the remaining task-review minors.
  **Hardening: shipped 2026-10-06** (spec
  `docs/superpowers/specs/2026-10-06-control-room-hardening-design.md`,
  plan `docs/superpowers/plans/2026-10-06-control-room-hardening.md`):
  `parseAgentStatus` replaces `isAgentStatus` — every field the
  `AgentStatus` type declares is checked, entries included, dates must
  parse, and a malformed `drops`/`failures` is stripped instead of
  blanking the home widgets (M1, M2); the queue links and opens only
  http(s) item URLs and shows the scheme otherwise (M4); the home
  widget's "next check" counts down to the cron slot the control room
  shows. A required `status.json` field renamed, removed or retyped on
  the agent side must be mirrored in `lib/agent-status.ts` (see
  `CLAUDE.md`), or every agent widget shows "unavailable".
```

In "How to resume", replace:

```
#7 decision are next (see its bullet above). Sub-project #8 (control
room) is shipped and live (2026-10-06); its deferred review items (M1, M2,
M4) and "Later" list are in its bullet above. Later candidates: a Web
```

with:

```
#7 decision are next (see its bullet above). Sub-project #8 (control
room) is shipped and live (2026-10-06), and so is its hardening (M1, M2,
M4, home countdown); its "Later" list is in its bullet above. Later
candidates: a Web
```

(rewrap the rest of that paragraph if the line lengths drift.)

- [ ] **Step 9: Commit**

```bash
git add lib/pending-queue.ts lib/pending-queue.test.ts components/QueuePane.tsx PROGRESS.md
git commit -m "Link and open only http(s) queue items

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 10: Whole-branch review**

Run the final whole-branch review (subagent-driven-development's final review) over `b8f6b08..HEAD`. Fix Critical/Important findings in one fix wave, re-run `npx tsc --noEmit`, `npx eslint app components lib`, `npm test`, `npm run build`, and commit (`Address the control room hardening's final review`).

- [ ] **Step 11: Ask Artem before pushing**

Ask Artem whether to push. Do not continue without a yes.

- [ ] **Step 12: Push as a fast-forward and check live**

Only after Artem's yes:

Run: `git fetch origin main`
Run: `git merge-base --is-ancestor origin/main HEAD && echo ff-ok`
Expected: `ff-ok`. If not, stop and tell Artem `origin/main` moved — don't merge or rebase without asking.

Run: `git push origin worktree-admin-panel:main`
(GitHub TLS from this machine is flaky — retry once on a TLS error.)

Run: `gh run list --workflow deploy.yml --limit 1` and then `gh run watch <id> --exit-status`
Expected: the deploy succeeds.

Re-run the Task 1 and Task 2 checks against the live site (`https://hpnssflw.github.io/`, `/researcher/agent/`, `/researcher/queue/`) with the same scripts. Expected: same results as locally.

Update `PROGRESS.md`'s hardening line with `pushed <short-sha>, deploy run <id>`, commit (`Reconcile status docs with the control room hardening shipping`), push the same way, then hand off per `CLAUDE.md`. The next session's work is #6's 3-day watch and the #7 decision (on or after 2026-10-08).
