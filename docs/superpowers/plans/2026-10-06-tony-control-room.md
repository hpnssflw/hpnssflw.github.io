# Tony Scraponi Control Room Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `/researcher/queue/` with a one-screen control room for the research agent — pulse, a rail of the pipeline's last-run numbers, the agent's config read at build time, the moderation queue with keyboard shortcuts, and 14 days of outcomes.

**Architecture:** A server `page.tsx` loads the agent's config at build time (`lib/agent-config.ts`: `agent/defaults.yaml` + `agent/topics/*.yaml` + constants read from `agent/*.py` and `agent-run.yml`; anything missing fails the build) and hands it to a client `ControlRoom`, which fetches `status.json`, `pending.json` and `state.json` from `agent-data` and `decisions.json` from `hpnssflw/tony-inbox`, each independently. All numbers come from pure, unit-tested modules in `lib/`; the owner-mode write path moves unchanged from `PendingQueue.tsx` into a `useInbox` hook. One small agent change adds per-stage drop counts and failed stages to `status.json`.

**Tech Stack:** Next.js 16 App Router, static export (`output: 'export'`), React 19, TypeScript, Vitest 4, `yaml` 2.x (new direct dependency); Python agent (`agent/status_export.py` only).

**Spec:** `docs/superpowers/specs/2026-10-06-tony-control-room-design.md`

## Global Constraints

- Route stays `/researcher/queue/`; page title "Tony Scraponi". Visitors see everything read-only; approve/reject/undo only with the owner token (#5's localStorage key `tony-inbox-token`, unchanged).
- Desktop (≥ 900px wide): one screen — `.cr` height `calc(100svh - 130px)`, `min-height: 560px`; panes scroll inside. Below 900px: page scrolls; order pulse → topic chips → queue (max 70svh, own scroll) → rail (3×3) → config + outcomes.
- Container is the site's `.wrap` (1040px). Surfaces: `--card-bg` + `backdrop-filter: blur(10px)`, no borders. Lime (`--agent-lime`) = live/kept/approved/pass; red (`--agent-red`) = stale/rejected/failed/exclude. Case system: labels/chrome UPPERCASE via CSS, content lowercase via CSS — never transform strings in JS.
- Rail stages, in order: `collect, window, dedupe, cache, rank, cap, queue, review, deliver`.
- Keys: `j`/`k` move, `o` open (everyone); `a` approve, `r` reject, `u` undo (owner only); ignored while focus is in an input/textarea/select or with Ctrl/Meta/Alt.
- Config is read only from `agent/defaults.yaml`, `agent/topics/*.yaml`, `agent/summarize.py` (`RANK_BATCH_SIZE`, `RANK_PROMPT_VERSION`, `temperature=`), `agent/rank_cache.py` (`QUEUE_WINDOW = timedelta(hours=N)`), `.github/workflows/agent-run.yml` (`cron:`). Never `agent/.env`. A missing file/field/constant throws → build fails.
- `status.json` gains `drops: {slug: {stage: {reason: n}}}` and `failures: [{stage, topic, source}]` — never error text. The site must work without them (status.json written before the agent change).
- No new dependencies besides `yaml` (^2.9.0). No Tailwind/CSS-in-JS/component library; all CSS goes in `app/globals.css`.
- No React state set synchronously in an effect body (eslint `react-hooks/set-state-in-effect`): use a local `tick()` like `AgentWidget.tsx`, or set state in promise callbacks/event handlers. Don't call `Date.now()`/`new Date()` without arguments during render.
- Client components import config types with `import type` only — `lib/agent-config.ts` uses `node:fs`.
- Work happens in the worktree `C:\A\polozov\.claude\worktrees\admin-panel` on branch `worktree-admin-panel`. Do not merge into `main` or push until Artem says so (Task 7, Step 9). Never enter `.claude/worktrees/tony-scraponi` or any other worktree.
- `next dev` (if used) runs on port 3100: `npm run dev -- -p 3100` (3000 belongs to the main checkout). Don't run `npm run build` while a dev server is up. Serve the export with `npx serve out -l 3100`.
- Throwaway check scripts live in `.superpowers/sdd/2026-10-06-control-room/` (git-ignored). Python on this machine is `py -3`.
- Never stage `.claude/settings.local.json`. Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- After each task: update this sub-project's line in `PROGRESS.md` in the task's commit, then stop and hand off per `CLAUDE.md` ("Clean context after each micro-task").

## File map

| File | Responsibility | Task |
|---|---|---|
| `lib/cron.ts` (new) | parse the workflow cron, next slot | 1 |
| `lib/agent-config.ts` (new) | build-time config loader | 1 |
| `package.json`, `package-lock.json` | `yaml` dependency | 1 |
| `lib/agent-status.ts` | optional `drops`/`failures` + guard | 2 |
| `lib/pipeline-stages.ts` (new) | `TopicFilter`, stage keys, rail numbers | 2 |
| `lib/outcomes.ts` (new) | `state.json` parser, report port, verdict count | 3 |
| `lib/queue-view.ts` (new) | queue filters, counts, sort, selection | 3 |
| `components/useJson.ts` (new) | fetch one public JSON file | 4 |
| `components/useInbox.ts` (new) | owner mode (moved from `PendingQueue.tsx`) | 4 |
| `components/InboxControls.tsx` | token storage + `OwnerSlot` | 4 |
| `components/TonyMark.tsx` (new) | the spy icon | 4 |
| `components/ControlPulse.tsx` (new) | pulse strip | 4 |
| `components/QueuePane.tsx` (new) | queue list, filters, keys | 4 |
| `components/ControlRoom.tsx` (new) | data + layout | 4, 5 |
| `components/PendingQueue.tsx` | deleted | 4 |
| `app/researcher/queue/page.tsx` | server page, loads config | 4 |
| `components/PipelineRail.tsx`, `ConfigSpine.tsx`, `Outcomes.tsx` (new) | rail, config spine, outcomes | 5 |
| `app/globals.css` | "Control room" section (4, 5); teaser links (7) | 4, 5, 7 |
| `agent/status_export.py` | `drops`, `failures` | 6 |
| `components/AppsStrip.tsx` | `open ↗`, no "coming soon", uses `TonyMark` | 4, 7 |
| `app/researcher/page.tsx`, `app/researcher/agent/page.tsx` | link labels | 7 |
| `CLAUDE.md`, `PROGRESS.md`, `docs/tony-scraponi-roadmap.md` | docs | 1–7 |

---

### Task 1: Config at build time — `lib/cron.ts`, `lib/agent-config.ts`

**Files:**
- Create: `lib/cron.ts`, `lib/cron.test.ts`, `lib/agent-config.ts`, `lib/agent-config.test.ts`
- Modify: `package.json`, `package-lock.json` (via npm)
- Modify: `CLAUDE.md` (test list; new build-time coupling bullet), `PROGRESS.md`, `docs/tony-scraponi-roadmap.md` (record sub-project #8)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces:
  - `lib/cron.ts`: `interface CronSchedule { minute: number; hourStep: number | null; hour: number | null }`, `parseCron(expr: string): CronSchedule` (throws `unsupported cron "<expr>"`), `nextRun(schedule: CronSchedule, now: Date): Date` (first slot strictly after `now`, UTC).
  - `lib/agent-config.ts`: `interface TopicConfigView { slug; name; description; include: string[]; exclude: string[]; keywords: string[]; maxAgeDays; minRelevance; maxItemsPerDay; attention: { enabled: boolean; minScoreGain: number }; hackerNews: { minPoints: number } | null; github: { minStars: number; topics: string[] } | null }`, `interface AgentConfig { cron: string; schedule: CronSchedule; llm: { model; baseUrl; temperature; batchSize; promptVersion }; reader: string; queueWindowHours: number; delivery: { channel: string; cadenceHours: number }; inbox: { repo: string; expireDays: number }; topics: TopicConfigView[] }`, `deepMerge(base, override)`, `loadAgentConfig(root = process.cwd()): AgentConfig`.

- [ ] **Step 1: Add the `yaml` dependency**

Run: `npm install yaml@^2.9.0`
Expected: `package.json` gains `"yaml": "^2.9.0"` under `dependencies`; `package-lock.json` changes only to record it as a direct dependency (it's already installed under vitest).

- [ ] **Step 2: Write the failing cron tests**

Create `lib/cron.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { nextRun, parseCron } from "./cron";

describe("parseCron", () => {
  it("reads every-N-hours schedules", () => {
    expect(parseCron("0 */4 * * *")).toEqual({ minute: 0, hourStep: 4, hour: null });
    expect(parseCron(" 15 */6 * * * ")).toEqual({ minute: 15, hourStep: 6, hour: null });
  });

  it("reads daily schedules", () => {
    expect(parseCron("30 6 * * *")).toEqual({ minute: 30, hourStep: null, hour: 6 });
  });

  it.each(["0 */4 * * 1", "*/5 * * * *", "0 4,8 * * *", "0 */0 * * *", "60 */4 * * *", "0 * * * *", "nonsense"])(
    "rejects %s",
    (expr) => {
      expect(() => parseCron(expr)).toThrow(/unsupported cron/);
    },
  );
});

describe("nextRun", () => {
  const every4h = parseCron("0 */4 * * *");

  it("finds the next slot after a manual run", () => {
    expect(nextRun(every4h, new Date("2026-10-05T18:22:00Z")).toISOString()).toBe("2026-10-05T20:00:00.000Z");
  });

  it("crosses midnight", () => {
    expect(nextRun(every4h, new Date("2026-10-05T22:30:00Z")).toISOString()).toBe("2026-10-06T00:00:00.000Z");
  });

  it("is strictly after now when now is a slot", () => {
    expect(nextRun(every4h, new Date("2026-10-05T20:00:00Z")).toISOString()).toBe("2026-10-06T00:00:00.000Z");
    expect(nextRun(every4h, new Date("2026-10-05T19:59:59Z")).toISOString()).toBe("2026-10-05T20:00:00.000Z");
  });

  it("honours the minute", () => {
    const at15 = parseCron("15 */6 * * *");
    expect(nextRun(at15, new Date("2026-10-05T06:10:00Z")).toISOString()).toBe("2026-10-05T06:15:00.000Z");
    expect(nextRun(at15, new Date("2026-10-05T06:20:00Z")).toISOString()).toBe("2026-10-05T12:15:00.000Z");
  });

  it("handles daily schedules", () => {
    const daily = parseCron("30 6 * * *");
    expect(nextRun(daily, new Date("2026-10-05T06:00:00Z")).toISOString()).toBe("2026-10-05T06:30:00.000Z");
    expect(nextRun(daily, new Date("2026-10-05T07:00:00Z")).toISOString()).toBe("2026-10-06T06:30:00.000Z");
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run lib/cron.test.ts`
Expected: FAIL — `Failed to resolve import "./cron"`.

- [ ] **Step 4: Implement `lib/cron.ts`**

```ts
// The agent's schedule, from the `cron:` line of
// .github/workflows/agent-run.yml. Only the two shapes this repo would use
// are supported — every N hours at minute M, and once a day at H:M — and
// anything else throws, so lib/agent-config.ts fails the build instead of
// the control room counting down to the wrong time. UTC, like Actions.

export interface CronSchedule {
  minute: number;
  /** Runs every `hourStep` hours from 00:00 UTC; null for a daily run. */
  hourStep: number | null;
  /** The daily run's hour; null when `hourStep` is set. */
  hour: number | null;
}

function field(value: string, min: number, max: number, expr: string): number {
  const n = /^\d+$/.test(value) ? Number(value) : NaN;
  if (!(n >= min && n <= max)) throw new Error(`unsupported cron "${expr}"`);
  return n;
}

export function parseCron(expr: string): CronSchedule {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5 || parts.slice(2).some((part) => part !== "*")) {
    throw new Error(`unsupported cron "${expr}"`);
  }
  const minute = field(parts[0], 0, 59, expr);
  const step = /^\*\/(\d+)$/.exec(parts[1]);
  if (step) return { minute, hourStep: field(step[1], 1, 23, expr), hour: null };
  return { minute, hourStep: null, hour: field(parts[1], 0, 23, expr) };
}

/** The first scheduled slot strictly after `now`. */
export function nextRun(schedule: CronSchedule, now: Date): Date {
  const slot = new Date(now.getTime());
  slot.setUTCMinutes(schedule.minute, 0, 0);
  for (let i = 0; i <= 48; i++) {
    const hour = slot.getUTCHours();
    const due = schedule.hourStep !== null ? hour % schedule.hourStep === 0 : hour === schedule.hour;
    if (due && slot.getTime() > now.getTime()) return slot;
    slot.setUTCHours(hour + 1);
  }
  throw new Error("no cron slot within 48 hours");
}
```

- [ ] **Step 5: Run the cron tests**

Run: `npx vitest run lib/cron.test.ts`
Expected: PASS (all).

- [ ] **Step 6: Write the failing config tests**

Create `lib/agent-config.test.ts`:

```ts
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { deepMerge, loadAgentConfig } from "./agent-config";

describe("loadAgentConfig against this repo's agent/", () => {
  const config = loadAgentConfig();

  it("loads the three topics in file-name order", () => {
    expect(config.topics.map((t) => t.slug)).toEqual(["ai-engineering", "tooling", "web-products"]);
  });

  it("applies a topic's override over defaults.yaml", () => {
    expect(config.topics.find((t) => t.slug === "ai-engineering")?.maxItemsPerDay).toBe(4);
    expect(config.topics.find((t) => t.slug === "tooling")?.maxItemsPerDay).toBe(3);
  });

  it("carries criteria, keywords and both sources for every topic", () => {
    for (const topic of config.topics) {
      expect(topic.include.length).toBeGreaterThan(0);
      expect(topic.exclude.length).toBeGreaterThan(0);
      expect(topic.keywords.length).toBeGreaterThan(0);
      expect(topic.hackerNews?.minPoints).toBeGreaterThan(0);
      expect(topic.github?.topics.length).toBeGreaterThan(0);
    }
  });

  it("reads the constants that live in code", () => {
    expect(config.llm.batchSize).toBe(40);
    expect(config.llm.temperature).toBe(0);
    expect(Number.isInteger(config.llm.promptVersion) && config.llm.promptVersion >= 2).toBe(true);
    expect(config.queueWindowHours).toBe(23);
    expect(config.cron).toBe("0 */4 * * *");
    expect(config.schedule).toEqual({ minute: 0, hourStep: 4, hour: null });
  });

  it("reads delivery, inbox and the reader profile", () => {
    expect(config.inbox).toEqual({ repo: "hpnssflw/tony-inbox", expireDays: 7 });
    expect(config.delivery.channel).toBe("@hypnosisflow");
    expect(config.reader).toMatch(/^Artem/);
    expect(config.reader).toBe(config.reader.trim());
  });
});

const FILES: Record<string, string> = {
  "agent/defaults.yaml": [
    "max_age_days: 10",
    "min_relevance: 6",
    "max_items_per_day: 3",
    "attention:",
    "  enabled: true",
    "  min_score_gain: 50",
    "llm:",
    "  base_url: https://api.example.com",
    "  model: some-model",
    "ranking:",
    "  reader: >",
    "    A reader",
    "    on two lines.",
    "delivery:",
    '  telegram_channel: "@channel"',
    "  delivery_cadence_hours: 24",
    "inbox:",
    "  decisions_url: https://api.github.com/repos/owner/inbox/contents/decisions.json",
    "  expire_days: 7",
    "",
  ].join("\n"),
  "agent/topics/b-topic.yaml": [
    "name: B Topic",
    "description: >",
    "  Second.",
    "keywords: [one]",
    "sources:",
    "  hacker_news: { min_points: 30 }",
    "",
  ].join("\n"),
  "agent/topics/a-topic.yaml": [
    "name: A Topic",
    "description: First.",
    "max_items_per_day: 5",
    "attention: { min_score_gain: 10 }",
    "include: [in]",
    "exclude: [out]",
    "keywords: [two, three]",
    "sources:",
    "  github_trending: { min_stars: 100, topics: [llm, mcp] }",
    "",
  ].join("\n"),
  "agent/summarize.py": "RANK_PROMPT_VERSION = 3\nRANK_BATCH_SIZE = 25\n\ndef f():\n    return dict(temperature=0)\n",
  "agent/rank_cache.py": "from datetime import timedelta\n\nQUEUE_WINDOW = timedelta(hours=20)\n",
  ".github/workflows/agent-run.yml": 'on:\n  schedule:\n    - cron: "15 */6 * * *"\n',
};

/** A throwaway repo root; `null` leaves a file out. */
function fixtureRepo(overrides: Record<string, string | null> = {}): string {
  const root = mkdtempSync(join(tmpdir(), "agent-config-"));
  for (const [path, text] of Object.entries({ ...FILES, ...overrides })) {
    if (text === null) continue;
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

describe("loadAgentConfig against fixtures", () => {
  it("merges each topic over defaults like agent/config.py", () => {
    const config = loadAgentConfig(fixtureRepo());
    const [a, b] = config.topics;
    expect(config.topics.map((t) => t.slug)).toEqual(["a-topic", "b-topic"]);
    expect(a).toMatchObject({
      name: "A Topic",
      description: "First.",
      maxItemsPerDay: 5,
      maxAgeDays: 10,
      minRelevance: 6,
      attention: { enabled: true, minScoreGain: 10 },
      include: ["in"],
      exclude: ["out"],
      keywords: ["two", "three"],
      hackerNews: null,
      github: { minStars: 100, topics: ["llm", "mcp"] },
    });
    expect(b).toMatchObject({
      description: "Second.",
      maxItemsPerDay: 3,
      attention: { enabled: true, minScoreGain: 50 },
      include: [],
      exclude: [],
      hackerNews: { minPoints: 30 },
      github: null,
    });
    expect(config.reader).toBe("A reader on two lines.");
    expect(config.llm).toEqual({
      model: "some-model",
      baseUrl: "https://api.example.com",
      temperature: 0,
      batchSize: 25,
      promptVersion: 3,
    });
    expect(config.queueWindowHours).toBe(20);
    expect(config.schedule).toEqual({ minute: 15, hourStep: 6, hour: null });
    expect(config.inbox).toEqual({ repo: "owner/inbox", expireDays: 7 });
    expect(config.delivery).toEqual({ channel: "@channel", cadenceHours: 24 });
  });

  it.each([
    ["agent/summarize.py", "RANK_PROMPT_VERSION = 3\n\ndef f():\n    return dict(temperature=0)\n", /RANK_BATCH_SIZE/],
    ["agent/summarize.py", "RANK_BATCH_SIZE = 25\n\ndef f():\n    return dict(temperature=0)\n", /RANK_PROMPT_VERSION/],
    ["agent/summarize.py", "RANK_PROMPT_VERSION = 3\nRANK_BATCH_SIZE = 25\n", /temperature=/],
    ["agent/rank_cache.py", "QUEUE_WINDOW = timedelta(days=1)\n", /QUEUE_WINDOW/],
    [".github/workflows/agent-run.yml", "on: push\n", /cron/],
    [".github/workflows/agent-run.yml", 'on:\n  schedule:\n    - cron: "0 9 * * 1"\n', /unsupported cron/],
  ])("fails when %s lacks what it needs", (path, text, message) => {
    expect(() => loadAgentConfig(fixtureRepo({ [path]: text }))).toThrow(message);
  });

  it("fails on a missing YAML field", () => {
    const noInbox = FILES["agent/defaults.yaml"].replace(/inbox:[\s\S]*$/, "");
    expect(() => loadAgentConfig(fixtureRepo({ "agent/defaults.yaml": noInbox }))).toThrow(
      /missing inbox\.decisions_url in agent\/defaults\.yaml/,
    );
    const noSources = "name: B\ndescription: x\nkeywords: [one]\n";
    expect(() => loadAgentConfig(fixtureRepo({ "agent/topics/b-topic.yaml": noSources }))).toThrow(
      /missing sources in agent\/topics\/b-topic\.yaml/,
    );
  });

  it("fails on a missing file", () => {
    expect(() => loadAgentConfig(fixtureRepo({ "agent/rank_cache.py": null }))).toThrow();
  });
});

describe("deepMerge", () => {
  it("lets the override win and merges dicts key by key", () => {
    expect(deepMerge({ a: { x: 1, y: 2 }, b: 1 }, { a: { y: 3 }, c: 4 })).toEqual({ a: { x: 1, y: 3 }, b: 1, c: 4 });
  });

  it("replaces a dict with a non-dict", () => {
    expect(deepMerge({ a: { x: 1 } }, { a: [1] })).toEqual({ a: [1] });
  });
});
```

- [ ] **Step 7: Run it to verify it fails**

Run: `npx vitest run lib/agent-config.test.ts`
Expected: FAIL — `Failed to resolve import "./agent-config"`.

- [ ] **Step 8: Implement `lib/agent-config.ts`**

```ts
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { type CronSchedule, parseCron } from "./cron";

// The research agent's configuration as the control room shows it, read at
// build time from the same files the agent runs with: agent/defaults.yaml
// merged under each agent/topics/<slug>.yaml exactly as agent/config.py
// does, plus the constants that live in code. A missing file, field or
// constant throws, so the build fails instead of the page showing a config
// the agent no longer has. Server-only (node:fs): client components import
// its types with `import type`.

export interface TopicConfigView {
  slug: string;
  name: string;
  description: string;
  include: string[];
  exclude: string[];
  keywords: string[];
  maxAgeDays: number;
  minRelevance: number;
  maxItemsPerDay: number;
  attention: { enabled: boolean; minScoreGain: number };
  hackerNews: { minPoints: number } | null;
  github: { minStars: number; topics: string[] } | null;
}

export interface AgentConfig {
  cron: string; // agent-run.yml's schedule line, as written
  schedule: CronSchedule;
  llm: { model: string; baseUrl: string; temperature: number; batchSize: number; promptVersion: number };
  reader: string;
  queueWindowHours: number;
  delivery: { channel: string; cadenceHours: number };
  inbox: { repo: string; expireDays: number };
  topics: TopicConfigView[];
}

type Raw = Record<string, unknown>;

const BATCH_RE = /^RANK_BATCH_SIZE = (\d+)\s*$/gm;
const PROMPT_RE = /^RANK_PROMPT_VERSION = (\d+)\s*$/gm;
const TEMPERATURE_RE = /\btemperature=(\d+(?:\.\d+)?)/g;
const WINDOW_RE = /^QUEUE_WINDOW = timedelta\(hours=(\d+)\)\s*$/gm;
const CRON_RE = /^\s*-\s*cron:\s*["']([^"'\r\n]+)["']\s*$/gm;
const INBOX_REPO_RE = /^https:\/\/api\.github\.com\/repos\/([^/]+\/[^/]+)\/contents\//;

function isRecord(value: unknown): value is Raw {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(message: string): never {
  throw new Error(`agent config: ${message}`);
}

/** agent/config.py's _deep_merge: the override wins; dicts merge key by key. */
export function deepMerge(base: Raw, override: Raw): Raw {
  const merged: Raw = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const current = merged[key];
    merged[key] = isRecord(current) && isRecord(value) ? deepMerge(current, value) : value;
  }
  return merged;
}

function readYaml(path: string, where: string): Raw {
  const data: unknown = parse(readFileSync(path, "utf8"));
  if (data === null || data === undefined) return {}; // yaml.safe_load(...) or {}
  return isRecord(data) ? data : fail(`${where} is not a mapping`);
}

function get(obj: Raw, path: string, where: string): unknown {
  let current: unknown = obj;
  for (const key of path.split(".")) {
    if (!isRecord(current) || !(key in current)) fail(`missing ${path} in ${where}`);
    current = (current as Raw)[key];
  }
  return current;
}

function str(obj: Raw, path: string, where: string): string {
  const value = get(obj, path, where);
  return typeof value === "string" ? value : fail(`${path} in ${where} is not a string`);
}

function num(obj: Raw, path: string, where: string): number {
  const value = get(obj, path, where);
  return typeof value === "number" ? value : fail(`${path} in ${where} is not a number`);
}

function strings(value: unknown, path: string, where: string): string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string")
    ? value
    : fail(`${path} in ${where} is not a list of strings`);
}

/** Exactly one match of `pattern` (global) in a source file, first group. */
function constant(root: string, file: string, pattern: RegExp, what: string): string {
  const matches = [...readFileSync(join(root, file), "utf8").matchAll(pattern)];
  if (matches.length !== 1) fail(`expected one ${what} in ${file}, found ${matches.length}`);
  return matches[0][1];
}

function topicView(slug: string, merged: Raw, where: string): TopicConfigView {
  const attention: Raw = isRecord(merged.attention) ? merged.attention : {};
  const sources = get(merged, "sources", where);
  if (!isRecord(sources)) fail(`sources in ${where} is not a mapping`);
  const hn = sources.hacker_news;
  const gh = sources.github_trending;
  return {
    slug,
    name: str(merged, "name", where),
    description: str(merged, "description", where).trim(),
    include: "include" in merged ? strings(merged.include, "include", where) : [],
    exclude: "exclude" in merged ? strings(merged.exclude, "exclude", where) : [],
    keywords: strings(get(merged, "keywords", where), "keywords", where),
    maxAgeDays: num(merged, "max_age_days", where),
    minRelevance: num(merged, "min_relevance", where),
    maxItemsPerDay: num(merged, "max_items_per_day", where),
    attention: {
      enabled: attention.enabled === true,
      minScoreGain: typeof attention.min_score_gain === "number" ? attention.min_score_gain : 0,
    },
    hackerNews: isRecord(hn) ? { minPoints: num(hn, "min_points", `${where} sources.hacker_news`) } : null,
    github: isRecord(gh)
      ? {
          minStars: num(gh, "min_stars", `${where} sources.github_trending`),
          topics: strings(get(gh, "topics", `${where} sources.github_trending`), "topics", where),
        }
      : null,
  };
}

export function loadAgentConfig(root: string = process.cwd()): AgentConfig {
  const defaultsFile = "agent/defaults.yaml";
  const defaults = readYaml(join(root, defaultsFile), defaultsFile);
  const topicsDir = join(root, "agent", "topics");
  const files = readdirSync(topicsDir)
    .filter((file) => file.endsWith(".yaml"))
    .sort();
  if (files.length === 0) fail("no topics in agent/topics/");
  const topics = files.map((file) => {
    const where = `agent/topics/${file}`;
    return topicView(file.slice(0, -".yaml".length), deepMerge(defaults, readYaml(join(topicsDir, file), where)), where);
  });

  const decisionsUrl = str(defaults, "inbox.decisions_url", defaultsFile);
  const repo = INBOX_REPO_RE.exec(decisionsUrl)?.[1] ?? fail(`inbox.decisions_url is not a GitHub contents URL`);
  const cron = constant(root, ".github/workflows/agent-run.yml", CRON_RE, "cron schedule");

  return {
    cron,
    schedule: parseCron(cron),
    llm: {
      model: str(defaults, "llm.model", defaultsFile),
      baseUrl: str(defaults, "llm.base_url", defaultsFile),
      temperature: Number(constant(root, "agent/summarize.py", TEMPERATURE_RE, "temperature=")),
      batchSize: Number(constant(root, "agent/summarize.py", BATCH_RE, "RANK_BATCH_SIZE")),
      promptVersion: Number(constant(root, "agent/summarize.py", PROMPT_RE, "RANK_PROMPT_VERSION")),
    },
    reader: str(defaults, "ranking.reader", defaultsFile).trim(),
    queueWindowHours: Number(constant(root, "agent/rank_cache.py", WINDOW_RE, "QUEUE_WINDOW")),
    delivery: {
      channel: str(defaults, "delivery.telegram_channel", defaultsFile),
      cadenceHours: num(defaults, "delivery.delivery_cadence_hours", defaultsFile),
    },
    inbox: { repo, expireDays: num(defaults, "inbox.expire_days", defaultsFile) },
    topics,
  };
}
```

- [ ] **Step 9: Run the config tests, then the whole suite and the type check**

Run: `npx vitest run lib/agent-config.test.ts lib/cron.test.ts`
Expected: PASS (all).
Run: `npm test && npx tsc --noEmit && npx eslint lib`
Expected: all tests pass; no type or lint errors.

- [ ] **Step 10: Docs**

In `CLAUDE.md`, in the `npm test` comment block, replace the line

```
                          # scripts/presence
```

with

```
                          # lib/cron, lib/agent-config, scripts/presence
```

and add this bullet right after the "**Two home blocks are fetched at build time**" bullet:

```markdown
- **`/researcher/queue/` (Tony Scraponi's control room) reads the agent's
  config at build time.** `lib/agent-config.ts` parses
  `agent/defaults.yaml` + `agent/topics/*.yaml` and pulls
  `RANK_BATCH_SIZE`, `RANK_PROMPT_VERSION` and `temperature=` from
  `agent/summarize.py`, `QUEUE_WINDOW` from `agent/rank_cache.py` and the
  `cron:` line from `agent-run.yml`. Anything missing throws and fails the
  site build, on purpose: when agent work renames or moves one of these,
  update `lib/agent-config.ts` in the same change.
```

In `docs/tony-scraponi-roadmap.md`, after item 7, add:

```markdown
8. **Control room** (built before #7). `/researcher/queue/` becomes
   Tony Scraponi's one-screen control room: the agent's full config, read
   from `agent/` at build time; its last run stage by stage with drop
   reasons; the moderation queue with keyboard shortcuts; 14 days of
   outcomes. Read-only config for now — editing would live in a repo the
   agent only reads, like the inbox. Spec:
   `docs/superpowers/specs/2026-10-06-tony-control-room-design.md`.
```

In `PROGRESS.md`, change the Content Direction & Tony Scraponi status line to `**Status: sub-projects #1-#6 shipped; #8 (control room) in progress.**`, and add after the sub-project #6 bullet:

```markdown
- **Sub-project #8, Tony Scraponi control room: in progress.**
  Replaces `/researcher/queue/` with a one-screen control room (pulse,
  pipeline rail, config spine read from `agent/` at build time,
  moderation queue with j/k/a/r/u/o, 14 days of outcomes).
  Spec: `docs/superpowers/specs/2026-10-06-tony-control-room-design.md`.
  Plan: `docs/superpowers/plans/2026-10-06-tony-control-room.md`.
  Worktree `.claude/worktrees/admin-panel`, branch `worktree-admin-panel`
  (not merged). Done: Task 1 (build-time config loader). Next: Task 2.
```

- [ ] **Step 11: Commit**

```bash
git add package.json package-lock.json lib/cron.ts lib/cron.test.ts lib/agent-config.ts lib/agent-config.test.ts CLAUDE.md PROGRESS.md docs/tony-scraponi-roadmap.md
git commit -m "Read the agent's config at build time for the control room" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Rail numbers — `lib/agent-status.ts`, `lib/pipeline-stages.ts`

**Files:**
- Modify: `lib/agent-status.ts`, `lib/agent-status.test.ts`
- Create: `lib/pipeline-stages.ts`, `lib/pipeline-stages.test.ts`
- Modify: `CLAUDE.md` (test list), `PROGRESS.md`

**Interfaces:**
- Consumes: `AgentConfig`, `TopicConfigView` (Task 1, types only); `itemStatus`, `Decisions` from `lib/inbox.ts`; `PendingQueue`, `PendingItem` from `lib/pending-queue.ts`.
- Produces:
  - `lib/agent-status.ts`: `type DropCounts = Record<string, Record<string, Record<string, number>>>`, `interface RunFailure { stage: string; topic: string | null; source: string | null }`, `AgentStatus.drops?: DropCounts`, `AgentStatus.failures?: RunFailure[]`.
  - `lib/pipeline-stages.ts`: `type TopicFilter = "all" | (string & {})`, `STAGE_KEYS` (the nine keys, in order), `type StageKey`, `interface StageNumbers { key: StageKey; value: string; line: string; failed: string | null }`, `interface LiveData { status: AgentStatus | null; queue: PendingQueue | null; decisions: Decisions | null }`, `topicSlugs(config, topic): string[]`, `buildStages(config, live, topic): StageNumbers[]`.

- [ ] **Step 1: Write the failing status-guard tests**

Append to `lib/agent-status.test.ts`:

```ts
describe("isAgentStatus — drops and failures", () => {
  const base = makeStatus({
    topics: [{ slug: "tooling", name: "Tooling", collected: 3, kept: 1 }],
    funnel: { tooling: { collected: 3, in_window: 3, new: 2, kept: 1 } },
  });

  it("accepts a payload without them (written before the agent change)", () => {
    expect(isAgentStatus(base)).toBe(true);
  });

  it("accepts well-formed drops and failures", () => {
    expect(
      isAgentStatus({
        ...base,
        drops: { tooling: { dedupe: { seen: 2, already_ranked: 1 } } },
        failures: [
          { stage: "collect", topic: "tooling", source: "github_trending" },
          { stage: "deliver", topic: null, source: null },
        ],
      }),
    ).toBe(true);
  });

  it("rejects malformed drops", () => {
    expect(isAgentStatus({ ...base, drops: { tooling: { dedupe: { seen: "2" } } } })).toBe(false);
    expect(isAgentStatus({ ...base, drops: [] })).toBe(false);
    expect(isAgentStatus({ ...base, drops: { tooling: [] } })).toBe(false);
  });

  it("rejects malformed failures", () => {
    expect(isAgentStatus({ ...base, failures: {} })).toBe(false);
    expect(isAgentStatus({ ...base, failures: [{ stage: 1, topic: null, source: null }] })).toBe(false);
    expect(isAgentStatus({ ...base, failures: [{ stage: "rank", topic: 3, source: null }] })).toBe(false);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run lib/agent-status.test.ts`
Expected: FAIL — the "rejects malformed …" cases return `true`.

- [ ] **Step 3: Extend `lib/agent-status.ts`**

Add after the `RecentEvent` interface:

```ts
/**
 * Drop counts by topic slug → stage → reason, from the run's drop events
 * (agent/status_export.py, 2026-10). Stages: collect, date_guard, dedupe,
 * rank, inbox. Absent from status.json written before that change.
 */
export type DropCounts = Record<string, Record<string, Record<string, number>>>;

/** A stage that failed in this run — which one, never why. */
export interface RunFailure {
  stage: string;
  topic: string | null;
  source: string | null;
}
```

Add two optional fields at the end of `AgentStatus`:

```ts
  drops?: DropCounts;
  failures?: RunFailure[];
```

Add above `isAgentStatus`:

```ts
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDropCounts(value: unknown): value is DropCounts {
  return (
    isRecord(value) &&
    Object.values(value).every(
      (stages) =>
        isRecord(stages) &&
        Object.values(stages).every(
          (reasons) => isRecord(reasons) && Object.values(reasons).every((n) => typeof n === "number"),
        ),
    )
  );
}

function isRunFailure(value: unknown): value is RunFailure {
  return (
    isRecord(value) &&
    typeof value.stage === "string" &&
    (value.topic === null || typeof value.topic === "string") &&
    (value.source === null || typeof value.source === "string")
  );
}
```

Replace `isAgentStatus` (keep its doc comment) with:

```ts
export function isAgentStatus(value: unknown): value is AgentStatus {
  if (typeof value !== "object" || value === null) return false;
  const s = value as Record<string, unknown>;
  return (
    typeof s.cadence_hours === "number" &&
    typeof s.streak === "number" &&
    typeof s.pending_count === "number" &&
    typeof s.updated_at === "string" &&
    Array.isArray(s.topics) &&
    Array.isArray(s.run_history) &&
    Array.isArray(s.recent_events) &&
    typeof s.funnel === "object" &&
    s.funnel !== null &&
    (s.topics as TopicStatus[]).every(
      (t) => t && typeof t.slug === "string" && s.funnel != null &&
        typeof (s.funnel as Record<string, unknown>)[t.slug] === "object",
    ) &&
    (s.drops === undefined || isDropCounts(s.drops)) &&
    (s.failures === undefined || (Array.isArray(s.failures) && s.failures.every(isRunFailure)))
  );
}
```

- [ ] **Step 4: Run the status tests**

Run: `npx vitest run lib/agent-status.test.ts`
Expected: PASS (all, old and new).

- [ ] **Step 5: Write the failing stage tests**

Create `lib/pipeline-stages.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { AgentConfig, TopicConfigView } from "./agent-config";
import type { AgentStatus } from "./agent-status";
import type { Decisions } from "./inbox";
import type { PendingItem, PendingQueue } from "./pending-queue";
import { STAGE_KEYS, type StageNumbers, buildStages, topicSlugs } from "./pipeline-stages";

function topic(slug: string, minRelevance = 6): TopicConfigView {
  return {
    slug,
    name: slug,
    description: "",
    include: [],
    exclude: [],
    keywords: ["k"],
    maxAgeDays: 10,
    minRelevance,
    maxItemsPerDay: 3,
    attention: { enabled: true, minScoreGain: 50 },
    hackerNews: { minPoints: 30 },
    github: null,
  };
}

function makeConfig(topics = [topic("tooling"), topic("web")]): AgentConfig {
  return {
    cron: "0 */4 * * *",
    schedule: { minute: 0, hourStep: 4, hour: null },
    llm: { model: "m", baseUrl: "b", temperature: 0, batchSize: 40, promptVersion: 2 },
    reader: "r",
    queueWindowHours: 23,
    delivery: { channel: "@c", cadenceHours: 24 },
    inbox: { repo: "o/r", expireDays: 7 },
    topics,
  };
}

const status: AgentStatus = {
  cadence_hours: 4,
  delivery_cadence_hours: 24,
  streak: 3,
  pending_count: 3,
  updated_at: "2026-10-05T18:22:00+00:00",
  last_sent_at: "2026-09-30T04:08:45+00:00",
  topics: [
    { slug: "tooling", name: "tooling", collected: 101, kept: 3 },
    { slug: "web", name: "web", collected: 13, kept: 3 },
  ],
  funnel: {
    tooling: { collected: 101, in_window: 100, new: 70, kept: 3 },
    web: { collected: 13, in_window: 13, new: 12, kept: 3 },
  },
  recent_events: [],
  run_history: [],
};

const drops = {
  tooling: {
    collect: { undated: 2 },
    date_guard: { outside_window: 1 },
    dedupe: { seen: 25, dismissed: 1, already_ranked: 4 },
    rank: { below_relevance: 45, over_max_items: 22 },
    inbox: { rejected: 2, expired: 1 },
  },
  web: { dedupe: { seen: 1 }, rank: { below_relevance: 7, over_max_items: 2 } },
};

function item(url: string, topicSlug: string): PendingItem {
  return {
    url,
    title: url,
    source: "hn",
    topic: topicSlug,
    topic_name: topicSlug,
    summary: "",
    score: 7,
    pending_since: "2026-10-05T18:22:00+00:00",
  };
}

const queue: PendingQueue = {
  last_email_at: null,
  items: [item("https://a", "tooling"), item("https://b", "tooling"), item("https://c", "web")],
};

const decisions: Decisions = {
  version: 1,
  decisions: {
    "https://a": { decision: "approve", at: "2026-10-05T19:00:00Z" },
    "https://c": { decision: "reject", at: "2026-10-05T19:00:00Z" },
  },
};

function table(stages: StageNumbers[]): Record<string, [string, string]> {
  return Object.fromEntries(stages.map((s) => [s.key, [s.value, s.line]]));
}

describe("buildStages", () => {
  it("returns the nine stages in order", () => {
    const stages = buildStages(makeConfig(), { status, queue, decisions }, "all");
    expect(stages.map((s) => s.key)).toEqual([...STAGE_KEYS]);
  });

  it("numbers one topic's last run with drop reasons", () => {
    const stages = buildStages(makeConfig(), { status: { ...status, drops }, queue, decisions }, "tooling");
    expect(table(stages)).toEqual({
      collect: ["101", "−2 undated"],
      window: ["100", "−1 too old"],
      dedupe: ["74", "−25 seen · −1 dismissed"],
      cache: ["70", "−4 cached below"],
      rank: ["25", "−45 below 6"],
      cap: ["3", "−22 over cap"],
      queue: ["2", "+3 this run"],
      review: ["1", "−2 rejected · −1 expired"],
      deliver: ["09-30", "approved only"],
    });
  });

  it("sums every topic under all", () => {
    const stages = buildStages(makeConfig(), { status: { ...status, drops }, queue, decisions }, "all");
    expect(table(stages)).toMatchObject({
      collect: ["114", "−2 undated"],
      window: ["113", "−1 too old"],
      dedupe: ["86", "−26 seen · −1 dismissed"],
      cache: ["82", "−4 cached below"],
      rank: ["30", "−52 below 6"],
      cap: ["6", "−24 over cap"],
      queue: ["3", "+6 this run"],
      review: ["1", "−2 rejected · −1 expired"],
    });
  });

  it("shows what today's status.json allows when drops are missing", () => {
    const stages = buildStages(makeConfig(), { status, queue, decisions }, "tooling");
    expect(table(stages)).toEqual({
      collect: ["101", "found"],
      window: ["100", ""],
      dedupe: ["—", ""],
      cache: ["70", ""],
      rank: ["—", ""],
      cap: ["3", ""],
      queue: ["2", "+3 this run"],
      review: ["1", ""],
      deliver: ["09-30", "approved only"],
    });
  });

  it("shows dashes when nothing has loaded", () => {
    const stages = buildStages(makeConfig(), { status: null, queue: null, decisions: null }, "all");
    expect(stages.map((s) => s.value)).toEqual(Array(9).fill("—"));
    expect(stages.find((s) => s.key === "deliver")?.line).toBe("approved only");
    expect(stages.find((s) => s.key === "collect")?.line).toBe("");
  });

  it("says never when nothing was ever delivered", () => {
    const stages = buildStages(makeConfig(), { status: { ...status, last_sent_at: null }, queue, decisions }, "all");
    expect(stages.find((s) => s.key === "deliver")?.value).toBe("never");
  });

  it("marks failed stages for the topics in view", () => {
    const failures = [
      { stage: "collect", topic: "tooling", source: "github_trending" },
      { stage: "collect", topic: "web", source: "hacker_news" },
      { stage: "rank", topic: "web", source: null },
      { stage: "inbox", topic: null, source: null },
      { stage: "deliver", topic: null, source: null },
    ];
    const one = buildStages(makeConfig(), { status: { ...status, failures }, queue, decisions }, "tooling");
    const failed = Object.fromEntries(one.map((s) => [s.key, s.failed]));
    expect(failed).toMatchObject({ collect: "github_trending", rank: null, review: "run", deliver: "run", cap: null });
    const all = buildStages(makeConfig(), { status: { ...status, failures }, queue, decisions }, "all");
    expect(all.find((s) => s.key === "collect")?.failed).toBe("github_trending, hacker_news");
    expect(all.find((s) => s.key === "rank")?.failed).toBe("run");
  });

  it("names the threshold only when the topics agree on it", () => {
    const config = makeConfig([topic("tooling", 6), topic("web", 7)]);
    const stages = buildStages(config, { status: { ...status, drops }, queue, decisions }, "all");
    expect(stages.find((s) => s.key === "rank")?.line).toBe("−52 below threshold");
  });
});

describe("topicSlugs", () => {
  it("expands all and passes one topic through", () => {
    expect(topicSlugs(makeConfig(), "all")).toEqual(["tooling", "web"]);
    expect(topicSlugs(makeConfig(), "web")).toEqual(["web"]);
  });
});
```

- [ ] **Step 6: Run them to verify they fail**

Run: `npx vitest run lib/pipeline-stages.test.ts`
Expected: FAIL — `Failed to resolve import "./pipeline-stages"`.

- [ ] **Step 7: Implement `lib/pipeline-stages.ts`**

```ts
import type { AgentConfig } from "./agent-config";
import type { AgentStatus } from "./agent-status";
import { type Decisions, itemStatus } from "./inbox";
import type { PendingQueue } from "./pending-queue";

/** "all", or one topic's slug. */
export type TopicFilter = "all" | (string & {});

/** The control room's rail, in reading order. "review" is where your
 * moderation sits logically; the agent applies decisions at the start of
 * its next run. */
export const STAGE_KEYS = ["collect", "window", "dedupe", "cache", "rank", "cap", "queue", "review", "deliver"] as const;
export type StageKey = (typeof STAGE_KEYS)[number];

export interface StageNumbers {
  key: StageKey;
  /** The big number, or "—" when the data for it isn't there. */
  value: string;
  /** What the stage removed (or added), muted; "" when unknown. */
  line: string;
  /** Sources (or "run") that failed at this stage this run; null if none. */
  failed: string | null;
}

export interface LiveData {
  status: AgentStatus | null;
  queue: PendingQueue | null;
  decisions: Decisions | null;
}

const DASH = "—";

/** status.json failure stages → the rail stage they belong to. */
const FAILED_STAGE: Record<string, StageKey> = {
  collect: "collect",
  rank: "rank",
  inbox: "review",
  deliver: "deliver",
};

export function topicSlugs(config: AgentConfig, topic: TopicFilter): string[] {
  return topic === "all" ? config.topics.map((t) => t.slug) : [topic];
}

function thresholdLabel(config: AgentConfig, slugs: string[]): string {
  const values = new Set(config.topics.filter((t) => slugs.includes(t.slug)).map((t) => t.minRelevance));
  return values.size === 1 ? String([...values][0]) : "threshold";
}

/**
 * Each rail stage's number and line for the topics in view, from the last
 * run's status.json (funnel, and drops/failures once the agent writes
 * them), the pending queue and the inbox decisions. See the spec's rail
 * table (docs/superpowers/specs/2026-10-06-tony-control-room-design.md).
 */
export function buildStages(config: AgentConfig, live: LiveData, topic: TopicFilter): StageNumbers[] {
  const slugs = topicSlugs(config, topic);
  const { status, queue, decisions } = live;
  const drops = status?.drops;

  const funnel = (field: "collected" | "in_window" | "new" | "kept"): number | null =>
    status ? slugs.reduce((n, slug) => n + (status.funnel[slug]?.[field] ?? 0), 0) : null;
  const drop = (stage: string, reason: string): number =>
    slugs.reduce((n, slug) => n + (drops?.[slug]?.[stage]?.[reason] ?? 0), 0);
  const show = (n: number | null): string => (n === null ? DASH : String(n));

  const collected = funnel("collected");
  const inWindow = funnel("in_window");
  const fresh = funnel("new");
  const kept = funnel("kept");
  const seen = drop("dedupe", "seen");
  const dismissed = drop("dedupe", "dismissed");
  const below = drop("rank", "below_relevance");

  const collectDrops = [
    [drop("collect", "undated"), "undated"],
    [drop("collect", "below_min_points"), "below min points"],
  ] as const;
  const collectLine = !status
    ? ""
    : drops && collectDrops.some(([n]) => n > 0)
      ? collectDrops
          .filter(([n]) => n > 0)
          .map(([n, label]) => `−${n} ${label}`)
          .join(" · ")
      : "found";

  const inView = queue ? queue.items.filter((i) => slugs.includes(i.topic)) : null;
  const approved =
    inView && decisions ? inView.filter((i) => itemStatus(decisions, i.url) === "approved").length : null;

  const rows: Omit<StageNumbers, "failed">[] = [
    { key: "collect", value: show(collected), line: collectLine },
    { key: "window", value: show(inWindow), line: drops ? `−${drop("date_guard", "outside_window")} too old` : "" },
    {
      key: "dedupe",
      value: drops && inWindow !== null ? String(inWindow - seen - dismissed) : DASH,
      line: drops ? `−${seen} seen · −${dismissed} dismissed` : "",
    },
    { key: "cache", value: show(fresh), line: drops ? `−${drop("dedupe", "already_ranked")} cached below` : "" },
    {
      key: "rank",
      value: drops && fresh !== null ? String(fresh - below) : DASH,
      line: drops ? `−${below} below ${thresholdLabel(config, slugs)}` : "",
    },
    { key: "cap", value: show(kept), line: drops ? `−${drop("rank", "over_max_items")} over cap` : "" },
    { key: "queue", value: show(inView ? inView.length : null), line: kept !== null ? `+${kept} this run` : "" },
    {
      key: "review",
      value: show(approved),
      line: drops ? `−${drop("inbox", "rejected")} rejected · −${drop("inbox", "expired")} expired` : "",
    },
    {
      key: "deliver",
      value: status ? (status.last_sent_at ? status.last_sent_at.slice(5, 10) : "never") : DASH,
      line: "approved only",
    },
  ];

  const failures = status?.failures ?? [];
  return rows.map((row) => {
    const hits = failures.filter(
      (f) => FAILED_STAGE[f.stage] === row.key && (f.topic === null || slugs.includes(f.topic)),
    );
    const failed = hits.length ? [...new Set(hits.map((f) => f.source ?? "run"))].join(", ") : null;
    return { ...row, failed };
  });
}
```

- [ ] **Step 8: Run the stage tests, the suite, types and lint**

Run: `npx vitest run lib/pipeline-stages.test.ts`
Expected: PASS (all).
Run: `npm test && npx tsc --noEmit && npx eslint lib`
Expected: pass, no errors.

- [ ] **Step 9: Docs**

In `CLAUDE.md`'s `npm test` comment, change `# lib/cron, lib/agent-config, scripts/presence` to `# lib/cron, lib/agent-config, lib/pipeline-stages, scripts/presence`. In `PROGRESS.md`'s sub-project #8 bullet, change the last sentence to `Done: Tasks 1–2 (config loader, rail numbers). Next: Task 3.`

- [ ] **Step 10: Commit**

```bash
git add lib/agent-status.ts lib/agent-status.test.ts lib/pipeline-stages.ts lib/pipeline-stages.test.ts CLAUDE.md PROGRESS.md
git commit -m "Compute the control room's pipeline numbers" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Outcomes and queue view — `lib/outcomes.ts`, `lib/queue-view.ts`

**Files:**
- Create: `lib/outcomes.ts`, `lib/outcomes.test.ts`, `lib/queue-view.ts`, `lib/queue-view.test.ts`
- Modify: `CLAUDE.md` (test list), `PROGRESS.md`

**Interfaces:**
- Consumes: `TopicFilter` (Task 2); `itemStatus`, `Decisions`; `PendingItem`.
- Produces:
  - `lib/outcomes.ts`: `STATE_URL`, `interface Verdict { relevance: number; rubric: string; ranked_at: string; queued_at: string | null }`, `interface StateEntry { times_sent: number; dismissed: string | null; ranks: Record<string, Verdict> }`, `type AgentState = Record<string, StateEntry>`, `parseAgentState(value: unknown): AgentState | null`, `interface Outcomes { queued; sent; rejected; expired; pending: number; histogram: number[]; scoredPerDay: { day: string; count: number }[] }`, `buildOutcomes(state, slugs, now, days = 14): Outcomes`, `topicVerdicts(state, slugs): { count: number; rubric: string | null }`.
  - `lib/queue-view.ts`: `STATUS_FILTERS`, `type StatusFilter`, `visibleItems(items, decisions, topic, status)`, `topicCounts(items, slugs)`, `statusCounts(items, decisions, topic)`, `nextSelection(rows, url)`, `resolveSelection(rows, url)`, `moveSelection(rows, url, delta)`.

- [ ] **Step 1: Write the failing outcomes tests**

Create `lib/outcomes.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { type AgentState, buildOutcomes, parseAgentState, topicVerdicts } from "./outcomes";

function verdict(relevance: number, rubric: string, at: string, queued: boolean) {
  return { relevance, rubric, ranked_at: at, queued_at: queued ? at : null };
}

const state: AgentState = {
  sent: { times_sent: 1, dismissed: null, ranks: { tooling: verdict(8, "aaa", "2026-10-05T18:22:00+00:00", true) } },
  rejected: { times_sent: 0, dismissed: "rejected", ranks: { tooling: verdict(7, "aaa", "2026-10-04T10:00:00+00:00", true) } },
  expired: { times_sent: 0, dismissed: "expired", ranks: { tooling: verdict(6, "bbb", "2026-10-06T08:00:00+00:00", true) } },
  pending: {
    times_sent: 0,
    dismissed: null,
    ranks: {
      tooling: verdict(9, "bbb", "2026-10-06T09:00:00+00:00", true),
      web: verdict(3, "ccc", "2026-10-06T09:00:00+00:00", false),
    },
  },
  old: { times_sent: 0, dismissed: null, ranks: { tooling: verdict(2, "old", "2026-09-01T00:00:00+00:00", true) } },
  "pre-#6": { times_sent: 1, dismissed: null, ranks: {} },
};

const now = new Date("2026-10-06T12:00:00Z");

describe("buildOutcomes", () => {
  it("buckets queued items like agent/report.py", () => {
    const out = buildOutcomes(state, ["tooling"], now);
    expect(out).toMatchObject({ queued: 4, sent: 1, rejected: 1, expired: 1, pending: 1 });
    expect(out.histogram).toEqual([0, 0, 0, 0, 0, 1, 1, 1, 1, 0]);
  });

  it("counts verdicts per UTC day over the last 14 days", () => {
    const out = buildOutcomes(state, ["tooling"], now);
    expect(out.scoredPerDay).toHaveLength(14);
    expect(out.scoredPerDay[0]).toEqual({ day: "2026-09-23", count: 0 });
    expect(out.scoredPerDay.slice(-3)).toEqual([
      { day: "2026-10-04", count: 1 },
      { day: "2026-10-05", count: 1 },
      { day: "2026-10-06", count: 2 },
    ]);
  });

  it("adds topics together", () => {
    const out = buildOutcomes(state, ["tooling", "web"], now);
    expect(out.queued).toBe(4);
    expect(out.histogram[2]).toBe(1);
    expect(out.scoredPerDay.at(-1)).toEqual({ day: "2026-10-06", count: 3 });
  });
});

describe("topicVerdicts", () => {
  it("counts a topic's cached verdicts and names the newest rubric", () => {
    expect(topicVerdicts(state, ["tooling"])).toEqual({ count: 5, rubric: "bbb" });
    expect(topicVerdicts(state, ["nope"])).toEqual({ count: 0, rubric: null });
  });
});

describe("parseAgentState", () => {
  it("loads entries without ranks or dismissed, like dedupe.load_state", () => {
    expect(parseAgentState({ abc: { first_seen: "x", last_score: 3, times_sent: 0 } })).toEqual({
      abc: { times_sent: 0, dismissed: null, ranks: {} },
    });
  });

  it("keeps verdicts and drops fields the page doesn't use", () => {
    const parsed = parseAgentState({
      abc: {
        times_sent: 0,
        dismissed: null,
        ranks: { tooling: { relevance: 7, rubric: "r", ranked_at: "t", source_score: 80, summary: "s", queued_at: null } },
      },
    });
    expect(parsed?.abc.ranks.tooling).toEqual({ relevance: 7, rubric: "r", ranked_at: "t", queued_at: null });
  });

  it("rejects malformed files", () => {
    expect(parseAgentState([])).toBeNull();
    expect(parseAgentState({ abc: { times_sent: "1" } })).toBeNull();
    expect(parseAgentState({ abc: { times_sent: 0, dismissed: 3 } })).toBeNull();
    expect(parseAgentState({ abc: { times_sent: 0, ranks: { t: { relevance: "7", rubric: "r", ranked_at: "t" } } } })).toBeNull();
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run lib/outcomes.test.ts`
Expected: FAIL — `Failed to resolve import "./outcomes"`.

- [ ] **Step 3: Implement `lib/outcomes.ts`**

```ts
export const STATE_URL =
  "https://raw.githubusercontent.com/hpnssflw/hpnssflw.github.io/agent-data/agent/state.json";

/** One topic's cached verdict on an item (agent/dedupe.py's RankRecord, the fields the page uses). */
export interface Verdict {
  relevance: number;
  rubric: string;
  ranked_at: string;
  queued_at: string | null;
}

export interface StateEntry {
  times_sent: number;
  dismissed: string | null;
  ranks: Record<string, Verdict>;
}

/** state.json: URL hash → entry. */
export type AgentState = Record<string, StateEntry>;

export interface Outcomes {
  queued: number;
  sent: number;
  rejected: number;
  expired: number;
  pending: number;
  /** Verdicts by relevance; index 0 is relevance 1. */
  histogram: number[];
  /** Items sent to DeepSeek per UTC day — the last `days` days through today, oldest first. */
  scoredPerDay: { day: string; count: number }[];
}

const DAY_MS = 86_400_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Validates and normalizes a fetched state.json. Like agent/dedupe.py's
 * load_state, entries without `ranks` (before #6) or `dismissed` (before
 * #5) load with an empty value; any malformed part fails the whole file.
 */
export function parseAgentState(value: unknown): AgentState | null {
  if (!isRecord(value)) return null;
  const state: AgentState = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!isRecord(raw) || typeof raw.times_sent !== "number") return null;
    const dismissed = raw.dismissed ?? null;
    if (dismissed !== null && typeof dismissed !== "string") return null;
    const rawRanks = raw.ranks ?? {};
    if (!isRecord(rawRanks)) return null;
    const ranks: Record<string, Verdict> = {};
    for (const [slug, r] of Object.entries(rawRanks)) {
      if (!isRecord(r) || typeof r.relevance !== "number" || typeof r.rubric !== "string" || typeof r.ranked_at !== "string") {
        return null;
      }
      const queuedAt = r.queued_at ?? null;
      if (queuedAt !== null && typeof queuedAt !== "string") return null;
      ranks[slug] = { relevance: r.relevance, rubric: r.rubric, ranked_at: r.ranked_at, queued_at: queuedAt };
    }
    state[key] = { times_sent: raw.times_sent, dismissed, ranks };
  }
  return state;
}

/**
 * agent/report.py's build_report over the given topics: what happened to
 * items queued in the last `days` days, the relevance histogram, and how
 * many items were scored (sent to DeepSeek) per day. An item queued under
 * two topics counts once per topic, as in the report.
 */
export function buildOutcomes(state: AgentState, slugs: string[], now: Date, days = 14): Outcomes {
  const since = now.getTime() - days * DAY_MS;
  const out: Outcomes = { queued: 0, sent: 0, rejected: 0, expired: 0, pending: 0, histogram: Array(10).fill(0), scoredPerDay: [] };
  const perDay = new Map<string, number>();
  for (let i = days - 1; i >= 0; i--) perDay.set(new Date(now.getTime() - i * DAY_MS).toISOString().slice(0, 10), 0);

  for (const entry of Object.values(state)) {
    for (const slug of slugs) {
      const verdict = entry.ranks[slug];
      if (!verdict) continue;
      const rankedAt = Date.parse(verdict.ranked_at);
      if (rankedAt >= since) {
        if (Number.isInteger(verdict.relevance) && verdict.relevance >= 1 && verdict.relevance <= 10) {
          out.histogram[verdict.relevance - 1] += 1;
        }
        const day = new Date(rankedAt).toISOString().slice(0, 10);
        const count = perDay.get(day);
        if (count !== undefined) perDay.set(day, count + 1);
      }
      if (verdict.queued_at !== null && Date.parse(verdict.queued_at) >= since) {
        out.queued += 1;
        if (entry.times_sent > 0) out.sent += 1;
        else if (entry.dismissed === "rejected") out.rejected += 1;
        else if (entry.dismissed === "expired") out.expired += 1;
        else if (entry.dismissed === null) out.pending += 1;
      }
    }
  }
  out.scoredPerDay = [...perDay].map(([day, count]) => ({ day, count }));
  return out;
}

/** How many cached verdicts the topics hold, and the rubric of the newest — the cache stage's numbers. */
export function topicVerdicts(state: AgentState, slugs: string[]): { count: number; rubric: string | null } {
  let count = 0;
  let newest = -Infinity;
  let rubric: string | null = null;
  for (const entry of Object.values(state)) {
    for (const slug of slugs) {
      const verdict = entry.ranks[slug];
      if (!verdict) continue;
      count += 1;
      const at = Date.parse(verdict.ranked_at);
      if (at > newest) {
        newest = at;
        rubric = verdict.rubric;
      }
    }
  }
  return { count, rubric };
}
```

- [ ] **Step 4: Run the outcomes tests**

Run: `npx vitest run lib/outcomes.test.ts`
Expected: PASS (all).

- [ ] **Step 5: Write the failing queue-view tests**

Create `lib/queue-view.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { Decisions } from "./inbox";
import type { PendingItem } from "./pending-queue";
import { moveSelection, nextSelection, resolveSelection, statusCounts, topicCounts, visibleItems } from "./queue-view";

function item(url: string, topic: string, score: number, since: string): PendingItem {
  return { url, title: url, source: "hn", topic, topic_name: topic, summary: "", score, pending_since: since };
}

const items = [
  item("a", "tooling", 7, "2026-10-01T00:00:00Z"),
  item("b", "tooling", 9, "2026-10-02T00:00:00Z"),
  item("c", "web", 7, "2026-10-03T00:00:00Z"),
  item("d", "tooling", 7, "2026-10-04T00:00:00Z"),
];

const decisions: Decisions = {
  version: 1,
  decisions: { a: { decision: "approve", at: "x" }, c: { decision: "reject", at: "x" } },
};

const urls = (rows: PendingItem[]) => rows.map((r) => r.url);

describe("visibleItems", () => {
  it("sorts by score, then the newest first", () => {
    expect(urls(visibleItems(items, null, "all", "all"))).toEqual(["b", "d", "c", "a"]);
  });

  it("filters by topic and status", () => {
    expect(urls(visibleItems(items, decisions, "tooling", "waiting"))).toEqual(["b", "d"]);
    expect(urls(visibleItems(items, decisions, "all", "approved"))).toEqual(["a"]);
    expect(urls(visibleItems(items, decisions, "all", "rejected"))).toEqual(["c"]);
  });

  it("treats everything as waiting without decisions", () => {
    expect(urls(visibleItems(items, null, "all", "waiting"))).toEqual(["b", "d", "c", "a"]);
  });
});

describe("counts", () => {
  it("counts pending items per topic, plus all", () => {
    expect(topicCounts(items, ["tooling", "web", "empty"])).toEqual({ all: 4, tooling: 3, web: 1, empty: 0 });
  });

  it("counts statuses within the topic in view", () => {
    expect(statusCounts(items, decisions, "all")).toEqual({ waiting: 2, approved: 1, rejected: 1, all: 4 });
    expect(statusCounts(items, decisions, "tooling")).toEqual({ waiting: 2, approved: 1, rejected: 0, all: 3 });
  });
});

describe("selection", () => {
  const rows = visibleItems(items, null, "all", "all"); // b d c a

  it("moves to the row below a decided one, else the one above", () => {
    expect(nextSelection(rows, "d")).toBe("c");
    expect(nextSelection(rows, "a")).toBe("c");
    expect(nextSelection([rows[0]], "b")).toBeNull();
    expect(nextSelection(rows, "missing")).toBe("b");
  });

  it("falls back to the first row", () => {
    expect(resolveSelection(rows, "c")?.url).toBe("c");
    expect(resolveSelection(rows, "gone")?.url).toBe("b");
    expect(resolveSelection(rows, null)?.url).toBe("b");
    expect(resolveSelection([], null)).toBeNull();
  });

  it("moves j/k within the list", () => {
    expect(moveSelection(rows, null, 1)).toBe("d");
    expect(moveSelection(rows, "d", -1)).toBe("b");
    expect(moveSelection(rows, "b", -1)).toBe("b");
    expect(moveSelection(rows, "a", 1)).toBe("a");
    expect(moveSelection([], null, 1)).toBeNull();
  });
});
```

- [ ] **Step 6: Run them to verify they fail**

Run: `npx vitest run lib/queue-view.test.ts`
Expected: FAIL — `Failed to resolve import "./queue-view"`.

- [ ] **Step 7: Implement `lib/queue-view.ts`**

```ts
import { type Decisions, itemStatus } from "./inbox";
import type { PendingItem } from "./pending-queue";
import type { TopicFilter } from "./pipeline-stages";

export const STATUS_FILTERS = ["waiting", "approved", "rejected", "all"] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number];

function inTopic(item: PendingItem, topic: TopicFilter): boolean {
  return topic === "all" || item.topic === topic;
}

/** Score descending, then the most recently queued first. */
function byScoreThenNewest(a: PendingItem, b: PendingItem): number {
  return b.score - a.score || b.pending_since.localeCompare(a.pending_since);
}

/** The queue pane's rows. Without decisions every item counts as waiting. */
export function visibleItems(
  items: PendingItem[],
  decisions: Decisions | null,
  topic: TopicFilter,
  status: StatusFilter,
): PendingItem[] {
  return items
    .filter((i) => inTopic(i, topic) && (status === "all" || itemStatus(decisions, i.url) === status))
    .sort(byScoreThenNewest);
}

/** Pending items per topic slug, plus "all" (which also counts items of retired topics). */
export function topicCounts(items: PendingItem[], slugs: string[]): Record<string, number> {
  const counts: Record<string, number> = { all: items.length };
  for (const slug of slugs) counts[slug] = 0;
  for (const item of items) if (item.topic in counts && item.topic !== "all") counts[item.topic] += 1;
  return counts;
}

export function statusCounts(
  items: PendingItem[],
  decisions: Decisions | null,
  topic: TopicFilter,
): Record<StatusFilter, number> {
  const pool = items.filter((i) => inTopic(i, topic));
  const counts: Record<StatusFilter, number> = { waiting: 0, approved: 0, rejected: 0, all: pool.length };
  for (const item of pool) counts[itemStatus(decisions, item.url)] += 1;
  return counts;
}

/** After deciding `url`: the row below it in `rows` (the list before the decision), else the one above. */
export function nextSelection(rows: PendingItem[], url: string): string | null {
  const i = rows.findIndex((r) => r.url === url);
  if (i === -1) return rows[0]?.url ?? null;
  return rows[i + 1]?.url ?? rows[i - 1]?.url ?? null;
}

/** The selected row: `url` while it's visible, else the first row. */
export function resolveSelection(rows: PendingItem[], url: string | null): PendingItem | null {
  return rows.find((r) => r.url === url) ?? rows[0] ?? null;
}

/** j/k: `delta` rows from the selection (the first row when none), clamped. */
export function moveSelection(rows: PendingItem[], url: string | null, delta: number): string | null {
  if (rows.length === 0) return null;
  const i = Math.max(0, rows.findIndex((r) => r.url === url));
  return rows[Math.min(rows.length - 1, Math.max(0, i + delta))].url;
}
```

- [ ] **Step 8: Run the tests, the suite, types and lint**

Run: `npx vitest run lib/queue-view.test.ts lib/outcomes.test.ts`
Expected: PASS.
Run: `npm test && npx tsc --noEmit && npx eslint lib`
Expected: pass, no errors.

- [ ] **Step 9: Docs**

In `CLAUDE.md`'s `npm test` comment, change `# lib/cron, lib/agent-config, lib/pipeline-stages, scripts/presence` to:

```
                          # lib/cron, lib/agent-config, lib/pipeline-stages,
                          # lib/outcomes, lib/queue-view, scripts/presence
```

In `PROGRESS.md`'s sub-project #8 bullet: `Done: Tasks 1–3 (config loader, rail numbers, outcomes and queue view). Next: Task 4.`

- [ ] **Step 10: Commit**

```bash
git add lib/outcomes.ts lib/outcomes.test.ts lib/queue-view.ts lib/queue-view.test.ts CLAUDE.md PROGRESS.md
git commit -m "Port the agent's report and the queue's filters for the control room" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Control room page, part 1 — pulse, topic chips, moderation queue

The page is replaced; this task ships the pulse, topic chips and the queue with #5's owner mode and the new keys. Task 5 adds the rail, config spine and outcomes.

**Files:**
- Create: `components/useJson.ts`, `components/useInbox.ts`, `components/TonyMark.tsx`, `components/ControlPulse.tsx`, `components/QueuePane.tsx`, `components/ControlRoom.tsx`
- Modify: `components/InboxControls.tsx` (rewrite), `components/AppsStrip.tsx` (use `TonyMark`), `app/researcher/queue/page.tsx` (rewrite), `app/globals.css`
- Delete: `components/PendingQueue.tsx`
- Modify: `PROGRESS.md`
- Throwaway: `.superpowers/sdd/2026-10-06-control-room/cdp.mjs`

**Interfaces:**
- Consumes: `AgentConfig`, `loadAgentConfig` (Task 1); `nextRun`, `CronSchedule` (Task 1); `TopicFilter`, `topicSlugs` (Task 2); `StatusFilter`, `STATUS_FILTERS`, `visibleItems`, `topicCounts`, `statusCounts`, `nextSelection`, `resolveSelection`, `moveSelection` (Task 3); `lib/inbox.ts`, `lib/github-contents.ts`, `lib/pending-queue.ts`, `lib/agent-status.ts` (existing).
- Produces:
  - `useJson<T>(url: string, accept: (value: unknown) => T | null): { data: T | null; failed: boolean; loadedAt: Date | null }`.
  - `useInbox(queue: PendingQueue | null, queueLoadedAt: Date | null): Inbox` with `Inbox = { decisions: Decisions | null; signedIn: boolean; canWrite: boolean; busy: boolean; error: string | null; signIn(token): Promise<void>; signOut(): void; decide(item, decision: Decision | null): Promise<void> }`.
  - `InboxControls.tsx`: `readToken`, `writeToken`, `clearToken`, `OwnerSlot({ signedIn, error, onSignIn, onSignOut })`.
  - `TonyMark({ size })` default export.
  - `ControlRoom({ config })` default export; CSS classes `.cr`, `.cr-wrap`, `.cr-grid`, `.cr-pane`, `.cr-pane-head`, `.cr-scroll`, `.cr-label`, `.cr-k`, `.cr-value`, `.cr-chips`, `.cr-chip`, `.cr-topics` that Task 5 builds on.

- [ ] **Step 1: The CDP check script**

Create `.superpowers/sdd/2026-10-06-control-room/cdp.mjs` (used by Tasks 4, 5 and 7):

```js
// node --experimental-websocket cdp.mjs <url> <out.png> <width> <height> [script.js ...]
// Opens <url> in headless Chrome at width x height, runs each script file
// (a JS expression; may be an async IIFE) and prints its value, prints the
// page's scroll metrics, and saves a screenshot. A script that returns the
// string "reload" (after calling location.reload()) gets 6s for the page
// to load again before the next script runs.
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [url, out, width, height, ...scripts] = process.argv.slice(2);
const port = 9400 + Math.floor(Math.random() * 400);
const chrome = spawn(
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), "cr-chrome-"))}`, "--hide-scrollbars", "about:blank"],
  { stdio: "ignore" },
);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  let target;
  for (let i = 0; i < 60 && !target; i++) {
    try {
      target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === "page");
    } catch {}
    if (!target) await sleep(500);
  }
  if (!target) throw new Error("chrome did not start");
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0;
  const waiting = new Map();
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    waiting.get(msg.id)?.(msg);
    waiting.delete(msg.id);
  };
  const send = (method, params = {}) =>
    new Promise((r) => {
      id += 1;
      waiting.set(id, r);
      ws.send(JSON.stringify({ id, method, params }));
    });
  await send("Emulation.setDeviceMetricsOverride", { width: +width, height: +height, deviceScaleFactor: 1, mobile: +width < 600 });
  await send("Page.navigate", { url });
  await sleep(5000);
  for (const file of scripts) {
    const res = await send("Runtime.evaluate", { expression: readFileSync(file, "utf8"), awaitPromise: true, returnByValue: true });
    const value = res.result?.result?.value;
    console.log(file, JSON.stringify(value ?? res.result?.exceptionDetails?.text));
    await sleep(value === "reload" ? 6000 : 500);
  }
  const m = await send("Runtime.evaluate", {
    expression: "JSON.stringify({scrollHeight: document.documentElement.scrollHeight, innerHeight, scrollWidth: document.documentElement.scrollWidth, innerWidth})",
    returnByValue: true,
  });
  console.log("page", m.result.result.value);
  const shot = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(out, Buffer.from(shot.result.data, "base64"));
  ws.close();
} finally {
  chrome.kill();
}
```

- [ ] **Step 2: `components/useJson.ts`**

```ts
import { useEffect, useState } from "react";

export interface Loaded<T> {
  data: T | null;
  /** The fetch failed, or the payload didn't pass `accept`. */
  failed: boolean;
  loadedAt: Date | null;
}

/**
 * Fetches one public JSON file once, client-side, uncached. `accept`
 * validates (and may normalize) the payload — null means malformed — and
 * must be a stable, module-level function, or the effect refetches.
 */
export function useJson<T>(url: string, accept: (value: unknown) => T | null): Loaded<T> {
  const [loaded, setLoaded] = useState<Loaded<T>>({ data: null, failed: false, loadedAt: null });
  useEffect(() => {
    let cancelled = false;
    fetch(url, { cache: "no-store" })
      .then((res) => {
        if (!res.ok) throw new Error(`${url}: ${res.status}`);
        return res.json();
      })
      .then((value: unknown) => {
        if (cancelled) return;
        const data = accept(value);
        setLoaded({ data, failed: data === null, loadedAt: data === null ? null : new Date() });
      })
      .catch(() => {
        if (!cancelled) setLoaded({ data: null, failed: true, loadedAt: null });
      });
    return () => {
      cancelled = true;
    };
  }, [url, accept]);
  return loaded;
}
```

- [ ] **Step 3: Rewrite `components/InboxControls.tsx`**

Replace the whole file:

```tsx
"use client";

import { type FormEvent, useState } from "react";

const TOKEN_KEY = "tony-inbox-token";

/* localStorage can throw (blocked site data, some private modes); any
   failure just means public mode. */

export function readToken(): string | null {
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function writeToken(token: string): void {
  try {
    window.localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // Not persisted: owner mode lasts for this page view only.
  }
}

export function clearToken(): void {
  try {
    window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Nothing stored to clear.
  }
}

/**
 * The control room pulse's right end: "owner" opens the token field in
 * place; signed in, "sign out". Errors (a rejected token, a failed write)
 * show under it in red.
 */
export function OwnerSlot({
  signedIn,
  error,
  onSignIn,
  onSignOut,
}: {
  signedIn: boolean;
  error: string | null;
  onSignIn: (token: string) => Promise<void>;
  onSignOut: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [checking, setChecking] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const candidate = draft.trim();
    if (!candidate) return;
    setChecking(true);
    await onSignIn(candidate);
    setChecking(false);
    setDraft("");
  }

  return (
    <div className="owner-slot">
      {signedIn ? (
        <button type="button" className="inbox-button" onClick={onSignOut}>
          sign out
        </button>
      ) : open ? (
        <form className="inbox-token-form" onSubmit={submit}>
          <input
            type="password"
            className="inbox-token"
            aria-label="GitHub token for hpnssflw/tony-inbox"
            placeholder="github token"
            autoComplete="off"
            autoFocus
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
          <button type="submit" className="inbox-button" disabled={checking}>
            {checking ? "checking" : "save"}
          </button>
        </form>
      ) : (
        <button type="button" className="inbox-button" onClick={() => setOpen(true)}>
          owner
        </button>
      )}
      {error && <p className="inbox-error">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 4: `components/useInbox.ts`** (the owner-mode logic from `PendingQueue.tsx`, unchanged in behavior)

```ts
import { useEffect, useState } from "react";
import { clearToken, readToken, writeToken } from "@/components/InboxControls";
import { GitHubAuthError, GitHubConflictError, putFile } from "@/lib/github-contents";
import {
  type Decision,
  type Decisions,
  type OwnerSnapshot,
  DECISIONS_PATH,
  DECISIONS_REPO,
  PRUNE_GRACE_MS,
  commitMessage,
  fetchOwnerDecisions,
  fetchPublicDecisions,
  pruneDecisions,
  serializeDecisions,
  setDecision,
} from "@/lib/inbox";
import type { PendingItem, PendingQueue } from "@/lib/pending-queue";

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "something went wrong";
}

export interface Inbox {
  /** The owner's API copy when signed in, else the public file; null if neither loaded. */
  decisions: Decisions | null;
  signedIn: boolean;
  /** Signed in and the owner snapshot (with its sha) loaded: writes are possible. */
  canWrite: boolean;
  busy: boolean;
  error: string | null;
  signIn: (token: string) => Promise<void>;
  signOut: () => void;
  decide: (item: PendingItem, decision: Decision | null) => Promise<void>;
}

/**
 * The inbox's owner mode (docs/superpowers/specs/2026-09-28-tony-scraponi-inbox-design.md),
 * moved out of the old PendingQueue component unchanged: the token lives
 * in localStorage; every decision is an optimistic write of decisions.json
 * to hpnssflw/tony-inbox with the last sha, retried once on a conflict
 * after re-reading; entries for items no longer queued are pruned with a
 * grace period so a stale tab can't delete another device's decisions.
 */
export function useInbox(queue: PendingQueue | null, queueLoadedAt: Date | null): Inbox {
  const [publicDecisions, setPublicDecisions] = useState<Decisions | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [owner, setOwner] = useState<OwnerSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchPublicDecisions().then((decisions) => {
      if (!cancelled) setPublicDecisions(decisions);
    });
    const stored = readToken();
    if (stored) {
      fetchOwnerDecisions(stored)
        .then((snapshot) => {
          if (cancelled) return;
          setToken(stored);
          setOwner(snapshot);
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          if (err instanceof GitHubAuthError) {
            clearToken();
            setError("token rejected — signed out");
          } else {
            setToken(stored);
            setError(errorMessage(err));
          }
        });
    }
    return () => {
      cancelled = true;
    };
  }, []);

  async function signIn(candidate: string) {
    setError(null);
    try {
      const snapshot = await fetchOwnerDecisions(candidate);
      writeToken(candidate);
      setToken(candidate);
      setOwner(snapshot);
    } catch (err) {
      setError(err instanceof GitHubAuthError ? "token rejected — not saved" : errorMessage(err));
    }
  }

  function signOut() {
    clearToken();
    setToken(null);
    setOwner(null);
    setError(null);
  }

  async function decide(item: PendingItem, decision: Decision | null) {
    if (!token || !owner || !queue || !queueLoadedAt) return;
    const liveUrls = queue.items.map((i) => i.url);
    const keepNewerThan = new Date(queueLoadedAt.getTime() - PRUNE_GRACE_MS);
    const apply = (base: Decisions) =>
      pruneDecisions(setDecision(base, item.url, decision, new Date()), liveUrls, keepNewerThan);
    const message = commitMessage(decision ?? "undo", item.title);
    const previous = owner;
    const optimistic = apply(previous.decisions);

    setBusy(true);
    setError(null);
    setOwner({ decisions: optimistic, sha: previous.sha });
    try {
      try {
        const { sha } = await putFile(DECISIONS_REPO, DECISIONS_PATH, serializeDecisions(optimistic), previous.sha, message, token);
        setOwner({ decisions: optimistic, sha });
      } catch (err) {
        if (!(err instanceof GitHubConflictError)) throw err;
        // Stale sha (e.g. another tab wrote first): re-read, re-apply, retry once.
        const fresh = await fetchOwnerDecisions(token);
        const retried = apply(fresh.decisions);
        const { sha } = await putFile(DECISIONS_REPO, DECISIONS_PATH, serializeDecisions(retried), fresh.sha, message, token);
        setOwner({ decisions: retried, sha });
      }
    } catch (err) {
      if (err instanceof GitHubAuthError) {
        clearToken();
        setToken(null);
        setOwner(null);
        setError("token rejected — signed out");
      } else {
        setOwner(previous);
        setError(errorMessage(err));
      }
    } finally {
      setBusy(false);
    }
  }

  return {
    decisions: owner?.decisions ?? publicDecisions,
    signedIn: token !== null,
    canWrite: token !== null && owner !== null,
    busy,
    error,
    signIn,
    signOut,
    decide,
  };
}
```

- [ ] **Step 5: `components/TonyMark.tsx`, and `AppsStrip` uses it**

Create `components/TonyMark.tsx`:

```tsx
import { useId } from "react";

/**
 * Tony Scraponi's mark: a spy — a lime fedora with a band, dark glasses —
 * for a scraper with a mobster's name. Now and then the hat tips and a
 * glint crosses the lenses ("The spy" in globals.css; off under reduced
 * motion). Used by the home teaser and the control room's pulse.
 */
export default function TonyMark({ size = 28 }: { size?: number }) {
  const clipId = `tony-lenses-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  return (
    <svg className="app-icon" width={size} height={size} viewBox="0 0 28 28" aria-hidden="true">
      <defs>
        <clipPath id={clipId}>
          <circle cx="10.9" cy="19" r="2.6" />
          <circle cx="17.1" cy="19" r="2.6" />
        </clipPath>
      </defs>
      <rect x="0.5" y="0.5" width="27" height="27" rx="6" className="app-icon-tile" />
      <g className="tony-hat">
        <path d="M8.5 13.2 C8.5 9.6 10.4 7.6 14 7.6 C17.6 7.6 19.5 9.6 19.5 13.2 Z" className="tony-hat-crown" />
        <path d="M11 9.6 Q14 11.2 17 9.6" className="tony-hat-dent" />
        <path d="M8.7 11.9 L19.3 11.9" className="tony-hat-band" />
        <path d="M4.6 13.5 Q14 17.4 23.4 13.5 Q14 15.4 4.6 13.5 Z" className="tony-hat-brim" />
      </g>
      <circle cx="10.9" cy="19" r="2.6" className="tony-lens" />
      <circle cx="17.1" cy="19" r="2.6" className="tony-lens" />
      <path d="M13.5 18.6 Q14 18.1 14.5 18.6" className="tony-bridge" />
      <g clipPath={`url(#${clipId})`}>
        <rect x="6" y="14" width="2.2" height="10" className="tony-glint" />
      </g>
    </svg>
  );
}
```

In `components/AppsStrip.tsx`: delete the `TonyIcon` function and its doc comment, add `import TonyMark from "@/components/TonyMark";`, and replace `<TonyIcon size={36} />` with `<TonyMark size={36} />`. Nothing else changes in this task.

- [ ] **Step 6: `components/ControlPulse.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";
import { OwnerSlot } from "@/components/InboxControls";
import TonyMark from "@/components/TonyMark";
import { type AgentStatus, fmtCountdown, isStale, sparklineCells } from "@/lib/agent-status";
import { type CronSchedule, nextRun } from "@/lib/cron";

function hhmm(date: Date): string {
  return date.toISOString().slice(11, 16);
}

function ago(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return hours < 48 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`;
}

export interface OwnerControls {
  signedIn: boolean;
  error: string | null;
  onSignIn: (token: string) => Promise<void>;
  onSignOut: () => void;
}

/**
 * The control room's top strip: live/stale, the last run, the next cron
 * slot with a countdown (from agent-run.yml's schedule — a manual run at
 * 18:22 is followed by the 20:00 slot, not 22:22), streak, kept-per-run
 * sparkline, the last digest, and the owner slot.
 */
export default function ControlPulse({
  status,
  failed,
  schedule,
  owner,
}: {
  status: AgentStatus | null;
  failed: boolean;
  schedule: CronSchedule;
  owner: OwnerControls;
}) {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  const next = now === null ? null : nextRun(schedule, new Date(now));
  const stale = status !== null && now !== null && isStale(status, now);
  const cells = status ? sparklineCells(status.run_history) : [];

  return (
    <div className="cr-pulse">
      <TonyMark size={32} />
      <p className="cr-pulse-id">
        <span className="tony-name">Tony Scraponi</span>
        <span className="agent-muted">control room</span>
      </p>
      <p className="cr-pulse-line">
        {status ? (
          <>
            <span className={stale ? "agent-dot-stale" : "agent-dot-online"} aria-hidden="true">
              ●
            </span>{" "}
            {stale ? "stale" : "live"}
            <span className="cr-sep">·</span>
            last run <b>{hhmm(new Date(status.updated_at))}</b> utc
            {now !== null && <span className="agent-muted"> ({ago(now - Date.parse(status.updated_at))})</span>}
            <span className="cr-sep">·</span>
          </>
        ) : failed ? (
          <>
            <span className="agent-muted">status unavailable</span>
            <span className="cr-sep">·</span>
          </>
        ) : null}
        next <b>{next ? hhmm(next) : "--:--"}</b>
        {next && now !== null && <span className="agent-muted"> in {fmtCountdown((next.getTime() - now) / 1000)}</span>}
        {status && (
          <>
            <span className="cr-sep">·</span>
            streak <b>{status.streak}</b>
            <span className="cr-sep">·</span>
            <span className="agent-spark" title={`kept per run, last ${cells.length} runs`}>
              {cells.map((cell, i) => (
                <span key={i} className={cell.zero ? "agent-spark-zero" : undefined}>
                  {cell.glyph}
                </span>
              ))}
            </span>
            <span className="cr-sep">·</span>
            digest <b>{status.last_sent_at ? status.last_sent_at.slice(5, 10) : "never"}</b>
          </>
        )}
      </p>
      <OwnerSlot {...owner} />
      <div className="card-comet" aria-hidden="true">
        <span className="card-comet-run" />
      </div>
    </div>
  );
}
```

- [ ] **Step 7: `components/QueuePane.tsx`**

```tsx
"use client";

import { useEffect, useRef } from "react";
import { type Decision, type Decisions, itemStatus } from "@/lib/inbox";
import type { PendingItem } from "@/lib/pending-queue";
import { STATUS_FILTERS, type StatusFilter, moveSelection } from "@/lib/queue-view";

function domain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function typingIn(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
  );
}

/**
 * The moderation queue: status chips, one row per item (score, title,
 * source · domain · topic · date), the selected row unfolded with its
 * summary and actions. Keys: j/k move and o opens for everyone; a/r/u
 * approve, reject and undo for the owner.
 */
export default function QueuePane({
  rows,
  counts,
  statusFilter,
  onStatusFilter,
  selected,
  onSelect,
  decisions,
  topicNames,
  canDecide,
  busy,
  loaded,
  failed,
  onDecide,
}: {
  rows: PendingItem[];
  counts: Record<StatusFilter, number>;
  statusFilter: StatusFilter;
  onStatusFilter: (status: StatusFilter) => void;
  selected: PendingItem | null;
  onSelect: (url: string | null) => void;
  decisions: Decisions | null;
  /** slug → name, shown in each row's meta line; null when one topic is picked. */
  topicNames: Record<string, string> | null;
  canDecide: boolean;
  busy: boolean;
  loaded: boolean;
  failed: boolean;
  onDecide: (item: PendingItem, decision: Decision | null) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey || typingIn(event.target)) return;
      const key = event.key;
      if (key === "j" || key === "k") {
        onSelect(moveSelection(rows, selected?.url ?? null, key === "j" ? 1 : -1));
      } else if (key === "o" && selected) {
        window.open(selected.url, "_blank", "noopener,noreferrer");
      } else if ((key === "a" || key === "r" || key === "u") && canDecide && !busy && selected) {
        const status = itemStatus(decisions, selected.url);
        if (key === "u" && status !== "waiting") onDecide(selected, null);
        if (key !== "u" && status === "waiting") onDecide(selected, key === "a" ? "approve" : "reject");
      } else {
        return;
      }
      event.preventDefault();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rows, selected, canDecide, busy, decisions, onSelect, onDecide]);

  useEffect(() => {
    listRef.current?.querySelector('[data-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [selected?.url]);

  return (
    <section className="cr-pane cr-queue" aria-label="Queue">
      <header className="cr-pane-head">
        <span className="cr-label">Queue</span>
        {decisions && (
          <div className="cr-chips" role="group" aria-label="Status">
            {STATUS_FILTERS.map((status) => (
              <button
                key={status}
                type="button"
                className="cr-chip"
                aria-pressed={statusFilter === status}
                onClick={() => onStatusFilter(status)}
              >
                {status} <span className="cr-chip-n">{counts[status]}</span>
              </button>
            ))}
          </div>
        )}
      </header>
      <div className="cr-scroll" ref={listRef}>
        {failed ? (
          <p className="agent-unavailable cr-empty">queue unavailable</p>
        ) : loaded && rows.length === 0 ? (
          <p className="agent-muted cr-empty">nothing here</p>
        ) : (
          <ul className="cr-rows">
            {rows.map((item) => {
              const on = selected?.url === item.url;
              const status = itemStatus(decisions, item.url);
              return (
                <li
                  key={item.url}
                  className="cr-row"
                  data-selected={on}
                  data-status={status}
                  onClick={() => onSelect(item.url)}
                >
                  <div className="cr-row-line">
                    <span className={item.score >= 8 ? "cr-score is-high" : "cr-score"}>{item.score}</span>
                    <span className="cr-title">{item.title}</span>
                    {decisions && status !== "waiting" && (
                      <span className={`cr-decision inbox-${status}`}>{status}</span>
                    )}
                  </div>
                  <div className="cr-meta">
                    {item.source} · {domain(item.url)}
                    {topicNames && ` · ${topicNames[item.topic] ?? item.topic}`} · {item.pending_since.slice(5, 10)}
                  </div>
                  {on && (
                    <div className="cr-open">
                      <p className="cr-summary">{item.summary}</p>
                      <div className="cr-actions">
                        {canDecide &&
                          (status === "waiting" ? (
                            <>
                              <button
                                type="button"
                                className="inbox-button cr-approve"
                                disabled={busy}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  onDecide(item, "approve");
                                }}
                              >
                                <kbd>a</kbd> approve
                              </button>
                              <button
                                type="button"
                                className="inbox-button cr-reject"
                                disabled={busy}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  onDecide(item, "reject");
                                }}
                              >
                                <kbd>r</kbd> reject
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              className="inbox-button"
                              disabled={busy}
                              onClick={(event) => {
                                event.stopPropagation();
                                onDecide(item, null);
                              }}
                            >
                              <kbd>u</kbd> undo
                            </button>
                          ))}
                        <a
                          className="inbox-button"
                          href={item.url}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(event) => event.stopPropagation()}
                        >
                          <kbd>o</kbd> open ↗
                        </a>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <p className="cr-keys">
        <kbd>j</kbd>/<kbd>k</kbd> move
        {canDecide && (
          <>
            {" "}· <kbd>a</kbd> approve · <kbd>r</kbd> reject · <kbd>u</kbd> undo
          </>
        )}{" "}
        · <kbd>o</kbd> open
      </p>
    </section>
  );
}
```

- [ ] **Step 8: `components/ControlRoom.tsx` (part 1)**

```tsx
"use client";

import { useState } from "react";
import ControlPulse from "@/components/ControlPulse";
import QueuePane from "@/components/QueuePane";
import { useInbox } from "@/components/useInbox";
import { useJson } from "@/components/useJson";
import type { AgentConfig } from "@/lib/agent-config";
import { type AgentStatus, STATUS_URL, isAgentStatus } from "@/lib/agent-status";
import type { Decision } from "@/lib/inbox";
import { type PendingItem, type PendingQueue, PENDING_URL, isPendingQueue } from "@/lib/pending-queue";
import type { TopicFilter } from "@/lib/pipeline-stages";
import {
  type StatusFilter,
  nextSelection,
  resolveSelection,
  statusCounts,
  topicCounts,
  visibleItems,
} from "@/lib/queue-view";

const acceptStatus = (value: unknown): AgentStatus | null => (isAgentStatus(value) ? value : null);
const acceptQueue = (value: unknown): PendingQueue | null => (isPendingQueue(value) ? value : null);

function TopicChips({
  config,
  counts,
  topic,
  onPick,
}: {
  config: AgentConfig;
  counts: Record<string, number>;
  topic: TopicFilter;
  onPick: (topic: TopicFilter) => void;
}) {
  const options: [TopicFilter, string][] = [["all", "all"], ...config.topics.map((t): [TopicFilter, string] => [t.slug, t.name])];
  return (
    <div className="cr-chips cr-topics" role="group" aria-label="Topic">
      {options.map(([key, label]) => (
        <button key={key} type="button" className="cr-chip" aria-pressed={topic === key} onClick={() => onPick(key)}>
          {label} <span className="cr-chip-n">{counts[key] ?? 0}</span>
        </button>
      ))}
    </div>
  );
}

/**
 * Tony Scraponi's control room (/researcher/queue/). `config` is read at
 * build time from agent/ (lib/agent-config.ts); everything live —
 * status.json, pending.json, the inbox decisions — is fetched here, each
 * on its own, so one failing source never blanks the rest.
 */
export default function ControlRoom({ config }: { config: AgentConfig }) {
  const status = useJson(STATUS_URL, acceptStatus);
  const pending = useJson(PENDING_URL, acceptQueue);
  const inbox = useInbox(pending.data, pending.loadedAt);

  const [topic, setTopic] = useState<TopicFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("waiting");
  const [selectedUrl, setSelectedUrl] = useState<string | null>(null);

  const items = pending.data?.items ?? [];
  const rows = visibleItems(items, inbox.decisions, topic, statusFilter);
  const topicNames = topic === "all" ? Object.fromEntries(config.topics.map((t) => [t.slug, t.name])) : null;

  function decide(item: PendingItem, decision: Decision | null) {
    setSelectedUrl(nextSelection(rows, item.url));
    void inbox.decide(item, decision);
  }

  return (
    <section className="cr">
      <div className="wrap cr-wrap">
        <ControlPulse
          status={status.data}
          failed={status.failed}
          schedule={config.schedule}
          owner={{ signedIn: inbox.signedIn, error: inbox.error, onSignIn: inbox.signIn, onSignOut: inbox.signOut }}
        />
        <TopicChips
          config={config}
          counts={topicCounts(items, config.topics.map((t) => t.slug))}
          topic={topic}
          onPick={setTopic}
        />
        <div className="cr-grid">
          <QueuePane
            rows={rows}
            counts={statusCounts(items, inbox.decisions, topic)}
            statusFilter={statusFilter}
            onStatusFilter={setStatusFilter}
            selected={resolveSelection(rows, selectedUrl)}
            onSelect={setSelectedUrl}
            decisions={inbox.decisions}
            topicNames={topicNames}
            canDecide={inbox.canWrite}
            busy={inbox.busy}
            loaded={pending.data !== null}
            failed={pending.failed}
            onDecide={decide}
          />
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 9: The page; delete `PendingQueue.tsx`**

Replace `app/researcher/queue/page.tsx`:

```tsx
import type { Metadata } from "next";
import ControlRoom from "@/components/ControlRoom";
import { loadAgentConfig } from "@/lib/agent-config";

const description =
  "The research agent's control room: its config, its last run, the moderation queue and two weeks of outcomes.";

export const metadata: Metadata = {
  title: "Tony Scraponi",
  description,
  openGraph: { title: "Tony Scraponi", description, type: "website" },
};

export default function QueuePage() {
  // Read from this repo's agent/ at build time (static export: once).
  return <ControlRoom config={loadAgentConfig()} />;
}
```

Run: `git rm components/PendingQueue.tsx`

- [ ] **Step 10: CSS — shell, pulse, chips, queue**

In `app/globals.css`, in the "Inbox (researcher/queue)" section, delete these rules (their components are gone): `.inbox-actions { … }`, `.inbox-owner { … }`, and change the shared rule

```css
.inbox-note,
.inbox-error {
  margin: 0 0 8px;
  line-height: 1.8;
  text-transform: lowercase;
}
```

to

```css
.inbox-error {
  margin: 0 0 8px;
  line-height: 1.8;
  text-transform: lowercase;
}
```

Then append at the end of the file:

```css
/* --- Control room (/researcher/queue/) ---------------------------
   components/ControlRoom.tsx — Tony Scraponi's one-screen view of the
   research agent: the pulse, the pipeline rail, topic chips, then the
   queue beside the config spine and outcomes. The home cards' surface
   (--card-bg, blur, no borders), mono 10px meta; lime and red only where
   they already mean kept/approved and dropped/rejected/stale. From 900px
   wide the page fits the window and the panes scroll inside; below
   ~690px of height it scrolls rather than cut anything off. */

/* The footer's 96px of bottom air would push the page past one screen. */
body:has(.cr) footer {
  padding-bottom: 14px;
}

.cr {
  --cr-chrome: 130px; /* the site header (~62px) + this slim footer (~64px) */
}

.cr-wrap {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding-top: 18px;
  padding-bottom: 18px;
}

.cr b,
.cr-value {
  font-weight: inherit;
  color: var(--text-strong);
}

.cr-label,
.cr-k {
  margin: 0;
  font-family: var(--font-mono);
  font-size: var(--fs-2xs);
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--muted);
}

.cr kbd {
  font-family: var(--font-mono);
  font-size: 9px;
  color: var(--text);
  border: 1px solid var(--agent-border);
  border-radius: 3px;
  padding: 0 4px;
  margin-right: 2px;
}

/* Pulse: the Tony teaser's strip, with a slow lime comet. */
.cr-pulse {
  position: relative;
  display: grid;
  grid-template-columns: auto auto minmax(0, 1fr) auto;
  align-items: center;
  column-gap: 16px;
  padding: 10px 16px;
  background: var(--card-bg);
  -webkit-backdrop-filter: blur(10px);
  backdrop-filter: blur(10px);
  font-family: var(--font-mono);
  font-size: var(--fs-2xs);
  line-height: 1.7;
  --comet-duration: 60s;
  --comet-color: var(--agent-lime);
}

.cr-pulse .card-comet-run {
  animation-iteration-count: infinite;
}

.cr-pulse-id {
  display: flex;
  flex-direction: column;
  margin: 0;
  line-height: 1.4;
  text-transform: lowercase;
}

.cr-pulse-line {
  margin: 0;
  text-transform: lowercase;
}

.cr-sep {
  margin: 0 7px;
  color: color-mix(in srgb, var(--muted) 50%, transparent);
}

.owner-slot {
  text-align: right;
}

.owner-slot .inbox-error {
  margin: 4px 0 0;
}

/* Chips: topic (filters everything) and status (the queue). */
.cr-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 16px;
}

.cr-chip {
  font-family: var(--font-mono);
  font-size: var(--fs-2xs);
  letter-spacing: 0.05em;
  text-transform: lowercase;
  color: var(--muted);
  background: none;
  border: 0;
  padding: 2px 0;
  cursor: pointer;
}

.cr-chip:hover,
.cr-chip:focus-visible {
  color: var(--text);
}

.cr-chip:focus-visible {
  outline: 1px solid var(--muted);
  outline-offset: 4px;
}

.cr-chip[aria-pressed="true"] {
  color: var(--text-strong);
  text-decoration: underline;
  text-underline-offset: 0.35em;
  text-decoration-thickness: 1px;
}

.cr-chip-n {
  color: var(--muted);
}

/* Panes */
.cr-grid {
  display: grid;
  grid-template-columns: minmax(0, 5fr) minmax(0, 6fr);
  gap: 20px;
}

.cr-pane {
  display: flex;
  flex-direction: column;
  min-height: 0;
  padding-top: 10px;
  background: var(--card-bg);
  -webkit-backdrop-filter: blur(10px);
  backdrop-filter: blur(10px);
  font-family: var(--font-mono);
  font-size: var(--fs-2xs);
  line-height: 1.7;
}

.cr-pane-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  padding: 0 16px 8px;
}

.cr-scroll {
  flex: 1;
  min-height: 0;
  padding: 0 16px 12px;
  scrollbar-width: thin;
  scrollbar-color: #3a3a3a transparent;
}

.cr-empty {
  margin: 0;
  padding: 4px 0;
}

/* Queue */
.cr-rows {
  list-style: none;
  margin: 0 -16px;
  padding: 0;
}

.cr-row {
  padding: 6px 16px;
  border-left: 1px solid transparent;
  cursor: pointer;
}

.cr-row:hover {
  background: #ffffff05;
}

.cr-row[data-selected="true"] {
  background: #ffffff0a;
  border-left-color: var(--agent-lime);
}

.cr-row-line {
  display: flex;
  align-items: baseline;
  gap: 10px;
}

.cr-score {
  flex: none;
  width: 14px;
  color: var(--muted);
}

.cr-score.is-high {
  color: var(--agent-lime);
}

.cr-title {
  flex: 1;
  min-width: 0;
  font-family: var(--font-sans);
  font-size: var(--fs-xs);
  color: var(--text-strong);
  text-transform: lowercase;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.cr-row[data-selected="true"] .cr-title {
  white-space: normal;
}

.cr-row[data-status="approved"] .cr-title,
.cr-row[data-status="rejected"] .cr-title {
  color: var(--muted);
}

.cr-decision {
  flex: none;
}

.cr-meta,
.cr-open {
  padding-left: 24px;
}

.cr-meta {
  color: var(--muted);
  text-transform: lowercase;
}

.cr-summary {
  margin: 4px 0 6px;
  font-family: var(--font-sans);
  font-size: var(--fs-xs);
  line-height: 1.6;
  text-transform: lowercase;
}

.cr-actions {
  display: flex;
  gap: 18px;
}

.cr-actions .inbox-button {
  padding: 2px 0;
}

.cr-approve:hover:not(:disabled) {
  color: var(--agent-lime);
}

.cr-reject:hover:not(:disabled) {
  color: var(--agent-red);
}

.cr-keys {
  margin: 0;
  padding: 6px 16px 8px;
  color: var(--muted);
  border-top: 1px solid #ffffff0d;
}

@media (min-width: 900px) {
  .cr {
    height: calc(100svh - var(--cr-chrome));
    min-height: 560px;
  }

  .cr-wrap {
    height: 100%;
  }

  .cr-grid {
    flex: 1;
    min-height: 0;
  }

  .cr-scroll {
    overflow-y: auto;
  }
}

/* Narrow: the page scrolls, moderation first. The grid's panes become
   items of .cr-wrap (display: contents) so `order` can interleave them
   with the rail. */
@media (max-width: 899px) {
  .cr-pulse {
    grid-template-columns: auto minmax(0, 1fr) auto;
    row-gap: 6px;
  }

  .cr-pulse-line {
    grid-column: 1 / -1;
    grid-row: 2;
  }

  .cr-grid {
    display: contents;
  }

  .cr-pulse {
    order: 1;
  }

  .cr-topics {
    order: 2;
  }

  .cr-queue {
    order: 3;
  }

  .cr-queue .cr-scroll {
    max-height: 70svh;
    overflow-y: auto;
  }
}
```

- [ ] **Step 11: Types, lint, tests, build**

Run: `npx tsc --noEmit && npx eslint app components lib && npm test`
Expected: no errors; all tests pass.
Run: `npm run build`
Expected: build succeeds; `out/researcher/queue/index.html` exists. (GitHub grid / Telegram warnings are fine.)

- [ ] **Step 12: Look at it**

Run (one terminal, leave running): `npx serve out -l 3100`
Run: `node --experimental-websocket .superpowers/sdd/2026-10-06-control-room/cdp.mjs http://localhost:3100/researcher/queue/ .superpowers/sdd/2026-10-06-control-room/t4-1440.png 1440 900`
Expected: prints `page {"scrollHeight":900,…}` (scrollHeight equal to innerHeight — no page scroll). Open the PNG: pulse with spy, live, last run, next slot and countdown, streak, sparkline, digest, `OWNER`; topic chips with counts; the queue pane on the left with status chips (`waiting` underlined), rows sorted by score, the first row unfolded with its summary and `O OPEN ↗` only (visitor), key hints `j/k move · o open`.

Create `.superpowers/sdd/2026-10-06-control-room/keys.js`:

```js
(async () => {
  // Wait after each key: the handler is re-bound on every render, so two
  // synchronous presses would both start from the same selection.
  const wait = () => new Promise((r) => setTimeout(r, 300));
  const press = async (key) => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key }));
    await wait();
  };
  const sel = () => document.querySelector('.cr-row[data-selected="true"] .cr-title')?.textContent;
  const first = sel();
  await press("j");
  await press("j");
  const third = sel();
  await press("k");
  return { first, third, back: sel(), rows: document.querySelectorAll(".cr-row").length };
})()
```

Run: `node --experimental-websocket .superpowers/sdd/2026-10-06-control-room/cdp.mjs http://localhost:3100/researcher/queue/ .superpowers/sdd/2026-10-06-control-room/t4-keys.png 1440 900 .superpowers/sdd/2026-10-06-control-room/keys.js`
Expected: `first`, `third` and `back` are three titles with `back` being the second row's title (not `first`, not `third`); `rows` equals the `waiting` count.

Run: `node --experimental-websocket .superpowers/sdd/2026-10-06-control-room/cdp.mjs http://localhost:3100/researcher/queue/ .superpowers/sdd/2026-10-06-control-room/t4-375.png 375 812`
Expected: `scrollWidth` ≤ `innerWidth` (no horizontal scroll); the PNG shows pulse (two lines), topic chips, then the queue.

Stop the server (Ctrl+C).

- [ ] **Step 13: PROGRESS and commit**

`PROGRESS.md`, sub-project #8 bullet: `Done: Tasks 1–4 (config loader, rail numbers, outcomes and queue view, the page with pulse, topic chips and the moderation queue). Next: Task 5 (rail, config spine, outcomes).`

```bash
git add components/useJson.ts components/useInbox.ts components/InboxControls.tsx components/TonyMark.tsx components/ControlPulse.tsx components/QueuePane.tsx components/ControlRoom.tsx components/AppsStrip.tsx app/researcher/queue/page.tsx app/globals.css PROGRESS.md
git commit -m "Replace the queue page with the control room's pulse and moderation queue" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

(`git rm` in Step 9 already staged the deletion of `components/PendingQueue.tsx`.)

---

### Task 5: Control room page, part 2 — rail, config spine, outcomes

**Files:**
- Create: `components/PipelineRail.tsx`, `components/ConfigSpine.tsx`, `components/Outcomes.tsx`
- Modify: `components/ControlRoom.tsx` (full replacement below), `app/globals.css`, `PROGRESS.md`

**Interfaces:**
- Consumes: Task 1 types; `STAGE_KEYS`, `StageKey`, `StageNumbers`, `TopicFilter`, `buildStages`, `topicSlugs` (Task 2); `STATE_URL`, `parseAgentState`, `buildOutcomes`, `topicVerdicts`, `Outcomes` (Task 3); Task 4's components and CSS classes.
- Produces: `PipelineRail({ stages, active, onPick, titles })`, `ConfigSpine({ config, topic, active, onPick, verdicts })` and its exported `ConfigValue`, `Outcomes({ data, failed, threshold })`.

- [ ] **Step 1: `components/PipelineRail.tsx`**

```tsx
import type { StageKey, StageNumbers } from "@/lib/pipeline-stages";

/**
 * The nine stages of the last run, left to right: each a number and a
 * muted line of what it removed. A stage that failed this run turns red.
 * Clicking one highlights its row in the config spine.
 */
export default function PipelineRail({
  stages,
  active,
  onPick,
  titles,
}: {
  stages: StageNumbers[];
  active: StageKey | null;
  onPick: (key: StageKey) => void;
  titles: Partial<Record<StageKey, string>>;
}) {
  return (
    <ol className="cr-rail" aria-label="Pipeline, last run">
      {stages.map((stage) => (
        <li key={stage.key}>
          <button
            type="button"
            className="cr-node"
            aria-pressed={active === stage.key}
            data-failed={stage.failed !== null}
            title={titles[stage.key]}
            onClick={() => onPick(stage.key)}
          >
            <span className="cr-label">{stage.key}</span>
            <span className="cr-node-n">{stage.value}</span>
            <span className="cr-node-line">{stage.failed !== null ? `failed: ${stage.failed}` : stage.line}</span>
          </button>
        </li>
      ))}
      <li className="card-comet" aria-hidden="true">
        <span className="card-comet-run" />
      </li>
    </ol>
  );
}
```

- [ ] **Step 2: `components/ConfigSpine.tsx`**

```tsx
"use client";

import { type ReactNode, useEffect, useState } from "react";
import type { AgentConfig, TopicConfigView } from "@/lib/agent-config";
import { STAGE_KEYS, type StageKey, type TopicFilter } from "@/lib/pipeline-stages";

/**
 * One config value on the spine. Every value goes through here so a later
 * editing step (settings in a repo the agent only reads, like the inbox)
 * can turn them into inputs in one place.
 */
export function ConfigValue({ children }: { children: ReactNode }) {
  return <b className="cr-value">{children}</b>;
}

const V = ConfigValue;

function Tags({ items, max }: { items: string[]; max?: number }) {
  const [open, setOpen] = useState(false);
  const shown = open || max === undefined ? items : items.slice(0, max);
  return (
    <span className="cr-tags">
      {shown.map((item) => (
        <span key={item} className="cr-tag">
          {item}
        </span>
      ))}
      {max !== undefined && items.length > max && (
        <button
          type="button"
          className="cr-more"
          onClick={(event) => {
            event.stopPropagation();
            setOpen(!open);
          }}
        >
          {open ? "less" : `+${items.length - max}`}
        </button>
      )}
    </span>
  );
}

/** "30" when the topics agree, "50–100" when they don't. */
function spread(values: number[]): string {
  if (values.length === 0) return "—";
  const low = Math.min(...values);
  const high = Math.max(...values);
  return low === high ? String(low) : `${low}–${high}`;
}

function Collect({ topic }: { topic: TopicConfigView }) {
  return (
    <>
      {topic.hackerNews ? (
        <>
          hn: <V>{topic.keywords.length}</V> title keywords, ≥<V>{topic.hackerNews.minPoints}</V> points
        </>
      ) : (
        <>hn: off</>
      )}
      {" · "}
      {topic.github ? (
        <>
          github: <V>{topic.github.topics.length}</V> topics, ≥<V>{topic.github.minStars}</V>★
        </>
      ) : (
        <>github: off</>
      )}
    </>
  );
}

interface Row {
  params: ReactNode;
  detail?: ReactNode;
}

function rowsFor(
  config: AgentConfig,
  one: TopicConfigView | null,
  verdicts: { count: number; rubric: string | null } | null,
): Record<StageKey, Row> {
  const scope = one ? [one] : config.topics;
  const growth = scope.filter((t) => t.attention.enabled);
  return {
    collect: {
      params: one ? (
        <Collect topic={one} />
      ) : (
        <>
          hn title search, ≥<V>{spread(scope.flatMap((t) => (t.hackerNews ? [t.hackerNews.minPoints] : [])))}</V> points ·
          github topic search, ≥<V>{spread(scope.flatMap((t) => (t.github ? [t.github.minStars] : [])))}</V>★ · per topic
        </>
      ),
      detail: one ? (
        <>
          <div className="cr-detail-row">
            <span className="cr-k">hn keywords</span>
            <Tags items={one.keywords} max={8} />
          </div>
          {one.github && (
            <div className="cr-detail-row">
              <span className="cr-k">github topics</span>
              <Tags items={one.github.topics} />
            </div>
          )}
        </>
      ) : undefined,
    },
    window: {
      params: (
        <>
          published in the last <V>{spread(scope.map((t) => t.maxAgeDays))}</V> days
        </>
      ),
    },
    dedupe: { params: <>already sent, queued, rejected or expired · the same url twice in a run</> },
    cache: {
      params: (
        <>
          one verdict per url × topic
          {one && verdicts?.rubric && (
            <>
              {" "}· rubric <V>{verdicts.rubric}</V>
            </>
          )}
          {verdicts && (
            <>
              {" "}· <V>{verdicts.count}</V> cached
            </>
          )}
          {" · "}
          {/* 2× is rank_cache.is_valid's rule, fixed in code. */}
          {growth.length ? (
            <>
              re-score at <V>2×</V> and <V>+{spread(growth.map((t) => t.attention.minScoreGain))}</V> points/stars
            </>
          ) : (
            <>no re-score on growth</>
          )}
        </>
      ),
    },
    rank: {
      params: (
        <>
          <V>{config.llm.model}</V> · temperature <V>{config.llm.temperature}</V> · batches of <V>{config.llm.batchSize}</V> ·
          prompt v<V>{config.llm.promptVersion}</V> · pass ≥<V>{spread(scope.map((t) => t.minRelevance))}</V>
        </>
      ),
      detail: (
        <>
          <div className="cr-detail-row">
            <span className="cr-k">reader</span>
            <span className="cr-prose">{config.reader}</span>
          </div>
          <div className="cr-detail-row">
            <span className="cr-k">criteria</span>
            {one ? (
              <ul className="cr-criteria">
                {one.include.map((c) => (
                  <li key={`+${c}`} className="cr-include">
                    {c}
                  </li>
                ))}
                {one.exclude.map((c) => (
                  <li key={`-${c}`} className="cr-exclude">
                    {c}
                  </li>
                ))}
              </ul>
            ) : (
              <span className="agent-muted">pick a topic to see its include / exclude</span>
            )}
          </div>
        </>
      ),
    },
    cap: {
      params: (
        <>
          <V>{scope.map((t) => t.maxItemsPerDay).join(" + ")}</V> a day · rolling <V>{config.queueWindowHours}h</V> · the rest
          waits for a later run
        </>
      ),
    },
    queue: { params: <>held for your review</> },
    review: {
      params: (
        <>
          your decisions in <V>{config.inbox.repo}</V> · undecided expire after <V>{config.inbox.expireDays}d</V>
        </>
      ),
    },
    deliver: {
      params: (
        <>
          approved only · telegram <V>{config.delivery.channel}</V> · every <V>{config.delivery.cadenceHours}h</V>
        </>
      ),
    },
  };
}

/**
 * The agent's config, one row per rail stage on a vertical spine. With a
 * topic picked, collect unfolds its keywords and GitHub topics, and rank
 * its include/exclude criteria.
 */
export default function ConfigSpine({
  config,
  topic,
  active,
  onPick,
  verdicts,
}: {
  config: AgentConfig;
  topic: TopicFilter;
  active: StageKey | null;
  onPick: (key: StageKey) => void;
  verdicts: { count: number; rubric: string | null } | null;
}) {
  const one = topic === "all" ? null : (config.topics.find((t) => t.slug === topic) ?? null);
  const rows = rowsFor(config, one, verdicts);

  useEffect(() => {
    if (active) document.getElementById(`cr-stage-${active}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [active]);

  return (
    <ol className="cr-spine" aria-label="Config by stage">
      {STAGE_KEYS.map((key) => (
        <li key={key} id={`cr-stage-${key}`} className="cr-stage" data-active={active === key} onClick={() => onPick(key)}>
          <span className="cr-dot" aria-hidden="true" />
          <span className="cr-label">{key}</span>
          <span className="cr-params">{rows[key].params}</span>
          {rows[key].detail && <div className="cr-detail">{rows[key].detail}</div>}
        </li>
      ))}
    </ol>
  );
}
```

- [ ] **Step 3: `components/Outcomes.tsx`**

```tsx
import type { Outcomes as OutcomesData } from "@/lib/outcomes";

function Histogram({ counts, threshold }: { counts: number[]; threshold: number }) {
  const max = Math.max(1, ...counts);
  return (
    <div className="cr-hist" role="img" aria-label={`relevance 1 to 10: ${counts.join(", ")}`}>
      {counts.map((n, i) => (
        <div key={i} className="cr-bar" data-pass={i + 1 >= threshold}>
          <span className="cr-bar-n">{n || ""}</span>
          <span className="cr-bar-track">
            <span className="cr-bar-fill" style={{ height: `${(n / max) * 100}%` }} />
          </span>
          <span className="cr-bar-x">{i + 1}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * Two weeks of outcomes for the topics in view (agent/report.py, in the
 * browser): queued items split by what became of them, items scored per
 * day, and the relevance histogram with passing bars in lime.
 */
export default function Outcomes({
  data,
  failed,
  threshold,
}: {
  data: OutcomesData | null;
  failed: boolean;
  threshold: number;
}) {
  const today = data?.scoredPerDay.at(-1);
  const dayMax = Math.max(1, ...(data?.scoredPerDay.map((d) => d.count) ?? []));
  return (
    <div className="cr-outcomes">
      <p className="cr-label">Outcomes · 14 days</p>
      {failed ? (
        <p className="agent-unavailable">outcomes unavailable</p>
      ) : data ? (
        <div className="cr-out-grid">
          <div className="cr-out-nums">
            <p>
              <span className="cr-k">queued</span> <b>{data.queued}</b>
            </p>
            <p>
              <span className="inbox-approved">sent {data.sent}</span> ·{" "}
              <span className="inbox-rejected">rejected {data.rejected}</span> · expired {data.expired} · pending{" "}
              {data.pending}
            </p>
            <p>
              <span className="cr-k">scored / day</span>
              <span className="cr-days" aria-hidden="true">
                {data.scoredPerDay.map((d) => (
                  <span
                    key={d.day}
                    className="cr-day"
                    title={`${d.day}: ${d.count}`}
                    style={{ height: `${(d.count / dayMax) * 100}%` }}
                  />
                ))}
              </span>
              today <b>{today?.count ?? 0}</b>
            </p>
          </div>
          <Histogram counts={data.histogram} threshold={threshold} />
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 4: Replace `components/ControlRoom.tsx`**

```tsx
"use client";

import { useState } from "react";
import ConfigSpine from "@/components/ConfigSpine";
import ControlPulse from "@/components/ControlPulse";
import Outcomes from "@/components/Outcomes";
import PipelineRail from "@/components/PipelineRail";
import QueuePane from "@/components/QueuePane";
import { useInbox } from "@/components/useInbox";
import { useJson } from "@/components/useJson";
import type { AgentConfig } from "@/lib/agent-config";
import { type AgentStatus, STATUS_URL, isAgentStatus } from "@/lib/agent-status";
import type { Decision } from "@/lib/inbox";
import { STATE_URL, buildOutcomes, parseAgentState, topicVerdicts } from "@/lib/outcomes";
import { type PendingItem, type PendingQueue, PENDING_URL, isPendingQueue } from "@/lib/pending-queue";
import { type StageKey, type TopicFilter, buildStages, topicSlugs } from "@/lib/pipeline-stages";
import {
  type StatusFilter,
  nextSelection,
  resolveSelection,
  statusCounts,
  topicCounts,
  visibleItems,
} from "@/lib/queue-view";

const acceptStatus = (value: unknown): AgentStatus | null => (isAgentStatus(value) ? value : null);
const acceptQueue = (value: unknown): PendingQueue | null => (isPendingQueue(value) ? value : null);

function TopicChips({
  config,
  counts,
  topic,
  onPick,
}: {
  config: AgentConfig;
  counts: Record<string, number>;
  topic: TopicFilter;
  onPick: (topic: TopicFilter) => void;
}) {
  const options: [TopicFilter, string][] = [["all", "all"], ...config.topics.map((t): [TopicFilter, string] => [t.slug, t.name])];
  return (
    <div className="cr-chips cr-topics" role="group" aria-label="Topic">
      {options.map(([key, label]) => (
        <button key={key} type="button" className="cr-chip" aria-pressed={topic === key} onClick={() => onPick(key)}>
          {label} <span className="cr-chip-n">{counts[key] ?? 0}</span>
        </button>
      ))}
    </div>
  );
}

/**
 * Tony Scraponi's control room (/researcher/queue/). `config` is read at
 * build time from agent/ (lib/agent-config.ts); everything live —
 * status.json, pending.json, state.json, the inbox decisions — is fetched
 * here, each on its own, so one failing source never blanks the rest.
 * The topic chips filter the rail, the queue, the spine and the outcomes.
 */
export default function ControlRoom({ config }: { config: AgentConfig }) {
  const status = useJson(STATUS_URL, acceptStatus);
  const pending = useJson(PENDING_URL, acceptQueue);
  const state = useJson(STATE_URL, parseAgentState);
  const inbox = useInbox(pending.data, pending.loadedAt);

  const [topic, setTopic] = useState<TopicFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("waiting");
  const [selectedUrl, setSelectedUrl] = useState<string | null>(null);
  const [stage, setStage] = useState<StageKey | null>(null);

  const slugs = topicSlugs(config, topic);
  const items = pending.data?.items ?? [];
  const rows = visibleItems(items, inbox.decisions, topic, statusFilter);
  const topicNames = topic === "all" ? Object.fromEntries(config.topics.map((t) => [t.slug, t.name])) : null;
  const threshold = Math.min(...config.topics.filter((t) => slugs.includes(t.slug)).map((t) => t.minRelevance));
  const cadence = config.schedule.hourStep !== null ? `every ${config.schedule.hourStep} hours` : "once a day";

  function decide(item: PendingItem, decision: Decision | null) {
    setSelectedUrl(nextSelection(rows, item.url));
    void inbox.decide(item, decision);
  }

  return (
    <section className="cr">
      <div className="wrap cr-wrap">
        <ControlPulse
          status={status.data}
          failed={status.failed}
          schedule={config.schedule}
          owner={{ signedIn: inbox.signedIn, error: inbox.error, onSignIn: inbox.signIn, onSignOut: inbox.signOut }}
        />
        <PipelineRail
          stages={buildStages(config, { status: status.data, queue: pending.data, decisions: inbox.decisions }, topic)}
          active={stage}
          onPick={(key) => setStage((current) => (current === key ? null : key))}
          titles={{
            review: `approved items go out with the next digest; the agent picks up decisions at the start of its next run (${cadence})`,
          }}
        />
        <TopicChips
          config={config}
          counts={topicCounts(items, config.topics.map((t) => t.slug))}
          topic={topic}
          onPick={setTopic}
        />
        <div className="cr-grid">
          <QueuePane
            rows={rows}
            counts={statusCounts(items, inbox.decisions, topic)}
            statusFilter={statusFilter}
            onStatusFilter={setStatusFilter}
            selected={resolveSelection(rows, selectedUrl)}
            onSelect={setSelectedUrl}
            decisions={inbox.decisions}
            topicNames={topicNames}
            canDecide={inbox.canWrite}
            busy={inbox.busy}
            loaded={pending.data !== null}
            failed={pending.failed}
            onDecide={decide}
          />
          <section className="cr-pane cr-flow" aria-label="Config and outcomes">
            <header className="cr-pane-head">
              <span className="cr-label">Config</span>
              <span className="agent-muted">from main · a criteria change re-scores the topic</span>
            </header>
            <div className="cr-scroll">
              <ConfigSpine
                config={config}
                topic={topic}
                active={stage}
                onPick={setStage}
                verdicts={state.data ? topicVerdicts(state.data, slugs) : null}
              />
              <Outcomes
                data={state.data && state.loadedAt ? buildOutcomes(state.data, slugs, state.loadedAt) : null}
                failed={state.failed}
                threshold={threshold}
              />
            </div>
          </section>
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 5: CSS — rail, spine, outcomes**

Append to `app/globals.css`, after Task 4's control room rules:

```css
/* Rail: the last run's numbers per stage, a quick lime comet underneath. */
.cr-rail {
  position: relative;
  list-style: none;
  margin: 0;
  padding: 6px 4px;
  display: grid;
  grid-template-columns: repeat(9, minmax(0, 1fr));
  background: var(--card-bg);
  -webkit-backdrop-filter: blur(10px);
  backdrop-filter: blur(10px);
  font-family: var(--font-mono);
  font-size: var(--fs-2xs);
  line-height: 1.5;
  --comet-duration: 20s;
  --comet-color: var(--agent-lime);
}

.cr-rail .card-comet-run {
  animation-iteration-count: infinite;
}

.cr-rail li + li .cr-node {
  border-left: 1px solid #ffffff0f;
}

.cr-node {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  padding: 3px 8px;
  font: inherit;
  text-align: left;
  color: var(--text);
  background: none;
  border: 0; /* the divider comes from `.cr-rail li + li .cr-node`, which is more specific */
  cursor: pointer;
}

.cr-node:hover {
  background: #ffffff05;
}

.cr-node:focus-visible {
  outline: 1px solid var(--muted);
  outline-offset: -1px;
}

.cr-node[aria-pressed="true"] {
  background: #ffffff0a;
}

.cr-node[aria-pressed="true"] .cr-label {
  color: var(--agent-lime);
}

.cr-node[data-failed="true"] .cr-label,
.cr-node[data-failed="true"] .cr-node-line {
  color: var(--agent-red);
}

.cr-node-n {
  font-family: var(--font-sans);
  font-size: var(--fs-md);
  font-weight: var(--w-light);
  line-height: 1.3;
  color: var(--text-strong);
}

.cr-node-line {
  color: var(--muted);
  text-transform: lowercase;
}

/* Spine: one row per stage, a dot on a 1px line. */
.cr-spine {
  list-style: none;
  margin: 0 -16px;
  padding: 0;
}

.cr-stage {
  position: relative;
  display: grid;
  grid-template-columns: 9px 58px minmax(0, 1fr);
  column-gap: 12px;
  align-items: baseline;
  padding: 7px 16px;
  cursor: pointer;
}

.cr-stage::before {
  content: "";
  position: absolute;
  left: 20px;
  top: 0;
  bottom: 0;
  width: 1px;
  background: var(--agent-border);
}

.cr-stage:first-child::before {
  top: 14px;
}

.cr-stage:last-child::before {
  bottom: calc(100% - 14px);
}

.cr-stage:hover {
  background: #ffffff05;
}

.cr-stage[data-active="true"] {
  background: #ffffff0a;
}

.cr-dot {
  position: relative;
  align-self: start;
  width: 9px;
  height: 9px;
  margin-top: 5px;
  border: 1px solid var(--agent-lime);
  border-radius: 50%;
  background: var(--agent-bg);
}

.cr-stage[data-active="true"] .cr-dot {
  background: var(--agent-lime);
}

.cr-stage[data-active="true"] > .cr-label {
  color: var(--agent-lime);
}

.cr-params {
  text-transform: lowercase;
}

.cr-detail {
  grid-column: 3;
  margin-top: 2px;
}

.cr-detail-row {
  display: grid;
  grid-template-columns: 78px minmax(0, 1fr);
  column-gap: 10px;
  margin: 4px 0;
}

.cr-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 3px 5px;
}

.cr-tag {
  padding: 0 5px;
  border-radius: 3px;
  background: #ffffff0d;
}

.cr-more {
  font: inherit;
  color: var(--muted);
  background: none;
  border: 0;
  padding: 0 3px;
  cursor: pointer;
}

.cr-prose {
  color: var(--muted);
  text-transform: lowercase;
}

.cr-criteria {
  list-style: none;
  margin: 0;
  padding: 0;
  text-transform: lowercase;
}

.cr-include::before {
  content: "+ ";
  color: var(--agent-lime);
}

.cr-exclude {
  color: var(--muted);
}

.cr-exclude::before {
  content: "− ";
  color: var(--agent-red);
}

/* Outcomes, at the foot of the config pane. */
.cr-outcomes {
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid #ffffff0d;
  text-transform: lowercase;
}

.cr-outcomes .cr-label {
  margin-bottom: 6px;
}

.cr-out-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 16px;
  align-items: end;
}

.cr-out-nums p {
  margin: 0 0 2px;
}

.cr-days {
  display: inline-flex;
  align-items: flex-end;
  gap: 2px;
  height: 14px;
  margin: 0 6px;
  vertical-align: -2px;
}

.cr-day {
  width: 4px;
  min-height: 1px;
  background: color-mix(in srgb, var(--muted) 45%, transparent);
}

.cr-hist {
  display: flex;
  align-items: stretch;
  gap: 3px;
  height: 78px;
}

.cr-bar {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 16px;
}

.cr-bar-track {
  flex: 1;
  width: 100%;
  display: flex;
  align-items: flex-end;
}

.cr-bar-fill {
  width: 100%;
  min-height: 1px;
  background: color-mix(in srgb, var(--muted) 45%, transparent);
}

.cr-bar[data-pass="true"] .cr-bar-fill {
  background: var(--agent-lime);
}

.cr-bar-n,
.cr-bar-x {
  font-size: 9px;
  line-height: 1.5;
  color: var(--muted);
}

@media (max-width: 899px) {
  .cr-rail {
    order: 4;
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .cr-rail li:nth-child(3n + 1) .cr-node {
    border-left: 0;
  }

  .cr-flow {
    order: 5;
  }

  .cr-stage {
    grid-template-columns: 9px minmax(0, 1fr);
  }

  .cr-dot {
    grid-row: 1;
  }

  .cr-stage > .cr-label,
  .cr-params,
  .cr-detail {
    grid-column: 2;
  }

  .cr-detail-row,
  .cr-out-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
```

- [ ] **Step 6: Types, lint, tests, build**

Run: `npx tsc --noEmit && npx eslint app components lib && npm test`
Expected: no errors; tests pass.
Run: `npm run build`
Expected: succeeds.

- [ ] **Step 7: Look at it at three sizes and with a topic and a stage picked**

Run (leave running): `npx serve out -l 3100`

Create `.superpowers/sdd/2026-10-06-control-room/tooling.js`:

```js
(async () => {
  const chips = [...document.querySelectorAll(".cr-topics .cr-chip")];
  chips.find((c) => c.textContent.toLowerCase().startsWith("tooling")).click();
  await new Promise((r) => setTimeout(r, 300));
  document.querySelectorAll(".cr-node")[4].click(); // rank
  await new Promise((r) => setTimeout(r, 800));
  return {
    rank: document.querySelector('.cr-stage[data-active="true"] .cr-label')?.textContent,
    criteria: document.querySelectorAll(".cr-include, .cr-exclude").length,
    keywords: document.querySelectorAll(".cr-tag").length,
    rail: [...document.querySelectorAll(".cr-node")].map((n) => n.textContent),
  };
})()
```

Run:
- `node --experimental-websocket .superpowers/sdd/2026-10-06-control-room/cdp.mjs http://localhost:3100/researcher/queue/ .superpowers/sdd/2026-10-06-control-room/t5-1440.png 1440 900`
- `node --experimental-websocket .superpowers/sdd/2026-10-06-control-room/cdp.mjs http://localhost:3100/researcher/queue/ .superpowers/sdd/2026-10-06-control-room/t5-1280x720.png 1280 720`
- `node --experimental-websocket .superpowers/sdd/2026-10-06-control-room/cdp.mjs http://localhost:3100/researcher/queue/ .superpowers/sdd/2026-10-06-control-room/t5-tooling.png 1440 900 .superpowers/sdd/2026-10-06-control-room/tooling.js`
- `node --experimental-websocket .superpowers/sdd/2026-10-06-control-room/cdp.mjs http://localhost:3100/researcher/queue/ .superpowers/sdd/2026-10-06-control-room/t5-375.png 375 812`

Expected:
- 1440×900 and 1280×720: `scrollHeight` equals `innerHeight` (no page scroll). PNG: pulse, the rail with nine stages and numbers (collect/window/cache/cap/queue/review/deliver filled; dedupe and rank `—` until the agent change lands), topic chips, queue left, config spine right with outcomes (queued, sent/rejected/expired/pending, scored/day bars, histogram with lime bars from 6).
- tooling: `rank` is `"rank"`, `criteria` > 0, `keywords` ≥ 8 (8 keywords + the GitHub topics), the rail's numbers changed from the all-topics run. PNG shows the rank row highlighted with lime dot and label.
- 375×812: `scrollWidth` ≤ `innerWidth`; order pulse → chips → queue → rail (3×3) → config.

Stop the server.

Show Artem `t5-1440.png`, `t5-tooling.png` and `t5-375.png` (paths in the hand-off message); visual tweaks he asks for are made in this task before committing.

- [ ] **Step 8: PROGRESS and commit**

`PROGRESS.md`, sub-project #8 bullet: `Done: Tasks 1–5 (the full control room page). Next: Task 6 (status_export drops and failures).`

```bash
git add components/PipelineRail.tsx components/ConfigSpine.tsx components/Outcomes.tsx components/ControlRoom.tsx app/globals.css PROGRESS.md
git commit -m "Add the pipeline rail, config spine and outcomes to the control room" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Agent — drop reasons and failed stages in `status.json`

**Files:**
- Modify: `agent/status_export.py`
- Modify: `PROGRESS.md`
- Throwaway: `.superpowers/sdd/2026-10-06-control-room/task6-check.py`

**Interfaces:**
- Consumes: run events as written by `agent/events.py` (`stage`, `event`, `topic`, `source`, `reason`).
- Produces: `build_status(...)` output gains `"drops": {slug: {stage: {reason: int}}}` (every configured topic present, `{}` when nothing dropped) and `"failures": [{"stage": str, "topic": str | None, "source": str | None}]` — the shapes `lib/agent-status.ts` (Task 2) accepts.

- [ ] **Step 1: Write the check script (it must fail first)**

Create `.superpowers/sdd/2026-10-06-control-room/task6-check.py`:

```python
import json
from datetime import datetime, timezone

from agent.pending import PendingQueue
from agent.status_export import build_status

now = datetime(2026, 10, 6, 12, 0, tzinfo=timezone.utc)
ts = now.isoformat()


def ev(stage, event, **fields):
    return {"ts": ts, "stage": stage, "event": event, **fields}


events = [
    ev("inbox", "drop", topic="tooling", reason="rejected", title="r"),
    ev("inbox", "failed", detail={"error": "boom"}),
    *[ev("collect", "candidate", topic="tooling", source="hn", title=f"t{i}") for i in range(3)],
    ev("collect", "failed", topic="tooling", source="github_trending",
       detail={"error": "HTTPError https://api.github.com/search?q=secret"}),
    ev("date_guard", "drop", topic="tooling", reason="outside_window", title="old"),
    ev("dedupe", "drop", topic="tooling", reason="seen", title="s"),
    ev("dedupe", "drop", topic="tooling", reason="already_ranked", title="a"),
    ev("rank", "failed", topic="ai-engineering", detail={"error": "deepseek down"}),
    ev("collect", "failed", topic="retired", source="hacker_news", detail={"error": "x"}),
    ev("dedupe", "drop", topic="retired", reason="seen", title="gone"),
    ev("deliver", "failed", detail={"error": "telegram 500"}),
    ev("run", "complete", detail={"delivered": False, "pending_total": 0}),
]

status = build_status(
    events,
    {"tooling": "Tooling", "ai-engineering": "AI Engineering"},
    PendingQueue(last_email_at=None, items=[]),
    24,
    4,
    None,
    now,
)

assert status["drops"] == {
    "tooling": {
        "inbox": {"rejected": 1},
        "date_guard": {"outside_window": 1},
        "dedupe": {"seen": 1, "already_ranked": 1},
    },
    "ai-engineering": {},
}, status["drops"]
assert status["failures"] == [
    {"stage": "inbox", "topic": None, "source": None},
    {"stage": "collect", "topic": "tooling", "source": "github_trending"},
    {"stage": "rank", "topic": "ai-engineering", "source": None},
    {"stage": "deliver", "topic": None, "source": None},
], status["failures"]
dumped = json.dumps(status)
for secret in ("boom", "secret", "deepseek down", "telegram 500"):
    assert secret not in dumped, secret
# Unchanged behavior: the funnel and the streak.
assert status["funnel"]["tooling"] == {"collected": 3, "in_window": 2, "new": 0, "kept": 0}, status["funnel"]
assert status["streak"] == 1
print("task6 ok")
```

Run (worktree root): `py -3 - < .superpowers/sdd/2026-10-06-control-room/task6-check.py`
Expected: FAIL — `KeyError: 'drops'`.

- [ ] **Step 2: Implement in `agent/status_export.py`**

Replace the module docstring with:

```python
"""Builds agent/status.json -- the public aggregate the site's widget
fetches -- from a run's JSONL event log, the pending delivery queue, and the
previous status.json's run history.

Besides the funnel it carries, per topic, every drop counted by stage and
reason (`drops`), and which stages failed this run (`failures`) -- never
the error text, which can carry request URLs. The control room
(/researcher/queue/) reads both.

Deliberately never reads TopicConfig: this module's only entry point
accepts a plain dict[str, str] of slug -> display name, so topic source
config (keywords, subreddits, feed URLs, search queries) has no path into
the output. See docs/superpowers/specs/2026-08-15-agent-status-widget-design.md
§ Redaction."""
```

Replace the start of `build_status`'s body up to (not including) the `for slug, counts in funnel.items():` line with:

```python
    funnel: dict[str, dict[str, int]] = {
        slug: {"collected": 0, "in_window": 0, "new": 0, "kept": 0} for slug in topic_names
    }
    drops: dict[str, dict[str, dict[str, int]]] = {slug: {} for slug in topic_names}
    failures: list[dict[str, Any]] = []
    recent_events: list[dict[str, Any]] = []
    dropped_by_stage: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))

    for event in run_events:
        topic = event.get("topic")
        stage = event.get("stage")
        kind = event.get("event")

        if kind == "failed":
            # Which stage broke, never why: error text can carry request URLs.
            if topic is None or topic in funnel:
                failures.append({"stage": stage, "topic": topic, "source": event.get("source")})
            continue
        if topic not in funnel:
            continue

        if stage == "collect" and kind == "candidate":
            funnel[topic]["collected"] += 1
        elif kind == "drop":
            dropped_by_stage[topic][stage] += 1
            reasons = drops[topic].setdefault(stage, {})
            reason = event.get("reason", "")
            reasons[reason] = reasons.get(reason, 0) + 1
            recent_events.append(
                {
                    "ts": event["ts"],
                    "verdict": "drop",
                    "topic": topic,
                    "title": event.get("title", ""),
                    "reason": event.get("reason", ""),
                }
            )
        elif stage == "rank" and kind == "kept":
            funnel[topic]["kept"] += 1
            recent_events.append(
                {
                    "ts": event["ts"],
                    "verdict": "kept",
                    "source": event.get("source", ""),
                    "topic": topic,
                    "title": event.get("title", ""),
                    "score": event.get("score"),
                }
            )
```

In the returned dict, add after `"funnel": funnel,`:

```python
        "drops": drops,
        "failures": failures,
```

- [ ] **Step 3: Run the check**

Run: `py -3 - < .superpowers/sdd/2026-10-06-control-room/task6-check.py`
Expected: `task6 ok`.

- [ ] **Step 4: The site still accepts the new shape**

Run: `npm test`
Expected: pass (Task 2's `isAgentStatus` tests cover these keys).

- [ ] **Step 5: PROGRESS and commit**

`PROGRESS.md`, sub-project #8 bullet: `Done: Tasks 1–6 (page; status.json now carries drops and failures — the rail's breakdown appears after the first agent run with this code). Next: Task 7.`

```bash
git add agent/status_export.py PROGRESS.md
git commit -m "Export drop reasons and failed stages in status.json" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Teaser, link labels, docs, final check — then merge only on Artem's word

**Files:**
- Modify: `components/AppsStrip.tsx`, `app/globals.css` (teaser), `app/researcher/page.tsx`, `app/researcher/agent/page.tsx`
- Modify: `PROGRESS.md`

**Interfaces:**
- Consumes: everything above.
- Produces: the finished sub-project on `worktree-admin-panel`.

- [ ] **Step 1: The home teaser opens the control room**

In `components/AppsStrip.tsx`:
- add `import Link from "next/link";`
- delete `<span className="tony-eyebrow">coming soon</span>`
- replace the follow link

```tsx
            <a className="card-action tony-follow" href={`https://t.me/${TELEGRAM_CHANNEL}`}>
              Follow the build <span aria-hidden="true">↗</span>
            </a>
```

with

```tsx
            <p className="tony-links">
              <Link className="card-action" href="/researcher/queue/">
                Open <span aria-hidden="true">↗</span>
              </Link>
              <a className="card-action" href={`https://t.me/${TELEGRAM_CHANNEL}`}>
                Follow the build <span aria-hidden="true">↗</span>
              </a>
            </p>
```

- in the component's doc comment, replace `Left: the name, "coming soon" and what it is, then the features.` with `Left: the name and what it is, then the features.` and `and "follow the build ↗" to the Telegram channel.` with `then "open ↗" (the control room) and "follow the build ↗" (Telegram).`

In `app/globals.css`'s "Tony Scraponi teaser" section:
- in the section comment, replace `Left: the name, "coming soon" and what it is, then the features. Right: the agent's live numbers, then "follow the build ↗". A slow lime comet along the bottom says "in the works".` with `Left: the name and what it is, then the features. Right: the agent's live numbers, then "open ↗" (the control room) and "follow the build ↗". A slow lime comet along the bottom says the agent is live.`
- delete the `.tony-eyebrow { color: var(--agent-lime); }` rule
- replace the `.tony-follow { … }` rule with:

```css
.tony-links {
  display: flex;
  justify-content: flex-end;
  gap: 14px;
  margin: 0;
  text-transform: lowercase;
}

.tony-links .card-action {
  margin-left: 0;
}
```

- [ ] **Step 2: Link labels**

`app/researcher/page.tsx`: the link to `/researcher/queue/` reads `Tony Scraponi` instead of `Research Queue`.
`app/researcher/agent/page.tsx`: `See the full pending queue →` becomes `Open the control room →`.

- [ ] **Step 3: Full verification**

Run: `npx tsc --noEmit && npx eslint app components lib && npm test`
Expected: no errors; all tests pass.
Run: `npm run build`
Expected: succeeds.
Run (leave running): `npx serve out -l 3100`
Run:
- `node --experimental-websocket .superpowers/sdd/2026-10-06-control-room/cdp.mjs http://localhost:3100/ .superpowers/sdd/2026-10-06-control-room/t7-home.png 1440 900`
- `node --experimental-websocket .superpowers/sdd/2026-10-06-control-room/cdp.mjs http://localhost:3100/researcher/queue/ .superpowers/sdd/2026-10-06-control-room/t7-queue.png 1440 900`

Expected: home still fits one screen (`scrollHeight` = `innerHeight`); the teaser shows no "coming soon" and `open ↗ follow the build ↗` on the right; the queue page renders as in Task 5.

- [ ] **Step 4: Live owner-mode check (only with Artem's go-ahead)**

This writes to the real `hpnssflw/tony-inbox` (reject, then undo, one item). Ask Artem first; he may prefer to do it himself in his browser. Do it only when the next cron slot (`0 */4 * * *` UTC) is at least 20 minutes away, so no agent run reads the transient rejection.

Create the token snippet without committing it (it's under the git-ignored folder; delete it right after):

```bash
printf 'localStorage.setItem("tony-inbox-token", "%s"); location.reload(); "reload"' "$(gh auth token)" > .superpowers/sdd/2026-10-06-control-room/token.js
```

Create `.superpowers/sdd/2026-10-06-control-room/reject-undo.js`:

```js
(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  await wait(2000); // the owner snapshot (cdp.mjs already waited for the reload)
  const key = (k) => window.dispatchEvent(new KeyboardEvent("keydown", { key: k }));
  const title = () => document.querySelector('.cr-row[data-selected="true"] .cr-title')?.textContent;
  const owner = document.querySelector(".owner-slot")?.textContent;
  const target = title();
  key("r");
  await wait(5000);
  const chips = [...document.querySelectorAll(".cr-queue .cr-chip")];
  chips.find((c) => c.textContent.startsWith("rejected")).click();
  await wait(500);
  [...document.querySelectorAll(".cr-row")].find((r) => r.querySelector(".cr-title")?.textContent === target)?.click();
  await wait(300);
  const rejectedSelected = title();
  key("u");
  await wait(5000);
  return { owner, target, rejectedSelected, error: document.querySelector(".inbox-error")?.textContent ?? null };
})()
```

Run: `node --experimental-websocket .superpowers/sdd/2026-10-06-control-room/cdp.mjs http://localhost:3100/researcher/queue/ .superpowers/sdd/2026-10-06-control-room/t7-owner.png 1440 900 .superpowers/sdd/2026-10-06-control-room/token.js .superpowers/sdd/2026-10-06-control-room/reject-undo.js`
Then: `rm .superpowers/sdd/2026-10-06-control-room/token.js`
Run: `gh api repos/hpnssflw/tony-inbox/commits --jq '.[0:2][] | .commit.message'`
Expected: `owner` reads `sign out`; `rejectedSelected` equals `target`; `error` is null; the two newest commits are `undo: <title>` and `reject: <title>` for that item; `gh api repos/hpnssflw/tony-inbox/contents/decisions.json --jq .content | base64 -d` doesn't contain its URL.

Stop the server.

- [ ] **Step 5: PROGRESS — final state**

In `PROGRESS.md`, rewrite the sub-project #8 bullet as:

```markdown
- **Sub-project #8, Tony Scraponi control room: built, not merged.**
  `/researcher/queue/` is now a one-screen control room: pulse (live,
  last/next run from the workflow cron, streak, digest, owner sign-in),
  a rail of the last run's nine stages with drop reasons, topic chips,
  the moderation queue (status filters; j/k/o, owner a/r/u), the config
  spine read from `agent/` at build time (`lib/agent-config.ts` — a
  renamed agent constant fails the build on purpose), and 14 days of
  outcomes from `state.json`. `status.json` now carries `drops` and
  `failures` (`agent/status_export.py`); the rail's breakdown shows
  after the first agent run with that code. The home teaser links to
  it ("open ↗"). Spec:
  `docs/superpowers/specs/2026-10-06-tony-control-room-design.md`.
  Plan: `docs/superpowers/plans/2026-10-06-tony-control-room.md`.
  Branch `worktree-admin-panel` (worktree `.claude/worktrees/admin-panel`).
  Later: editing config from the page (a repo the agent only reads, like
  the inbox); `/researcher/agent/`'s countdown still uses
  `updated_at + cadence` — switch it to `lib/cron.ts`'s `nextRun`.
```

and in "How to resume", replace the sentence beginning `Also next: the agent admin redesign` with `Sub-project #8 (control room) is built on branch worktree-admin-panel and waits for Artem's go to merge and push; after the push, trigger agent-run.yml once so status.json carries drops and failures.`

- [ ] **Step 6: Commit**

```bash
git add components/AppsStrip.tsx app/globals.css app/researcher/page.tsx app/researcher/agent/page.tsx PROGRESS.md
git commit -m "Link the home teaser to the control room" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 7: Final whole-branch review**

Dispatch a reviewer (opus) over `git diff main...worktree-admin-panel` against the spec. Fix Critical/Important findings in one wave (one commit), re-run Step 3's checks, and record the outcome in `PROGRESS.md`'s #8 bullet.

- [ ] **Step 8: Hand off to Artem**

Report: what's on the branch, the screenshots (`t5-1440.png`, `t5-tooling.png`, `t5-375.png`, `t7-home.png`), the review outcome, and ask whether to merge and push. Do nothing further without his explicit yes.

- [ ] **Step 9: Merge and push — only after Artem says so**

From the worktree (don't operate on the main checkout):

```bash
git fetch origin
git merge origin/main            # resolve if needed; re-run Step 3's checks if anything merged
git push origin HEAD:main        # fast-forward only: the remote refuses anything else
```

If the push is refused, fetch, merge `origin/main` again and repeat; never force. Tell Artem to `git pull` in the main checkout (`C:\A\polozov`). After the push: confirm the deploy run succeeds (`gh run list --workflow deploy.yml --limit 1`), trigger `gh workflow run agent-run.yml`, wait for it, and check `git show origin/agent-data:agent/status.json` has `drops` and `failures`; then open the live `/researcher/queue/` and confirm the rail's dedupe and rank numbers are filled. Record all of it in `PROGRESS.md` and commit `Reconcile status docs with the control room shipping` on `main`, then push.
