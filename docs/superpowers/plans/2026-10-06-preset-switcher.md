# Preset Switcher (content engine D) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A bad field in `status.json` costs only itself; Tony becomes a self-contained preset that publishes `run-result.json`; the control room reads its config and rail from that file; an unlisted `/researcher/demo/<slug>/` section shows the demo presets in Russian with a moderation sandbox and the digest.

**Architecture:** The agent's `run-result.json` (schema 2) becomes the one contract between the engine and the site. `lib/run-result.ts` validates it; pure adapters (`lib/config-view.ts`, `lib/pipeline-stages.ts`, `lib/digest.ts`) turn it into what the components render; every interface string comes from `lib/control-room-text.ts` (en/ru). Tony's control room fetches the live file from `agent-data`; the demo pages read the committed demo goldens at build time.

**Tech Stack:** Python 3.12 + pytest (`agent/`), Next.js 16 App Router static export + React 19 + TypeScript + Vitest (site), GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-06-preset-switcher-design.md`.

## Global Constraints

- Work on branch `worktree-engine` in `C:\A\polozov\.claude\worktrees\engine`. Nothing reaches `main` until Task 7 (push 1) and Task 10 (push 2), each after its checks **and Artem's explicit go-ahead**.
- Never stage `.claude/settings.local.json`. Stage only the files a task lists.
- Commit messages end with the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Static export: a dynamic route needs `generateStaticParams` + `dynamicParams = false`; no Route Handlers, no Server Actions, no `redirects`/`rewrites`/`headers`.
- Before writing route or metadata code, read the relevant guide in `node_modules/next/dist/docs/` (CLAUDE.md: "This is NOT the Next.js you know"). `app/lab/[slug]/page.tsx` is this repo's working example of a static dynamic route (`params` is a `Promise`).
- No Tailwind, no CSS-in-JS, no component library; new styles go in `app/globals.css`. No new npm or pip dependencies; `yaml` leaves `package.json` in Task 5.
- `run-result.json` schema version is **2**; the site accepts 2 only.
- Tony's rubric hashes must not change: `ai-engineering 3472af8a46e1`, `tooling 02189e2467e9`, `web-products 080b24af813c` (pinned in `agent/tests/test_summarize.py`'s `PINNED_RUBRICS`).
- Golden files change only where the spec allows: `schema_version: 2` and no `legacy` key in every run-result golden; one added `Run result: <DATA>/run-result.json` line in Tony's `real/stdout.txt` and `dry/stdout.txt`. Anything else changing is a regression.
- Tony's control room renders in English exactly as today, apart from the config caption ("as of last run hh:mm utc" instead of "from main") and the deliver line ("1 sent in 1 message" when the last run sent).
- The demo section is unlisted: `robots: noindex, nofollow`, no link to it from any other page, no `/researcher/demo/` index page.
- Tests: `agent/venv/Scripts/python -m pytest agent/tests -q` (agent), `npm test` (site), `npm run build` (type check + static export).
- `<scratchpad>` in commands is this session's scratchpad directory; `<worktree>` is `C:/A/polozov/.claude/worktrees/engine`; `<port>` is the port `npm run serve` prints.
- Deviation from the spec, by design: the spec's "`lib/agent-config.ts` shrinks to `loadSchedule(root)`" becomes a rename to `lib/agent-schedule.ts` (Task 5) — the file no longer holds any config.

## File map

| File | Task | Responsibility |
|---|---|---|
| `lib/agent-status.ts` (+ test) | 1 | `parseAgentStatus`: cleaned copy or null |
| `components/AgentWidget.tsx`, `components/AppsStrip.tsx`, `lib/pending-queue.ts` | 1 | callers / comment |
| `agent/presets/tony.yaml` | 2 | Tony's whole config, self-contained |
| `agent/preset.py`, `agent/engine.py`, `agent/paths.py`, `agent/run_result.py` | 2 | `data` section replaces `legacy`; schema 2 |
| `agent/tests/test_preset.py`, `test_run_result.py`, `test_tony_characterization.py` + goldens | 2 | |
| `.github/workflows/agent-run.yml` | 2 | publish `run-result.json` |
| `lib/run-result.ts` (+ test) | 3 | schema-2 types, `parseRunResult` |
| `lib/control-room-text.ts` (+ test) | 4 | every interface string, en + ru |
| `lib/config-view.ts` (+ test) | 4 | run config → spine view |
| `lib/pipeline-stages.ts` (+ test) | 5 | rail from `stages` |
| `lib/agent-schedule.ts` (+ test; replaces `lib/agent-config.ts`) | 5 | the `cron:` line at build time |
| `components/TopicChips.tsx` (new), `PipelineRail.tsx`, `QueuePane.tsx`, `ConfigSpine.tsx`, `ControlRoom.tsx`, `app/researcher/queue/page.tsx` | 5 | control room on `run-result.json`, text from the dictionary |
| `agent/config.py`, `agent/defaults.yaml`, `agent/topics/`, `agent/tests/test_control_room_contract.py`, docstrings | 6 | legacy cleanup |
| `lib/digest.ts` (+ test) | 8 | digest blocks + Telegram HTML mirror |
| `lib/demo-presets.ts` (+ test), `app/researcher/demo/[slug]/page.tsx`, `components/DemoRoom.tsx`, `components/DigestPanel.tsx`, `app/globals.css` | 9 | demo section |
| `CLAUDE.md`, `PROGRESS.md`, `docs/tony-scraponi-roadmap.md`, `docs/agent-plan.md` | 5, 6, 7, 10 | docs |

---

## Push 1 — the guard, Tony's migration, the control room on `run-result.json`

### Task 1: A softer status guard (M2 + M1)

**Files:**
- Modify: `lib/agent-status.ts:62-115`
- Modify: `lib/agent-status.test.ts`
- Modify: `components/AgentWidget.tsx:5-14,54-56`, `components/AppsStrip.tsx:5,26`, `components/ControlRoom.tsx:13,25,64`, `lib/pending-queue.ts:35-39`

**Interfaces:**
- Produces: `parseAgentStatus(value: unknown): AgentStatus | null` (replaces `isAgentStatus`). Returns a cleaned copy: `drops`/`failures` omitted when malformed, `last_sent_at` null when unparseable, bad `run_history`/`recent_events` entries left out. Null when the core is malformed or `updated_at` isn't a date.

- [ ] **Step 1: Install the site's dependencies** (this worktree has no `node_modules`)

Run: `npm ci`
Expected: completes; `node_modules/next` exists.

- [ ] **Step 2: Write the failing tests**

In `lib/agent-status.test.ts`, change the import to `parseAgentStatus` (drop `isAgentStatus`) and replace both `describe("isAgentStatus…")` blocks with:

```ts
describe("parseAgentStatus", () => {
  const good = makeStatus({
    topics: [{ slug: "ai-agents", name: "AI Agents", collected: 3, kept: 1 }],
    funnel: { "ai-agents": { collected: 3, in_window: 3, new: 2, kept: 1 } },
  });
  const event = {
    ts: "2026-10-06T10:11:06.285593+00:00",
    verdict: "drop",
    topic: "ai-agents",
    title: "x",
    reason: "over_max_items",
  };

  it("returns a well-formed payload unchanged", () => {
    expect(parseAgentStatus(good)).toEqual(good);
  });

  it("rejects non-objects and nulls", () => {
    expect(parseAgentStatus(null)).toBeNull();
    expect(parseAgentStatus("nope")).toBeNull();
    expect(parseAgentStatus(undefined)).toBeNull();
  });

  it("rejects missing or wrong-typed core fields", () => {
    expect(parseAgentStatus({ ...good, run_history: undefined })).toBeNull();
    expect(parseAgentStatus({ ...good, topics: {} })).toBeNull();
    expect(parseAgentStatus({ ...good, funnel: null })).toBeNull();
    expect(parseAgentStatus({ ...good, streak: "3" })).toBeNull();
  });

  it("rejects a topic with no matching funnel entry", () => {
    expect(parseAgentStatus({ ...good, funnel: {} })).toBeNull();
  });

  it("rejects an updated_at that isn't a date (M1)", () => {
    expect(parseAgentStatus({ ...good, updated_at: "yesterday" })).toBeNull();
    expect(parseAgentStatus({ ...good, updated_at: 1 })).toBeNull();
  });

  it("turns an unparseable last_sent_at into null", () => {
    expect(parseAgentStatus({ ...good, last_sent_at: "soon" })?.last_sent_at).toBeNull();
    expect(parseAgentStatus({ ...good, last_sent_at: "2026-09-30T04:08:45.319706+00:00" })?.last_sent_at).toBe(
      "2026-09-30T04:08:45.319706+00:00",
    );
  });

  it("leaves out history and event entries with a bad date or shape", () => {
    const kept = { kept: 1, ts: "2026-10-06T10:10:42.237399+00:00" };
    const parsed = parseAgentStatus({
      ...good,
      run_history: [kept, { kept: 2, ts: "nope" }, { ts: "2026-10-06T10:00:00Z" }],
      recent_events: [event, { ...event, ts: "" }, { ...event, verdict: "maybe" }],
    });
    expect(parsed?.run_history).toEqual([kept]);
    expect(parsed?.recent_events).toEqual([event]);
  });
});

describe("parseAgentStatus — drops and failures", () => {
  const base = makeStatus({
    topics: [{ slug: "tooling", name: "Tooling", collected: 3, kept: 1 }],
    funnel: { tooling: { collected: 3, in_window: 3, new: 2, kept: 1 } },
  });

  it("accepts a payload without them (written before the agent change)", () => {
    expect(parseAgentStatus(base)).toEqual(base);
  });

  it("keeps well-formed drops and failures", () => {
    const full = {
      ...base,
      drops: { tooling: { dedupe: { seen: 2, already_ranked: 1 } } },
      failures: [
        { stage: "collect", topic: "tooling", source: "github_trending" },
        { stage: "deliver", topic: null, source: null },
      ],
    };
    expect(parseAgentStatus(full)).toEqual(full);
  });

  it("leaves out malformed drops but keeps the status (M2)", () => {
    for (const drops of [{ tooling: { dedupe: { seen: "2" } } }, [], { tooling: [] }]) {
      const parsed = parseAgentStatus({ ...base, drops });
      expect(parsed).not.toBeNull();
      expect(parsed).not.toHaveProperty("drops");
      expect(parsed?.streak).toBe(base.streak);
    }
  });

  it("leaves out malformed failures but keeps the status (M2)", () => {
    for (const failures of [{}, [{ stage: 1, topic: null, source: null }], [{ stage: "rank", topic: 3, source: null }]]) {
      const parsed = parseAgentStatus({ ...base, failures });
      expect(parsed).not.toBeNull();
      expect(parsed).not.toHaveProperty("failures");
    }
  });
});
```

- [ ] **Step 3: Run the tests to see them fail**

Run: `npx vitest run lib/agent-status.test.ts`
Expected: FAIL — `parseAgentStatus` is not exported.

- [ ] **Step 4: Implement `parseAgentStatus`**

In `lib/agent-status.ts`, keep `isRecord`, `isDropCounts`, `isRunFailure`; replace the `isAgentStatus` doc comment and function with:

```ts
function isDate(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function isRunHistoryEntry(value: unknown): value is RunHistoryEntry {
  return isRecord(value) && typeof value.kept === "number" && isDate(value.ts);
}

function isRecentEvent(value: unknown): value is RecentEvent {
  return (
    isRecord(value) &&
    isDate(value.ts) &&
    (value.verdict === "kept" || value.verdict === "drop") &&
    typeof value.topic === "string" &&
    typeof value.title === "string" &&
    (value.reason === undefined || typeof value.reason === "string") &&
    (value.score === undefined || typeof value.score === "number")
  );
}

/**
 * Validates a fetched `status.json` and returns a cleaned copy, or null.
 * Components read its fields during render, so a bad shape must stop
 * here. The core — the numbers, `updated_at`, topics with their funnel
 * entries, the two lists — rejects the whole status when malformed
 * ("agent status unavailable"). Everything else costs only itself (#8's
 * M2): malformed `drops`/`failures` are left out, an unparseable
 * `last_sent_at` becomes null, and list entries with a bad shape or date
 * are skipped. A date that doesn't parse never reaches toISOString() (M1).
 */
export function parseAgentStatus(value: unknown): AgentStatus | null {
  if (!isRecord(value)) return null;
  const { funnel, topics, run_history, recent_events } = value;
  if (
    typeof value.cadence_hours !== "number" ||
    typeof value.streak !== "number" ||
    typeof value.pending_count !== "number" ||
    !isDate(value.updated_at) ||
    !Array.isArray(topics) ||
    !Array.isArray(run_history) ||
    !Array.isArray(recent_events) ||
    !isRecord(funnel) ||
    !topics.every((t) => isRecord(t) && typeof t.slug === "string" && isRecord(funnel[t.slug]))
  ) {
    return null;
  }
  const status: AgentStatus = {
    ...(value as unknown as AgentStatus),
    last_sent_at: isDate(value.last_sent_at) ? value.last_sent_at : null,
    run_history: run_history.filter(isRunHistoryEntry),
    recent_events: recent_events.filter(isRecentEvent),
  };
  if (!isDropCounts(value.drops)) delete status.drops;
  if (!(Array.isArray(value.failures) && value.failures.every(isRunFailure))) delete status.failures;
  return status;
}
```

- [ ] **Step 5: Switch the callers**

`components/AgentWidget.tsx` — import `parseAgentStatus` instead of `isAgentStatus`, and in the fetch:

```ts
      .then((data: unknown) => {
        if (cancelled) return;
        const parsed = parseAgentStatus(data);
        if (parsed) setStatus(parsed);
        else setFailed(true);
      })
```

`components/AppsStrip.tsx` — import `parseAgentStatus` instead of `isAgentStatus`, and:

```ts
      .then((data: unknown) => {
        const parsed = parseAgentStatus(data);
        if (!cancelled && parsed) setStatus(parsed);
      })
```

`components/ControlRoom.tsx` — import `STATUS_URL, parseAgentStatus` (drop `type AgentStatus`, `isAgentStatus`), delete the `acceptStatus` constant, and use `useJson(STATUS_URL, parseAgentStatus)`.

`lib/pending-queue.ts` — in `isPendingQueue`'s comment, replace "Mirrors `lib/agent-status.ts`'s `isAgentStatus`" with "Like `lib/agent-status.ts`'s `parseAgentStatus`".

- [ ] **Step 6: Run the tests and the build**

Run: `npm test` then `npm run build`
Expected: all Vitest files pass; the build completes (no type errors; `GitHubGrid` may log that it was skipped without `GITHUB_TOKEN` — fine).

- [ ] **Step 7: Commit**

```bash
git add lib/agent-status.ts lib/agent-status.test.ts components/AgentWidget.tsx components/AppsStrip.tsx components/ControlRoom.tsx lib/pending-queue.ts
git commit -m "Let a bad status.json field cost only itself (#8 M1, M2)"
```

---

### Task 2: Tony becomes a self-contained preset and publishes `run-result.json`

**Files:**
- Modify: `agent/presets/tony.yaml` (rewrite)
- Modify: `agent/preset.py` (docstring, `Preset`, `load_preset`, delete `_load_legacy`, add `_data`)
- Modify: `agent/engine.py:22-25,173-179,275-276`, `agent/paths.py:1-17`, `agent/run_result.py:16,128-135`
- Modify: `agent/tests/test_preset.py`, `agent/tests/test_run_result.py:110`, `agent/tests/test_tony_characterization.py:1-4`
- Re-record: `agent/tests/fixtures/tony/golden/{real,dry}/{stdout.txt,run-result.json}`, `agent/tests/fixtures/{newsroom-demo,agro-demo}/golden/{run1,run2}.json`
- Modify: `.github/workflows/agent-run.yml`

`agent/defaults.yaml`, `agent/topics/` and `config.load_settings`/`load_topics` **stay** in this task: the site still parses them until Task 5, and the migration test below compares against them. Task 6 deletes them.

**Interfaces:**
- Produces: `Preset.status_json: bool`; `Preset.default_data_dir: Path | None` now from `data.default_dir`; `Preset.legacy` is gone. `run_result.SCHEMA_VERSION == 2`; `config.preset` is `{slug, name, language}`.

- [ ] **Step 1: Write the failing tests**

In `agent/tests/test_preset.py`:

1. Replace `test_tony_legacy_preset_reads_defaults_and_topics` with:

```python
def test_tony_preset_matches_the_legacy_files_it_replaces():
    """The preset-switcher plan (Task 2) moves Tony's settings out of
    agent/defaults.yaml + agent/topics/ into presets/tony.yaml. Task 6
    deletes those files, and this test with them."""
    preset = load_preset(AGENT / "presets" / "tony.yaml")
    settings = config.load_settings(AGENT / "defaults.yaml")
    assert (preset.slug, preset.name, preset.language, preset.status_json) == ("tony", "Tony Scraponi", "en", True)
    assert list(preset.topics) == config.load_topics(AGENT / "topics", AGENT / "defaults.yaml")
    assert preset.feeds == () and preset.telegram is None and preset.offline is None
    assert preset.reader == settings.ranking.reader
    assert (preset.llm.base_url, preset.llm.model, preset.llm.api_key_env) == (
        settings.llm.base_url,
        settings.llm.model,
        "DEEPSEEK_API_KEY",
    )
    assert (preset.approval.type, preset.approval.decisions_url, preset.approval.expire_days, preset.approval.token_env) == (
        "inbox",
        settings.inbox.decisions_url,
        settings.inbox.expire_days,
        "GITHUB_TOKEN",
    )
    assert (preset.delivery.type, preset.delivery.chat, preset.delivery.cadence_hours, preset.delivery.title) == (
        "telegram",
        settings.delivery.telegram_channel,
        settings.delivery.delivery_cadence_hours,
        "Research digest",
    )
    assert preset.delivery.bot_token_env == "TELEGRAM_BOT_TOKEN"
    assert preset.default_data_dir == AGENT
    assert preset.max_age_days == 10
```

2. In `test_self_contained_preset_loads_every_section`, change the first assertion to
`assert (preset.slug, preset.language, preset.status_json, preset.max_age_days) == ("demo", "ru", False, 2)`.

3. Add to the `test_invalid_presets_name_the_key` parametrize list:

```python
        (lambda r: r.update(data={"extra": 1}), "data.extra: unknown key"),
        (lambda r: r.update(data={"status_json": "yes"}), "data.status_json: expected true or false"),
        (lambda r: r.update(data={"default_dir": ""}), "data.default_dir: expected a non-empty string"),
        (lambda r: r.update(legacy={"defaults": "x", "topics": "y"}), "legacy: unknown key"),
```

4. Replace `test_legacy_preset_allows_nothing_else` with:

```python
def test_data_section_sets_the_default_dir_and_status_json(tmp_path):
    preset = load_preset(write_preset(tmp_path, dict(VALID, data={"default_dir": "../data", "status_json": True})))
    assert preset.default_data_dir == (tmp_path.parent / "data").resolve()
    assert preset.status_json is True
```

In `agent/tests/test_run_result.py`, change `== run_result.SCHEMA_VERSION == 1` to `== run_result.SCHEMA_VERSION == 2`.

- [ ] **Step 2: Run them to see them fail**

Run: `agent/venv/Scripts/python -m pytest agent/tests/test_preset.py agent/tests/test_run_result.py -q`
Expected: FAIL — `Preset` has no `status_json`; `data` is an unknown key; schema is 1.

- [ ] **Step 3: Rewrite `agent/presets/tony.yaml`**

Every text below is copied verbatim from `agent/defaults.yaml` and `agent/topics/{ai-engineering,tooling,web-products}.yaml` — the order of the topics is the order `config.load_topics` used (file names, sorted):

```yaml
# Tony Scraponi -- Artem's research digest and the engine's first live
# preset. The control room (/researcher/queue/) shows this config as the
# last run's run-result.json reports it.
preset:
  slug: tony
  name: Tony Scraponi
  language: en

# `python -m agent` without --data-dir keeps Tony's data in agent/, where
# agent-run.yml expects state.json, pending.json, status.json and
# run-result.json.
data:
  default_dir: ..
  status_json: true # the home teaser and the agent widget read it

# Applies to every topic unless the topic sets its own.
defaults:
  max_age_days: 10
  min_relevance: 6 # 1-10 scale
  max_items_per_day: 3 # per topic, rolling 23h window (see rank_cache.QUEUE_WINDOW); items over the cap stay eligible for later runs
  attention:
    enabled: true
    min_score_gain: 50

# keywords are matched against HN story titles only -- whole words, no
# typos -- so keep them short: a multi-word keyword needs every word in
# the title.
topics:
  - slug: ai-engineering
    name: AI Engineering
    description: >
      Agent and automated pipelines and harnesses, LLM assistants,
      self-hosted/private AI platform development, and LLM/inference
      optimization.
    max_items_per_day: 4
    include:
      - "building, running or evaluating LLM systems: agent harnesses, tool use, MCP, RAG, evals"
      - "inference and serving: self-hosted/local models, quantization, speed and cost"
      - major model, API or dev-platform releases that change what or how you build
    exclude:
      - AI policy, lawsuits, regulation, company drama, funding and business news
      - "coding agents and their add-ons (Claude Code, Codex, Cursor, plugins, skills) used while writing code (they belong to Tooling)"
      - consumer AI apps with no engineering substance
    keywords:
      [LLM, agent, agentic, MCP, RAG, inference, eval, benchmark, Claude, GPT, Gemini,
       DeepSeek, Qwen, Llama, llama.cpp, vLLM, Ollama, open-weight, fine-tuning, prompt,
       embeddings]
    sources:
      hacker_news: { min_points: 30 }
      github_trending: { min_stars: 100, topics: [llm, mcp, ai-agents, rag, llm-inference] }

  - slug: tooling
    name: Tooling
    description: >
      Tools developers use to build software: editors, CLIs, libraries,
      and AI coding tools.
    include:
      - "tools used while building software: editors and IDEs, CLIs, terminals, debuggers, build tools, package managers, version control, databases"
      - "AI tools used while writing code: coding agents, editor plugins, Claude Code skills and hooks"
      - new or notably improved open-source libraries and frameworks for building software
    exclude:
      - "components for building LLM systems: agent frameworks, inference servers, evals (they belong to AI Engineering)"
      - games, consumer apps, and utilities with no role in software development
      - nostalgia or legacy-systems threads, career and workplace discussion
    keywords:
      [CLI, terminal, editor, IDE, compiler, debugger, Git, GitHub, Rust, TypeScript, Python,
       Postgres, SQLite, database, Show HN, open source, library, framework, Neovim, VS Code,
       Claude Code, Codex, Cursor, Copilot, coding agent]
    sources:
      hacker_news: { min_points: 30 }
      github_trending:
        { min_stars: 50, topics: [developer-tools, cli, devtools, terminal, vscode-extension, neovim] }

  - slug: web-products
    name: Web Products
    description: >
      Product and web trends, securities & market data, data visualization,
      browser performance, web architecture, and SEO.
    include:
      - "the web platform and browsers: new APIs, standards, rendering and browser performance"
      - "frontend engineering and web architecture: frameworks, CSS, performance, SEO"
      - data visualization, and products built on market or financial data
      - "product and web trends: notable launches and how web products make money"
    exclude:
      - general tech-company news, earnings and stock moves with no product angle
      - AI model releases (AI Engineering) and developer tools (Tooling)
      - games and demos that merely run in a browser
    keywords:
      [browser, Chrome, Firefox, Safari, WebKit, WebAssembly, JavaScript, CSS, HTML, React,
       frontend, SEO, visualization, chart, dashboard, D3, stock, trading, fintech, Stripe, SaaS]
    sources:
      hacker_news: { min_points: 30 }
      github_trending: { min_stars: 50, topics: [data-visualization, web-performance, frontend, seo] }

ranking:
  # Who the digest is for. Part of every ranking prompt and of each
  # topic's rubric hash, so editing it re-scores cached verdicts.
  reader: >
    Artem, a full-stack engineer who builds web products and LLM agents
    and writes about both. He wants items he can learn from or act on
    as a builder, not general tech news.

llm:
  base_url: https://api.deepseek.com
  # deepseek-chat was discontinued 2026-07-24; deepseek-v4-flash is its
  # replacement (the non-thinking mode deepseek-chat used to point to).
  model: deepseek-v4-flash
  api_key_env: DEEPSEEK_API_KEY

approval:
  # Artem's approve/reject decisions (docs/superpowers/specs/2026-09-28-tony-scraponi-inbox-design.md).
  # Written only by the site's /researcher/queue/ owner mode; the agent only reads it.
  type: inbox
  decisions_url: https://api.github.com/repos/hpnssflw/tony-inbox/contents/decisions.json
  token_env: GITHUB_TOKEN
  expire_days: 7 # undecided items older than this leave the queue for good

delivery:
  type: telegram
  chat: "@hypnosisflow" # the channel's public handle; not a secret.
  bot_token_env: TELEGRAM_BOT_TOKEN
  title: Research digest
  cadence_hours: 24 # digest rollup cadence; collection/ranking run every 4h regardless
```

Before going on, diff the texts against the old files by eye: `git diff --no-index agent/topics/tooling.yaml agent/presets/tony.yaml` is noisy, so instead run Step 6's migration test — it compares every topic field.

- [ ] **Step 4: Replace `legacy` with the `data` section in `agent/preset.py`**

1. Module docstring — replace the two-form description with:

```python
"""Presets: one YAML file describes one client of the engine -- its
sources, topics, reader, LLM, approval and delivery -- validated before
any network call. Tony's is agent/presets/tony.yaml; its optional `data`
section gives it a default data dir (agent/) and status.json.

See docs/superpowers/specs/2026-10-06-content-engine-core-design.md and
docs/superpowers/specs/2026-10-06-preset-switcher-design.md."""
```

2. Delete `from agent import config` and the whole `# --- legacy (Tony) ---` section (`_load_legacy`).

3. In `Preset`, delete `legacy: bool` and replace the last field with:

```python
    status_json: bool  # data.status_json: also write status.json (Tony's site widgets)
    default_data_dir: Path | None  # data.default_dir, resolved; None: --data-dir is required
```

4. In `load_preset`, replace

```python
    if "legacy" in raw:
        return _load_legacy(path, raw)
    return _load_self_contained(path, raw)
```

with `return _load_self_contained(path, raw)`.

5. In `_load_self_contained`: add `"data"` to the optional keys — `_fields(raw, "", (...), ("sources", "offline", "data"))` — read it after `llm`: `data = _data(raw.get("data", {}), path.parent)`; in the `Preset(...)` call delete `legacy=False,` and replace `default_data_dir=None,` with

```python
        status_json=data["status_json"],
        default_data_dir=data["default_dir"],
```

6. Add after `_offline`:

```python
def _data(raw, base: Path) -> dict:
    section = _fields(raw, "data", (), ("default_dir", "status_json"))
    return {
        "default_dir": (base / _str(section, "default_dir", "data")).resolve() if "default_dir" in section else None,
        "status_json": _bool(section, "status_json", "data") if "status_json" in section else False,
    }
```

- [ ] **Step 5: `engine.py`, `paths.py`, `run_result.py`**

`agent/engine.py` — rename the constant and its comment:

```python
# agent-run.yml's collection cadence (every 4 h); status.json shows it on
# the site.
RUN_CADENCE_HOURS = 4
```

(and use `RUN_CADENCE_HOURS` in `_write_status`). Replace the end of `run_real` (`if preset.legacy: _write_status…` through the `else: print(f"Run result: …")`) with:

```python
    if preset.status_json:
        _write_status(preset, paths, writer, queue, now)
    print(f"Run recorded: {writer.path}")
    if preset.status_json:
        print(f"Status written: {paths.status}")
    print(f"Run result: {paths.result}")
```

In `run_dry`, replace `if not preset.legacy:\n        print(f"Run result: {paths.result}")` with `print(f"Run result: {paths.result}")`. Change `_write_status`'s docstring to `"""status.json: the public widget's aggregate, for presets with data.status_json."""`.

`agent/paths.py` — module docstring: `"""Where one preset's run data lives -- the --data-dir, or the preset's data.default_dir (Tony: agent/, where agent-run.yml expects it)."""`; `for_preset`'s docstring: `"""--data-dir if given; otherwise the preset's data.default_dir. A preset without one (the demos) needs --data-dir, so it can't overwrite Tony's local state."""`.

`agent/run_result.py` — `SCHEMA_VERSION = 2` with the comment `# 2: config.preset lost "legacy" (sub-project D)`, and in `_base_config` the preset entry becomes `"preset": {"slug": preset.slug, "name": preset.name, "language": preset.language},`.

- [ ] **Step 6: Run the preset and run-result tests**

Run: `agent/venv/Scripts/python -m pytest agent/tests/test_preset.py agent/tests/test_run_result.py agent/tests/test_summarize.py agent/tests/test_cli.py -q`
Expected: PASS. `test_tony_preset_matches_the_legacy_files_it_replaces` proves the move; `test_rubric_hash_of_the_real_topics_is_pinned` proves no re-scoring; `test_tony_is_the_default_preset_and_agent_the_default_data_dir` proves `python -m agent` still runs in `agent/`.

- [ ] **Step 7: Re-record the goldens and check the diff**

In `agent/tests/test_tony_characterization.py`'s module docstring, replace the last sentence with: `Re-recorded once, in sub-project D, for run-result schema 2 and the "Run result:" line; otherwise a golden that would change is a regression.`

```bash
rm agent/tests/fixtures/tony/golden/real/stdout.txt agent/tests/fixtures/tony/golden/real/run-result.json
rm agent/tests/fixtures/tony/golden/dry/stdout.txt agent/tests/fixtures/tony/golden/dry/run-result.json
rm agent/tests/fixtures/newsroom-demo/golden/run1.json agent/tests/fixtures/newsroom-demo/golden/run2.json
rm agent/tests/fixtures/agro-demo/golden/run1.json agent/tests/fixtures/agro-demo/golden/run2.json
agent/venv/Scripts/python -m pytest agent/tests -q   # records them; the recording tests fail by design
agent/venv/Scripts/python -m pytest agent/tests -q   # now passes
git diff -U0 agent/tests/fixtures | grep '^[-+][^-+]' | sort | uniq -c
```

Expected output of the last command — exactly these lines, nothing else:

```
      2 +Run result: <DATA>/run-result.json
      6 +  "schema_version": 2,
      6 -  "schema_version": 1,
      4 -      "legacy": false,
      2 -      "legacy": true,
```

(If `git diff` shows `^M`/CRLF noise, the goldens were rewritten with LF as before — check with `git diff --ignore-cr-at-eol` and keep LF, the files' existing endings.)

- [ ] **Step 8: Publish `run-result.json` from the workflow**

In `.github/workflows/agent-run.yml`, the step "Copy updated state back into the data checkout" gains a last line, tolerant because the engine survives a failed run-result write by design (a failing `cp` here would skip the push and re-deliver the sent items next run):

```yaml
          [ -f code/agent/run-result.json ] && cp code/agent/run-result.json data/agent/run-result.json || true
```

and the commit step's `git add` line becomes:

```yaml
          git add agent/state.json agent/pending.json agent/status.json
          [ -f agent/run-result.json ] && git add agent/run-result.json || true
```

- [ ] **Step 9: Run the whole agent suite**

Run: `agent/venv/Scripts/python -m pytest agent/tests -q`
Expected: all pass (131 + the new cases).

- [ ] **Step 10: Commit**

```bash
git add agent/presets/tony.yaml agent/preset.py agent/engine.py agent/paths.py agent/run_result.py agent/tests/test_preset.py agent/tests/test_run_result.py agent/tests/test_tony_characterization.py agent/tests/fixtures/tony/golden agent/tests/fixtures/newsroom-demo/golden agent/tests/fixtures/agro-demo/golden .github/workflows/agent-run.yml
git commit -m "Make Tony a self-contained preset and publish run-result.json (schema 2)"
```

---

### Task 3: `lib/run-result.ts` — the schema-2 contract

**Files:**
- Create: `lib/run-result.ts`
- Create: `lib/run-result.test.ts`

**Interfaces:**
- Consumes: `PendingItem` from `lib/pending-queue.ts`; the goldens Task 2 recorded.
- Produces (all exported): `RUN_RESULT_URL`, `RUN_RESULT_SCHEMA = 2`, `FEED_SCOPE = "*"`, `type Language = "en" | "ru"`, `ScopeCounts`, `StageResult`, `RunFailureRecord`, `FeedConfig`, `TopicResult`, `TelegramStub`, `ApprovalResult`, `DeliveryConfig`, `RunConfig`, `QueueItem`, `RunResult`, `parseRunResult(value: unknown): RunResult | null`.

- [ ] **Step 1: Write the failing tests**

`lib/run-result.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseRunResult } from "./run-result";

const FIXTURES = join(process.cwd(), "agent", "tests", "fixtures");

/** A golden as JSON, deep-copied so a test can break it. */
function golden(...parts: string[]): Record<string, any> {
  return JSON.parse(readFileSync(join(FIXTURES, ...parts), "utf8"));
}
const tony = () => golden("tony", "golden", "real", "run-result.json");
const newsroom = (run: 1 | 2) => golden("newsroom-demo", "golden", `run${run}.json`);
const agro = (run: 1 | 2) => golden("agro-demo", "golden", `run${run}.json`);

describe("parseRunResult on the goldens", () => {
  it("reads Tony's real run", () => {
    const result = parseRunResult(tony());
    expect(result?.preset).toEqual({ slug: "tony", name: "Tony Scraponi", language: "en" });
    expect(result?.run).toEqual({ id: "2026-10-06T1200Z", at: "2026-10-06T12:00:00+00:00", offline: false });
    expect(result?.config.topics.map((t) => t.slug)).toEqual(["ai-engineering", "tooling", "web-products"]);
    expect(result?.config.topics[0].sources).toEqual({
      hacker_news: { min_points: 30 },
      github_trending: { min_stars: 100, topics: ["llm", "mcp", "ai-agents", "rag", "llm-inference"] },
    });
    expect(result?.config.ranking.batch_size).toBe(40);
    expect(result?.config.approval).toEqual({
      type: "inbox",
      decisions_url: "https://api.github.com/repos/hpnssflw/tony-inbox/contents/decisions.json",
      expire_days: 7,
    });
    expect(result?.config.delivery).toEqual({ type: "telegram", title: "Research digest", cadence_hours: 24, chat: "@hypnosisflow" });
    expect(result?.config.sources).toEqual({ rss: [], telegram_public: null });
    expect(result?.stages).toHaveLength(11);
    expect(result?.failures).toEqual([]);
    expect(result?.queue.items).toHaveLength(9);
    expect(result?.delivery).toEqual({ sent_items: 1, messages: 1, last_sent_at: "2026-10-06T12:00:00+00:00" });
  });

  it("reads both demo presets' runs", () => {
    for (const raw of [newsroom(1), newsroom(2), agro(1), agro(2)]) {
      const result = parseRunResult(raw);
      expect(result?.preset.language).toBe("ru");
      expect(result?.config.approval.type).toBe("file");
      expect(result?.config.delivery.chat).toBeNull();
    }
    const news = parseRunResult(newsroom(1));
    expect(news?.config.sources.rss.map((f) => [f.id, f.full_text])).toEqual([
      ["agency", true],
      ["ministry", false],
      ["city", false],
    ]);
    expect(news?.config.sources.telegram_public?.channels.map((c) => c.handle)).toEqual([
      "example_agency",
      "example_region_gov",
      "example_city_chat",
    ]);
    expect(news?.stages.find((s) => s.stage === "rank")?.scopes["*"].assigned).toEqual({ economy: 3, incidents: 4, power: 4 });
    expect(news?.queue.items[0].decision).toBe("approve");
    expect(parseRunResult(agro(1))?.config.topics.find((t) => t.slug === "prices")?.rss.map((f) => f.id)).toEqual(["exchange"]);
  });
});

describe("parseRunResult rejects a bad core", () => {
  const cases: [string, (r: Record<string, any>) => void][] = [
    ["schema 1", (r) => (r.schema_version = 1)],
    ["no preset", (r) => delete r.preset],
    ["an unknown language", (r) => (r.preset.language = "de")],
    ["a run time that isn't a date", (r) => (r.run.at = "soon")],
    ["a topic without include", (r) => delete r.config.topics[0].include],
    ["a stage count that isn't a number", (r) => (r.stages[0].scopes.tooling.in = "3")],
    ["an unknown approval type", (r) => (r.config.approval.type = "buttons")],
    ["not an object", (r) => Object.keys(r).forEach((k) => delete r[k])],
  ];
  it.each(cases)("%s", (_, breakIt) => {
    const raw = tony();
    breakIt(raw);
    expect(parseRunResult(raw)).toBeNull();
  });

  it("null and strings", () => {
    expect(parseRunResult(null)).toBeNull();
    expect(parseRunResult("run")).toBeNull();
  });
});

describe("parseRunResult drops a bad optional part", () => {
  it("failures → []", () => {
    const raw = tony();
    raw.failures = {};
    expect(parseRunResult(raw)?.failures).toEqual([]);
  });

  it("a queue item without a url is left out", () => {
    const raw = tony();
    delete raw.queue.items[0].url;
    expect(parseRunResult(raw)?.queue.items).toHaveLength(8);
  });

  it("an unparseable last_sent_at → null", () => {
    const raw = tony();
    raw.delivery.last_sent_at = "garbage";
    expect(parseRunResult(raw)?.delivery.last_sent_at).toBeNull();
  });

  it("a malformed telegram_public → null", () => {
    const raw = newsroom(1);
    raw.config.sources.telegram_public = { channels: "x" };
    expect(parseRunResult(raw)?.config.sources.telegram_public).toBeNull();
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run lib/run-result.test.ts`
Expected: FAIL — cannot find module `./run-result`.

- [ ] **Step 3: Implement `lib/run-result.ts`**

```ts
import type { PendingItem } from "./pending-queue";

// The engine's per-run contract, agent/run_result.py (schema 2): the
// assembled config, numbers per stage and scope, drop reasons, failures,
// the queue and the delivery. Tony's comes from agent-data (written by
// every agent-run.yml run); the demo presets' from their committed
// goldens (lib/demo-presets.ts). parseRunResult validates the parts the
// pages read and returns a normalized copy: a bad core rejects the file,
// a bad optional part costs only itself (as lib/agent-status.ts does).

export const RUN_RESULT_URL =
  "https://raw.githubusercontent.com/hpnssflw/hpnssflw.github.io/agent-data/agent/run-result.json";
/** agent/run_result.py's SCHEMA_VERSION this site reads. */
export const RUN_RESULT_SCHEMA = 2;
/** A preset feed's items before classification (agent/run_result.py). */
export const FEED_SCOPE = "*";

export type Language = "en" | "ru";

export interface ScopeCounts {
  in: number;
  out: number;
  drops: Record<string, number>;
  notes?: Record<string, number>;
  /** rank's `*` scope: shared-feed items sorted into each topic. */
  assigned?: Record<string, number>;
}

export interface StageResult {
  stage: string;
  group: string;
  scopes: Record<string, ScopeCounts>;
}

/** Which stage failed, never why (no error text in the file). */
export interface RunFailureRecord {
  stage: string;
  scope: string;
  source: string | null;
  error_type: string;
}

export interface FeedConfig {
  id: string;
  name: string;
  url: string;
  full_text: boolean;
}

export interface TopicResult {
  slug: string;
  name: string;
  description: string;
  keywords: string[];
  include: string[];
  exclude: string[];
  sources: {
    hacker_news?: { min_points?: number };
    github_trending?: { topics: string[]; min_stars?: number };
  };
  rss: FeedConfig[];
  max_age_days: number;
  min_relevance: number;
  max_items_per_day: number;
  attention: { enabled: boolean; min_score_gain: number };
  rubric_hash: string;
}

export interface TelegramStub {
  channels: { handle: string; name: string }[];
}

export type ApprovalResult =
  | { type: "inbox"; decisions_url: string; expire_days: number }
  | { type: "file"; path: string; expire_days: number };

export interface DeliveryConfig {
  type: "telegram" | "file";
  title: string;
  cadence_hours: number;
  chat: string | null;
}

export interface RunConfig {
  max_age_days: number;
  sources: { rss: FeedConfig[]; telegram_public: TelegramStub | null };
  topics: TopicResult[];
  ranking: {
    reader: string;
    model: string;
    base_url: string;
    temperature: number;
    batch_size: number;
    rank_prompt_version: number;
  };
  cap_window_hours: number;
  approval: ApprovalResult;
  delivery: DeliveryConfig;
}

export interface QueueItem extends PendingItem {
  decision: "approve" | "reject" | null;
}

export interface RunResult {
  schema_version: typeof RUN_RESULT_SCHEMA;
  preset: { slug: string; name: string; language: Language };
  run: { id: string; at: string; offline: boolean };
  config: RunConfig;
  stages: StageResult[];
  failures: RunFailureRecord[];
  queue: { items: QueueItem[] };
  delivery: { sent_items: number; messages: number; last_sent_at: string | null };
}

type Raw = Record<string, unknown>;

class Malformed extends Error {}

function rec(value: unknown): Raw {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Malformed();
  return value as Raw;
}

function str(value: unknown): string {
  if (typeof value !== "string") throw new Malformed();
  return value;
}

function num(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Malformed();
  return value;
}

function bool(value: unknown): boolean {
  if (typeof value !== "boolean") throw new Malformed();
  return value;
}

function date(value: unknown): string {
  const text = str(value);
  if (Number.isNaN(Date.parse(text))) throw new Malformed();
  return text;
}

function list<T>(value: unknown, item: (value: unknown) => T): T[] {
  if (!Array.isArray(value)) throw new Malformed();
  return value.map(item);
}

const strs = (value: unknown): string[] => list(value, str);

function counts(value: unknown): Record<string, number> {
  return Object.fromEntries(Object.entries(rec(value)).map(([key, n]) => [key, num(n)]));
}

/** `parse()`, or `fallback` when what it reads is malformed. */
function optional<T>(parse: () => T, fallback: T): T {
  try {
    return parse();
  } catch (error) {
    if (error instanceof Malformed) return fallback;
    throw error;
  }
}

/** The entries that parse; malformed ones are left out. */
function lenient<T>(value: unknown, item: (value: unknown) => T): T[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => optional<T[]>(() => [item(entry)], []));
}

function feed(value: unknown): FeedConfig {
  const f = rec(value);
  return { id: str(f.id), name: str(f.name), url: str(f.url), full_text: bool(f.full_text) };
}

function topic(value: unknown): TopicResult {
  const t = rec(value);
  const sources = rec(t.sources);
  const attention = rec(t.attention);
  const parsed: TopicResult["sources"] = {};
  if (sources.hacker_news !== undefined) {
    const hn = rec(sources.hacker_news);
    parsed.hacker_news = hn.min_points === undefined ? {} : { min_points: num(hn.min_points) };
  }
  if (sources.github_trending !== undefined) {
    const gh = rec(sources.github_trending);
    const github: { topics: string[]; min_stars?: number } = { topics: strs(gh.topics) };
    if (gh.min_stars !== undefined) github.min_stars = num(gh.min_stars);
    parsed.github_trending = github;
  }
  return {
    slug: str(t.slug),
    name: str(t.name),
    description: str(t.description),
    keywords: strs(t.keywords),
    include: strs(t.include),
    exclude: strs(t.exclude),
    sources: parsed,
    rss: list(t.rss, feed),
    max_age_days: num(t.max_age_days),
    min_relevance: num(t.min_relevance),
    max_items_per_day: num(t.max_items_per_day),
    attention: { enabled: bool(attention.enabled), min_score_gain: num(attention.min_score_gain) },
    rubric_hash: str(t.rubric_hash),
  };
}

function telegram(value: unknown): TelegramStub | null {
  if (value === null) return null;
  return {
    channels: list(rec(value).channels, (entry) => {
      const channel = rec(entry);
      return { handle: str(channel.handle), name: str(channel.name) };
    }),
  };
}

function approval(value: unknown): ApprovalResult {
  const a = rec(value);
  if (a.type === "inbox") return { type: "inbox", decisions_url: str(a.decisions_url), expire_days: num(a.expire_days) };
  if (a.type === "file") return { type: "file", path: str(a.path), expire_days: num(a.expire_days) };
  throw new Malformed();
}

function deliveryConfig(value: unknown): DeliveryConfig {
  const d = rec(value);
  const type = d.type === "telegram" || d.type === "file" ? d.type : null;
  if (type === null) throw new Malformed();
  return {
    type,
    title: str(d.title),
    cadence_hours: num(d.cadence_hours),
    chat: type === "telegram" ? str(d.chat) : null,
  };
}

function languageOf(value: unknown): Language {
  if (value === "en" || value === "ru") return value;
  throw new Malformed();
}

function decisionOf(value: unknown): QueueItem["decision"] {
  if (value === null || value === "approve" || value === "reject") return value;
  throw new Malformed();
}

function scope(value: unknown): ScopeCounts {
  const s = rec(value);
  const parsed: ScopeCounts = { in: num(s.in), out: num(s.out), drops: counts(s.drops) };
  if (s.notes !== undefined) parsed.notes = counts(s.notes);
  if (s.assigned !== undefined) parsed.assigned = counts(s.assigned);
  return parsed;
}

function stage(value: unknown): StageResult {
  const s = rec(value);
  return {
    stage: str(s.stage),
    group: str(s.group),
    scopes: Object.fromEntries(Object.entries(rec(s.scopes)).map(([key, counted]) => [key, scope(counted)])),
  };
}

function failure(value: unknown): RunFailureRecord {
  const f = rec(value);
  return {
    stage: str(f.stage),
    scope: str(f.scope),
    source: f.source === null ? null : str(f.source),
    error_type: str(f.error_type),
  };
}

function queueItem(value: unknown): QueueItem {
  const i = rec(value);
  return {
    url: str(i.url),
    title: str(i.title),
    source: str(i.source),
    topic: str(i.topic),
    topic_name: str(i.topic_name),
    summary: str(i.summary),
    score: num(i.score),
    pending_since: str(i.pending_since),
    decision: decisionOf(i.decision),
  };
}

export function parseRunResult(value: unknown): RunResult | null {
  try {
    const r = rec(value);
    if (r.schema_version !== RUN_RESULT_SCHEMA) return null;
    const preset = rec(r.preset);
    const run = rec(r.run);
    const config = rec(r.config);
    const sources = rec(config.sources);
    const ranking = rec(config.ranking);
    const delivery = optional(() => rec(r.delivery), {} as Raw);
    return {
      schema_version: RUN_RESULT_SCHEMA,
      preset: { slug: str(preset.slug), name: str(preset.name), language: languageOf(preset.language) },
      run: { id: str(run.id), at: date(run.at), offline: bool(run.offline) },
      config: {
        max_age_days: num(config.max_age_days),
        sources: {
          rss: list(sources.rss, feed),
          telegram_public: optional(() => telegram(sources.telegram_public), null),
        },
        topics: list(config.topics, topic),
        ranking: {
          reader: str(ranking.reader),
          model: str(ranking.model),
          base_url: str(ranking.base_url),
          temperature: num(ranking.temperature),
          batch_size: num(ranking.batch_size),
          rank_prompt_version: num(ranking.rank_prompt_version),
        },
        cap_window_hours: num(config.cap_window_hours),
        approval: approval(config.approval),
        delivery: deliveryConfig(config.delivery),
      },
      stages: list(r.stages, stage),
      failures: optional(() => list(r.failures, failure), []),
      queue: { items: lenient(optional(() => rec(r.queue).items, []), queueItem) },
      delivery: {
        sent_items: optional(() => num(delivery.sent_items), 0),
        messages: optional(() => num(delivery.messages), 0),
        last_sent_at: optional<string | null>(() => date(delivery.last_sent_at), null),
      },
    };
  } catch (error) {
    if (error instanceof Malformed) return null;
    throw error;
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run lib/run-result.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/run-result.ts lib/run-result.test.ts
git commit -m "Read the engine's run-result.json (schema 2) on the site"
```

---

### Task 4: Interface text (en, ru) and the config view

**Files:**
- Create: `lib/control-room-text.ts`, `lib/control-room-text.test.ts`
- Create: `lib/config-view.ts`, `lib/config-view.test.ts`

Nothing imports these yet; Task 5 wires them in.

**Interfaces:**
- Consumes: `Language`, `FeedConfig`, `RunConfig` from `lib/run-result.ts`.
- Produces: `type Part = string | { v: string | number }`; `type Text` (the shape of `TEXT.en`); `TEXT: Record<Language, Text>`. `TopicView`, `ConfigView`, `configView(config: RunConfig): ConfigView`.

- [ ] **Step 1: Write the failing tests**

`lib/control-room-text.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { TEXT } from "./control-room-text";

/** Every key path in a nested object, functions counted as leaves. */
function paths(value: unknown, prefix = ""): string[] {
  if (typeof value !== "object" || value === null) return [prefix];
  return Object.entries(value).flatMap(([key, inner]) => paths(inner, prefix ? `${prefix}.${key}` : key));
}

describe("TEXT", () => {
  it("has the same keys in both languages", () => {
    expect(paths(TEXT.ru).sort()).toEqual(paths(TEXT.en).sort());
  });

  it("keeps Tony's English rail lines as they read today", () => {
    expect(TEXT.en.rail.below("6")).toBe("below 6");
    expect(TEXT.en.rail.thisRun(8)).toBe("+8 this run");
    expect(TEXT.en.rail.sent(1, 1)).toBe("1 sent in 1 message");
    expect(TEXT.en.rail.every(4)).toBe("every 4 hours");
    expect(TEXT.en.spine.window("10")).toEqual(["published in the last ", { v: "10" }, " days"]);
  });

  it("speaks Russian for ru presets", () => {
    expect(TEXT.ru.stages.collect).toBe("сбор");
    expect(TEXT.ru.rail.drops.undated).toBe("без даты");
    expect(TEXT.ru.demo.tag("2026-10-06")).toBe("демо · синтетические данные · офлайн-прогоны 06.10.2026");
  });
});
```

`lib/config-view.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { configView } from "./config-view";
import { type RunResult, parseRunResult } from "./run-result";

function run(...parts: string[]): RunResult {
  const result = parseRunResult(JSON.parse(readFileSync(join(process.cwd(), "agent", "tests", "fixtures", ...parts), "utf8")));
  if (!result) throw new Error(`${parts.join("/")} doesn't parse`);
  return result;
}

describe("configView", () => {
  it("shows Tony's config as the spine reads it", () => {
    const view = configView(run("tony", "golden", "real", "run-result.json").config);
    expect(view.llm).toEqual({ model: "deepseek-v4-flash", baseUrl: "https://api.deepseek.com", temperature: 0, batchSize: 40, promptVersion: 2 });
    expect(view.reader).toMatch(/^Artem/);
    expect(view.queueWindowHours).toBe(23);
    expect(view.approval).toEqual({ kind: "inbox", repo: "hpnssflw/tony-inbox", expireDays: 7 });
    expect(view.delivery).toEqual({ kind: "telegram", chat: "@hypnosisflow", title: "Research digest", cadenceHours: 24 });
    expect(view.feeds).toEqual([]);
    expect(view.telegram).toBeNull();
    const ai = view.topics[0];
    expect(ai).toMatchObject({
      slug: "ai-engineering",
      maxItemsPerDay: 4,
      minRelevance: 6,
      maxAgeDays: 10,
      attention: { enabled: true, minScoreGain: 50 },
      hackerNews: { minPoints: 30 },
      github: { minStars: 100, topics: ["llm", "mcp", "ai-agents", "rag", "llm-inference"] },
      rss: [],
    });
    expect(ai.keywords).toHaveLength(21);
  });

  it("shows a demo preset's feeds, file approval and delivery, and the Telegram stub", () => {
    const view = configView(run("newsroom-demo", "golden", "run1.json").config);
    expect(view.approval).toEqual({ kind: "file", expireDays: 3 });
    expect(view.delivery).toEqual({ kind: "file", chat: null, title: "Сводка редакции", cadenceHours: 4 });
    expect(view.feeds.map((f) => f.id)).toEqual(["agency", "ministry", "city"]);
    expect(view.telegram?.map((c) => c.handle)).toEqual(["example_agency", "example_region_gov", "example_city_chat"]);
    expect(view.topics.map((t) => [t.slug, t.hackerNews, t.github, t.rss.length])).toEqual([
      ["incidents", null, null, 0],
      ["power", null, null, 0],
      ["economy", null, null, 0],
    ]);
  });

  it("keeps a topic's own feeds", () => {
    const view = configView(run("agro-demo", "golden", "run1.json").config);
    expect(view.topics.find((t) => t.slug === "prices")?.rss.map((f) => f.name)).toEqual(["Биржевые котировки (пример)"]);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run lib/control-room-text.test.ts lib/config-view.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `lib/control-room-text.ts`**

```ts
import type { Language } from "./run-result";

// Every interface string of the control room and the demo section, in
// each preset language. Topic names, titles and summaries are content and
// never come from here. A `Part[]` line interleaves text with config
// values ({ v }), which ConfigSpine renders as <ConfigValue>. `Text` is
// the English shape; `ru` must match it key for key (the type checks
// that; lib/control-room-text.test.ts checks it at runtime too).

export type Part = string | { v: string | number };

const en = {
  stages: {
    collect: "collect",
    window: "window",
    dedupe: "dedupe",
    cache: "cache",
    rank: "rank",
    cap: "cap",
    queue: "queue",
    review: "review",
    deliver: "deliver",
  },
  rail: {
    label: "Pipeline, last run",
    found: "found",
    drops: {
      undated: "undated",
      no_link: "no link",
      below_min_points: "below min points",
      outside_window: "too old",
      seen: "seen",
      dismissed: "dismissed",
      already_ranked: "cached below",
      off_topic: "off topic",
      over_max_items: "over cap",
      rejected: "rejected",
      expired: "expired",
    },
    below: (threshold: string) => `below ${threshold}`,
    threshold: "threshold",
    fullText: (n: number) => `+${n} full text`,
    thisRun: (n: number) => `+${n} this run`,
    never: "never",
    approvedOnly: "approved only",
    sent: (items: number, messages: number) => `${items} sent in ${messages} message${messages === 1 ? "" : "s"}`,
    shared: "shared feeds, before sorting",
    failed: (sources: string) => `failed: ${sources}`,
    reviewHint: (cadence: string) =>
      `approved items go out with the next digest; the agent picks up decisions at the start of its next run (${cadence})`,
    every: (hours: number) => `every ${hours} hours`,
    daily: "once a day",
  },
  topics: { label: "Topic", all: "all" },
  queue: {
    label: "Queue",
    statusLabel: "Status",
    statuses: { waiting: "waiting", approved: "approved", rejected: "rejected", all: "all" },
    unavailable: "queue unavailable",
    empty: "nothing here",
    approve: "approve",
    reject: "reject",
    undo: "undo",
    open: "open ↗",
    keysMove: "move",
    keysOpen: "open",
    reset: "reset",
  },
  configPane: {
    label: "Config",
    region: "Config and outcomes",
    fromRun: (hhmm: string) => `as of last run ${hhmm} utc`,
    hint: "a criteria change re-scores the topic",
    unavailable: "config unavailable",
  },
  spine: {
    label: "Config by stage",
    hnOn: (keywords: number, points: number): Part[] => ["hn: ", { v: keywords }, " title keywords, ≥", { v: points }, " points"],
    githubOn: (topics: number, stars: number): Part[] => ["github: ", { v: topics }, " topics, ≥", { v: stars }, "★"],
    rssOn: (feeds: number): Part[] => ["rss: ", { v: feeds }, " feeds"],
    hnSearch: (points: string): Part[] => ["hn title search, ≥", { v: points }, " points"],
    githubSearch: (stars: string): Part[] => ["github topic search, ≥", { v: stars }, "★"],
    perTopic: "per topic",
    presetFeeds: (feeds: number): Part[] => ["shared feeds: ", { v: feeds }, ", sorted into topics by the model"],
    hnKeywords: "hn keywords",
    githubTopics: "github topics",
    feeds: "feeds",
    fullText: "full text",
    window: (days: string): Part[] => ["published in the last ", { v: days }, " days"],
    dedupe: "already sent, queued, rejected or expired · the same url twice in a run",
    cache: "one verdict per url × topic",
    rubric: "rubric",
    cached: "cached",
    regrow: (gain: string): Part[] => ["re-score at ", { v: "2×" }, " and ", { v: `+${gain}` }, " points/stars"],
    noRegrow: "no re-score on growth",
    rank: (model: string, temperature: number, batch: number, prompt: number, pass: string): Part[] => [
      { v: model },
      " · temperature ",
      { v: temperature },
      " · batches of ",
      { v: batch },
      " · prompt v",
      { v: prompt },
      " · pass ≥",
      { v: pass },
    ],
    reader: "reader",
    criteria: "criteria",
    pickTopic: "pick a topic to see its include / exclude",
    cap: (perDay: string, windowHours: number): Part[] => [
      { v: perDay },
      " a day · rolling ",
      { v: `${windowHours}h` },
      " · the rest waits for a later run",
    ],
    queue: "held for your review",
    reviewInbox: (repo: string, days: number): Part[] => [
      "your decisions in ",
      { v: repo },
      " · undecided expire after ",
      { v: `${days}d` },
    ],
    reviewFile: (days: number): Part[] => ["the editor's decisions file · undecided expire after ", { v: `${days}d` }],
    deliverTelegram: (chat: string, hours: number): Part[] => [
      "approved only · telegram ",
      { v: chat },
      " · every ",
      { v: `${hours}h` },
    ],
    deliverFile: (title: string, hours: number): Part[] => ["approved only · digest ", { v: title }, " · every ", { v: `${hours}h` }],
    more: (n: number) => `+${n}`,
    less: "less",
    telegram: "telegram channels",
    telegramSoon: "coming soon — the engine doesn't read Telegram yet",
  },
  demo: {
    tag: (isoDate: string) => `demo · synthetic data · offline runs of ${isoDate}`,
    switcher: "Presets",
    tonyLive: "Tony live ↗",
    runs: "Run",
    run1: "run 1 — the queue fills",
    run2: "run 2 — decisions applied, digest sent",
    sandbox: "sandbox · nothing is saved",
    region: "Digest and config",
    digest: "Digest",
    digestPreview: "what the editor would receive",
    digestSent: "what the engine sent",
    digestEmpty: "approve items to build the digest",
  },
};

export type Text = typeof en;

const ru: Text = {
  stages: {
    collect: "сбор",
    window: "окно",
    dedupe: "дубли",
    cache: "кэш",
    rank: "оценка",
    cap: "лимит",
    queue: "очередь",
    review: "решения",
    deliver: "доставка",
  },
  rail: {
    label: "Конвейер, последний прогон",
    found: "найдено",
    drops: {
      undated: "без даты",
      no_link: "без ссылки",
      below_min_points: "мало очков",
      outside_window: "старые",
      seen: "уже были",
      dismissed: "отклонены ранее",
      already_ranked: "оценены ранее",
      off_topic: "не по темам",
      over_max_items: "сверх лимита",
      rejected: "отклонено",
      expired: "истекло",
    },
    below: (threshold: string) => `ниже ${threshold}`,
    threshold: "порога",
    fullText: (n: number) => `+${n} полный текст`,
    thisRun: (n: number) => `+${n} за прогон`,
    never: "никогда",
    approvedOnly: "только одобренное",
    sent: (items: number, messages: number) => `отправлено ${items} · сообщений: ${messages}`,
    shared: "общие ленты, до сортировки",
    failed: (sources: string) => `сбой: ${sources}`,
    reviewHint: (cadence: string) =>
      `одобренное уходит со следующей сводкой; агент читает решения в начале следующего прогона (${cadence})`,
    every: (hours: number) => `каждые ${hours} ч`,
    daily: "раз в день",
  },
  topics: { label: "Тема", all: "все" },
  queue: {
    label: "Очередь",
    statusLabel: "Статус",
    statuses: { waiting: "ждут", approved: "одобрено", rejected: "отклонено", all: "все" },
    unavailable: "очередь недоступна",
    empty: "пусто",
    approve: "одобрить",
    reject: "отклонить",
    undo: "отменить",
    open: "открыть ↗",
    keysMove: "выбор",
    keysOpen: "открыть",
    reset: "сбросить",
  },
  configPane: {
    label: "Конфиг",
    region: "Конфиг и итоги",
    fromRun: (hhmm: string) => `по последнему прогону ${hhmm} utc`,
    hint: "смена критериев переоценивает тему",
    unavailable: "конфиг недоступен",
  },
  spine: {
    label: "Конфиг по стадиям",
    hnOn: (keywords: number, points: number): Part[] => ["hn: ", { v: keywords }, " слов в заголовке, ≥", { v: points }, " очков"],
    githubOn: (topics: number, stars: number): Part[] => ["github: ", { v: topics }, " тем, ≥", { v: stars }, "★"],
    rssOn: (feeds: number): Part[] => ["rss: ", { v: feeds }, " лент"],
    hnSearch: (points: string): Part[] => ["поиск hn по заголовкам, ≥", { v: points }, " очков"],
    githubSearch: (stars: string): Part[] => ["поиск github по темам, ≥", { v: stars }, "★"],
    perTopic: "по каждой теме",
    presetFeeds: (feeds: number): Part[] => ["общие ленты: ", { v: feeds }, ", по темам раскладывает модель"],
    hnKeywords: "слова hn",
    githubTopics: "темы github",
    feeds: "ленты",
    fullText: "полный текст",
    window: (days: string): Part[] => ["опубликовано за последние ", { v: days }, " дн."],
    dedupe: "уже отправлено, в очереди, отклонено или истекло · одна ссылка дважды за прогон",
    cache: "одна оценка на ссылку × тему",
    rubric: "рубрика",
    cached: "в кэше",
    regrow: (gain: string): Part[] => ["переоценка при ", { v: "2×" }, " и ", { v: `+${gain}` }, " очков/звёзд"],
    noRegrow: "без переоценки при росте",
    rank: (model: string, temperature: number, batch: number, prompt: number, pass: string): Part[] => [
      { v: model },
      " · температура ",
      { v: temperature },
      " · пачки по ",
      { v: batch },
      " · промпт v",
      { v: prompt },
      " · проходит ≥",
      { v: pass },
    ],
    reader: "читатель",
    criteria: "критерии",
    pickTopic: "выберите тему, чтобы увидеть include / exclude",
    cap: (perDay: string, windowHours: number): Part[] => [
      { v: perDay },
      " в день · окно ",
      { v: `${windowHours} ч` },
      " · остальное ждёт следующего прогона",
    ],
    queue: "ждёт решения редактора",
    reviewInbox: (repo: string, days: number): Part[] => [
      "ваши решения в ",
      { v: repo },
      " · без решения истекают через ",
      { v: `${days} дн.` },
    ],
    reviewFile: (days: number): Part[] => ["файл решений редактора · без решения истекают через ", { v: `${days} дн.` }],
    deliverTelegram: (chat: string, hours: number): Part[] => [
      "только одобренное · telegram ",
      { v: chat },
      " · каждые ",
      { v: `${hours} ч` },
    ],
    deliverFile: (title: string, hours: number): Part[] => [
      "только одобренное · сводка «",
      { v: title },
      "» · каждые ",
      { v: `${hours} ч` },
    ],
    more: (n: number) => `+${n}`,
    less: "свернуть",
    telegram: "telegram-каналы",
    telegramSoon: "скоро — движок пока не читает Telegram",
  },
  demo: {
    tag: (isoDate: string) =>
      `демо · синтетические данные · офлайн-прогоны ${isoDate.slice(8, 10)}.${isoDate.slice(5, 7)}.${isoDate.slice(0, 4)}`,
    switcher: "Пресеты",
    tonyLive: "Tony live ↗",
    runs: "Прогон",
    run1: "прогон 1 — очередь наполнилась",
    run2: "прогон 2 — решения применены, сводка ушла",
    sandbox: "песочница · ничего не сохраняется",
    region: "Сводка и конфиг",
    digest: "Сводка",
    digestPreview: "что уйдёт редактору",
    digestSent: "что отправил движок",
    digestEmpty: "одобрите материалы — здесь появится сводка",
  },
};

export const TEXT: Record<Language, Text> = { en, ru };
```

- [ ] **Step 4: Implement `lib/config-view.ts`**

```ts
import type { FeedConfig, RunConfig } from "./run-result";

// A run's config (run-result.json's `config`) shaped for ConfigSpine:
// camelCase, connector defaults filled in (agent/sources/hn.py and
// github_trending.py read a missing minimum as 0), the inbox repo
// parsed out of its contents URL.

export interface TopicView {
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
  rss: FeedConfig[];
}

export interface ConfigView {
  llm: { model: string; baseUrl: string; temperature: number; batchSize: number; promptVersion: number };
  reader: string;
  queueWindowHours: number;
  approval: { kind: "inbox"; repo: string; expireDays: number } | { kind: "file"; expireDays: number };
  delivery: { kind: "telegram" | "file"; chat: string | null; title: string; cadenceHours: number };
  /** Preset-level feeds, classified across the topics. */
  feeds: FeedConfig[];
  /** telegram_public's channels, shown as "coming soon"; null when the preset has none. */
  telegram: { handle: string; name: string }[] | null;
  topics: TopicView[];
}

const INBOX_REPO_RE = /^https:\/\/api\.github\.com\/repos\/([^/]+\/[^/]+)\/contents\//;

export function configView(config: RunConfig): ConfigView {
  const { approval, delivery, ranking } = config;
  return {
    llm: {
      model: ranking.model,
      baseUrl: ranking.base_url,
      temperature: ranking.temperature,
      batchSize: ranking.batch_size,
      promptVersion: ranking.rank_prompt_version,
    },
    reader: ranking.reader,
    queueWindowHours: config.cap_window_hours,
    approval:
      approval.type === "inbox"
        ? {
            kind: "inbox",
            repo: INBOX_REPO_RE.exec(approval.decisions_url)?.[1] ?? approval.decisions_url,
            expireDays: approval.expire_days,
          }
        : { kind: "file", expireDays: approval.expire_days },
    delivery: { kind: delivery.type, chat: delivery.chat, title: delivery.title, cadenceHours: delivery.cadence_hours },
    feeds: config.sources.rss,
    telegram: config.sources.telegram_public?.channels ?? null,
    topics: config.topics.map((t) => ({
      slug: t.slug,
      name: t.name,
      description: t.description,
      include: t.include,
      exclude: t.exclude,
      keywords: t.keywords,
      maxAgeDays: t.max_age_days,
      minRelevance: t.min_relevance,
      maxItemsPerDay: t.max_items_per_day,
      attention: { enabled: t.attention.enabled, minScoreGain: t.attention.min_score_gain },
      hackerNews: t.sources.hacker_news ? { minPoints: t.sources.hacker_news.min_points ?? 0 } : null,
      github: t.sources.github_trending
        ? { minStars: t.sources.github_trending.min_stars ?? 0, topics: t.sources.github_trending.topics }
        : null,
      rss: t.rss,
    })),
  };
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run lib/control-room-text.test.ts lib/config-view.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/control-room-text.ts lib/control-room-text.test.ts lib/config-view.ts lib/config-view.test.ts
git commit -m "Add the control room's text in en and ru, and a config view of a run"
```

---

### Task 5: The control room reads `run-result.json`

**Files:**
- Modify: `lib/pipeline-stages.ts` (rewrite), `lib/pipeline-stages.test.ts` (rewrite)
- Rename + rewrite: `lib/agent-config.ts` → `lib/agent-schedule.ts`, `lib/agent-config.test.ts` → `lib/agent-schedule.test.ts`
- Create: `components/TopicChips.tsx`
- Modify: `components/PipelineRail.tsx`, `components/QueuePane.tsx`, `components/ConfigSpine.tsx`, `components/ControlRoom.tsx`, `app/researcher/queue/page.tsx`, `lib/cron.ts:1-5` (comment)
- Modify: `package.json`, `package-lock.json` (drop `yaml`)
- Modify: `CLAUDE.md` (the control-room bullet and the `npm test` list)

**Interfaces:**
- Consumes: Task 3's `RunResult`, `FEED_SCOPE`, `RUN_RESULT_URL`, `parseRunResult`; Task 4's `TEXT`, `Text`, `Part`, `ConfigView`, `TopicView`, `configView`; `Decisions`, `itemStatus` (`lib/inbox.ts`).
- Produces:
  - `lib/pipeline-stages.ts`: `TopicFilter`, `STAGE_KEYS`, `StageKey`, `StageNumbers` (unchanged); `interface LiveOverlay { queue: PendingItem[] | null; decisions: Decisions | null }`; `topicSlugs(topics: { slug: string }[], topic: TopicFilter): string[]`; `buildStages(result: RunResult | null, live: LiveOverlay, topic: TopicFilter, text: Text["rail"]): StageNumbers[]`.
  - `lib/agent-schedule.ts`: `loadSchedule(root?: string): CronSchedule`.
  - `components/TopicChips.tsx`: default export `TopicChips({ topics, counts, topic, onPick, text })`.
  - `PipelineRail` gains `text: Text`; `QueuePane` gains `text: Text["queue"]`; `ConfigSpine` takes `config: ConfigView` and `text: Text`.
  - `ControlRoom({ schedule }: { schedule: CronSchedule })`.

- [ ] **Step 1: Write the failing rail tests**

Replace `lib/pipeline-stages.test.ts` with:

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TEXT } from "./control-room-text";
import type { Decisions } from "./inbox";
import type { PendingItem } from "./pending-queue";
import { STAGE_KEYS, type StageNumbers, buildStages, topicSlugs } from "./pipeline-stages";
import { type RunResult, parseRunResult } from "./run-result";

function run(...parts: string[]): RunResult {
  const result = parseRunResult(JSON.parse(readFileSync(join(process.cwd(), "agent", "tests", "fixtures", ...parts), "utf8")));
  if (!result) throw new Error(`${parts.join("/")} doesn't parse`);
  return result;
}
const tony = run("tony", "golden", "real", "run-result.json");
const newsroom1 = run("newsroom-demo", "golden", "run1.json");
const agro1 = run("agro-demo", "golden", "run1.json");
const NONE = { queue: null, decisions: null };
const en = TEXT.en.rail;

function table(stages: StageNumbers[]): Record<string, [string, string]> {
  return Object.fromEntries(stages.map((s) => [s.key, [s.value, s.line]]));
}

function item(url: string, topic: string): PendingItem {
  return { url, title: url, source: "hn", topic, topic_name: topic, summary: "", score: 7, pending_since: "2026-10-06T12:00:00+00:00" };
}

describe("topicSlugs", () => {
  it("is every topic for all, else the one picked", () => {
    expect(topicSlugs([{ slug: "a" }, { slug: "b" }], "all")).toEqual(["a", "b"]);
    expect(topicSlugs([{ slug: "a" }, { slug: "b" }], "b")).toEqual(["b"]);
  });
});

describe("buildStages on Tony's run", () => {
  it("returns the nine stages in order", () => {
    expect(buildStages(tony, NONE, "all", en).map((s) => s.key)).toEqual([...STAGE_KEYS]);
  });

  it("sums every topic under all", () => {
    expect(table(buildStages(tony, NONE, "all", en))).toEqual({
      collect: ["24", "−1 undated"],
      window: ["23", "−1 too old"],
      dedupe: ["18", "−3 seen · −2 dismissed"],
      cache: ["17", "−1 cached below"],
      rank: ["13", "−4 below 6"],
      cap: ["8", "−5 over cap"],
      queue: ["9", "+8 this run"],
      review: ["1", "−1 rejected · −1 expired"],
      deliver: ["10-06", "1 sent in 1 message"],
    });
  });

  it("numbers one topic", () => {
    expect(table(buildStages(tony, NONE, "tooling", en))).toEqual({
      collect: ["7", "−1 undated"],
      window: ["6", "−1 too old"],
      dedupe: ["4", "−2 seen · −0 dismissed"],
      cache: ["4", "−0 cached below"],
      rank: ["3", "−1 below 6"],
      cap: ["1", "−2 over cap"],
      queue: ["2", "+1 this run"],
      review: ["0", "−1 rejected · −1 expired"],
      deliver: ["10-06", "1 sent in 1 message"],
    });
  });

  it("counts the live queue and live decisions when the page has them", () => {
    const queue = [item("https://a", "tooling"), item("https://b", "tooling"), item("https://c", "web-products")];
    const decisions: Decisions = {
      version: 1,
      decisions: {
        "https://a": { decision: "approve", at: "2026-10-06T13:00:00Z" },
        "https://c": { decision: "reject", at: "2026-10-06T13:00:00Z" },
      },
    };
    const rows = table(buildStages(tony, { queue, decisions }, "tooling", en));
    expect(rows.queue).toEqual(["2", "+1 this run"]);
    expect(rows.review[0]).toBe("1");
  });

  it("marks the stage and source that failed, in the topics in view", () => {
    const failing: RunResult = {
      ...tony,
      failures: [
        { stage: "collect", scope: "tooling", source: "hacker_news", error_type: "HTTPError" },
        { stage: "format", scope: "*", source: null, error_type: "ValueError" },
      ],
    };
    const tooling = Object.fromEntries(buildStages(failing, NONE, "tooling", en).map((s) => [s.key, s.failed]));
    expect(tooling.collect).toBe("hacker_news");
    expect(tooling.deliver).toBe("run");
    expect(tooling.rank).toBeNull();
    const web = Object.fromEntries(buildStages(failing, NONE, "web-products", en).map((s) => [s.key, s.failed]));
    expect(web.collect).toBeNull();
  });

  it("shows dashes without a run, but still the live queue and decisions", () => {
    const queue = [item("https://a", "tooling")];
    const decisions: Decisions = { version: 1, decisions: { "https://a": { decision: "approve", at: "2026-10-06T13:00:00Z" } } };
    expect(table(buildStages(null, { queue, decisions }, "all", en))).toEqual({
      collect: ["—", ""],
      window: ["—", ""],
      dedupe: ["—", ""],
      cache: ["—", ""],
      rank: ["—", ""],
      cap: ["—", ""],
      queue: ["1", ""],
      review: ["1", ""],
      deliver: ["—", ""],
    });
  });
});

describe("buildStages on a demo preset's shared feeds", () => {
  it("sums the shared feeds into all, with the full-text note", () => {
    expect(table(buildStages(newsroom1, NONE, "all", en))).toEqual({
      collect: ["19", "−2 undated"],
      window: ["17", "−2 too old"],
      dedupe: ["16", "−1 seen · −0 dismissed"],
      cache: ["16", "−0 cached below"],
      rank: ["11", "−3 below 6 · −2 off topic · +3 full text"],
      cap: ["8", "−3 over cap"],
      queue: ["8", "+8 this run"],
      review: ["0", "−0 rejected · −0 expired"],
      deliver: ["never", "approved only"],
    });
  });

  it("shows a topic the shared feeds before sorting, and what was sorted into it", () => {
    const shared = " · shared feeds, before sorting";
    expect(table(buildStages(newsroom1, NONE, "power", en))).toEqual({
      collect: ["19", `−2 undated${shared}`],
      window: ["17", `−2 too old${shared}`],
      dedupe: ["16", `−1 seen · −0 dismissed${shared}`],
      cache: ["16", `−0 cached below${shared}`],
      rank: ["4", `−3 below 6 · −2 off topic · +3 full text${shared}`],
      cap: ["3", "−1 over cap"],
      queue: ["3", "+3 this run"],
      review: ["0", "−0 rejected · −0 expired"],
      deliver: ["never", "approved only"],
    });
  });

  it("keeps a topic's own feed numbers, plus what the shared feeds added", () => {
    const rows = table(buildStages(agro1, NONE, "prices", en));
    expect(rows.collect).toEqual(["3", "found"]);
    expect(rows.rank).toEqual(["3", "−0 below 6"]);
  });

  it("counts the sandbox's approvals on review", () => {
    const decisions: Decisions = {
      version: 1,
      decisions: { "https://example-agency.ru/news/102": { decision: "approve", at: "2026-10-06T06:00:00Z" } },
    };
    expect(table(buildStages(newsroom1, { queue: null, decisions }, "all", en)).review[0]).toBe("1");
  });

  it("speaks the preset's language", () => {
    expect(table(buildStages(newsroom1, NONE, "power", TEXT.ru.rail)).collect).toEqual([
      "19",
      "−2 без даты · общие ленты, до сортировки",
    ]);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run lib/pipeline-stages.test.ts`
Expected: FAIL (old signature / types).

- [ ] **Step 3: Rewrite `lib/pipeline-stages.ts`**

```ts
import type { Text } from "./control-room-text";
import { type Decisions, itemStatus } from "./inbox";
import type { PendingItem } from "./pending-queue";
import { FEED_SCOPE, type RunResult, type ScopeCounts } from "./run-result";

/** "all", or one topic's slug. */
export type TopicFilter = "all" | (string & {});

/** The rail, in reading order. "review" is where moderation sits
 * logically; the agent applies decisions at the start of its next run.
 * run-result.json's `enrich` folds into rank, `format` into deliver. */
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

/** What the page knows live on top of the run: Tony's pending.json and
 * inbox, or the demo's sandbox decisions. */
export interface LiveOverlay {
  /** Items in the queue now (all topics); null: the run's own queue. */
  queue: PendingItem[] | null;
  /** Decisions counted on the review stage; null: the run's own count. */
  decisions: Decisions | null;
}

const DASH = "—";

/** Stages where a picked topic with nothing of its own shows the shared
 * feeds (`*`) instead: everything before items are sorted into topics. */
const BEFORE_SORTING = new Set(["collect", "window", "dedupe", "cache", "enrich", "rank"]);

/** run-result.json failure stages → the rail stage they show on. */
const RAIL_STAGE: Record<string, StageKey> = {
  collect: "collect",
  window: "window",
  dedupe: "dedupe",
  cache: "cache",
  enrich: "rank",
  rank: "rank",
  cap: "cap",
  queue: "queue",
  review: "review",
  format: "deliver",
  deliver: "deliver",
};

const COLLECT_DROPS = ["undated", "no_link", "below_min_points"] as const;

export function topicSlugs(topics: { slug: string }[], topic: TopicFilter): string[] {
  return topic === "all" ? topics.map((t) => t.slug) : [topic];
}

interface Summed {
  in: number;
  out: number;
  drops: Record<string, number>;
  notes: Record<string, number>;
  /** The numbers are the shared feeds', not the picked topic's own. */
  shared: boolean;
}

function add(into: Summed, scope: ScopeCounts | undefined): void {
  if (!scope) return;
  into.in += scope.in;
  into.out += scope.out;
  for (const [reason, n] of Object.entries(scope.drops)) into.drops[reason] = (into.drops[reason] ?? 0) + n;
  for (const [key, n] of Object.entries(scope.notes ?? {})) into.notes[key] = (into.notes[key] ?? 0) + n;
}

const isEmpty = (scope: ScopeCounts | undefined): boolean => !scope || (scope.in === 0 && scope.out === 0);

/** One stage's counts over the scopes in view. */
function sumStage(result: RunResult, stage: string, topic: TopicFilter): Summed {
  const scopes = result.stages.find((s) => s.stage === stage)?.scopes ?? {};
  const sum: Summed = { in: 0, out: 0, drops: {}, notes: {}, shared: false };
  if (topic === "all") {
    for (const scope of Object.values(scopes)) add(sum, scope);
    return sum;
  }
  const own = scopes[topic];
  const feeds = scopes[FEED_SCOPE];
  const sorted = feeds?.assigned?.[topic] ?? 0;
  if (BEFORE_SORTING.has(stage) && isEmpty(own) && !isEmpty(feeds)) {
    add(sum, feeds);
    sum.shared = true;
    if (stage === "rank") sum.out = sorted;
    return sum;
  }
  add(sum, own);
  if (stage === "rank") sum.out += sorted;
  return sum;
}

/**
 * Each rail stage's number and line for the topics in view, from a run's
 * `stages` (run-result.json), with the page's live queue and decisions on
 * top when it has them. See the rail table in
 * docs/superpowers/specs/2026-10-06-preset-switcher-design.md § 3.
 */
export function buildStages(
  result: RunResult | null,
  live: LiveOverlay,
  topic: TopicFilter,
  text: Text["rail"],
): StageNumbers[] {
  const inView = (items: PendingItem[]) => items.filter((i) => topic === "all" || i.topic === topic);
  const liveQueue = live.queue ? inView(live.queue) : null;
  const pool = liveQueue ?? (result ? inView(result.queue.items) : null);
  const approved =
    live.decisions && pool ? pool.filter((i) => itemStatus(live.decisions, i.url) === "approved").length : null;

  if (!result) {
    return STAGE_KEYS.map((key) => ({
      key,
      value:
        key === "queue" && liveQueue ? String(liveQueue.length) : key === "review" && approved !== null ? String(approved) : DASH,
      line: "",
      failed: null,
    }));
  }

  const s = (stage: string) => sumStage(result, stage, topic);
  const minus = (n: number | undefined, label: string) => `−${n ?? 0} ${label}`;
  const mark = (sum: Summed, line: string) => (sum.shared ? `${line} · ${text.shared}` : line);

  const collect = s("collect");
  const window = s("window");
  const dedupe = s("dedupe");
  const cache = s("cache");
  const enrich = s("enrich");
  const rank = s("rank");
  const cap = s("cap");
  const queue = s("queue");
  const review = s("review");

  const slugs = topicSlugs(result.config.topics, topic);
  const thresholds = new Set(result.config.topics.filter((t) => slugs.includes(t.slug)).map((t) => t.min_relevance));
  const threshold = thresholds.size === 1 ? String([...thresholds][0]) : text.threshold;

  const collectDrops = COLLECT_DROPS.filter((reason) => (collect.drops[reason] ?? 0) > 0).map((reason) =>
    minus(collect.drops[reason], text.drops[reason]),
  );
  const rankLine = [minus(rank.drops.below_relevance, text.below(threshold))];
  if (rank.drops.off_topic) rankLine.push(minus(rank.drops.off_topic, text.drops.off_topic));
  if (enrich.notes.full_text) rankLine.push(text.fullText(enrich.notes.full_text));
  const { delivery } = result;

  const rows: Omit<StageNumbers, "failed">[] = [
    { key: "collect", value: String(collect.out), line: mark(collect, collectDrops.length ? collectDrops.join(" · ") : text.found) },
    { key: "window", value: String(window.out), line: mark(window, minus(window.drops.outside_window, text.drops.outside_window)) },
    {
      key: "dedupe",
      value: String(dedupe.out),
      line: mark(dedupe, `${minus(dedupe.drops.seen, text.drops.seen)} · ${minus(dedupe.drops.dismissed, text.drops.dismissed)}`),
    },
    { key: "cache", value: String(cache.out), line: mark(cache, minus(cache.drops.already_ranked, text.drops.already_ranked)) },
    { key: "rank", value: String(rank.out), line: mark(rank, rankLine.join(" · ")) },
    { key: "cap", value: String(cap.out), line: minus(cap.drops.over_max_items, text.drops.over_max_items) },
    { key: "queue", value: String(liveQueue ? liveQueue.length : queue.out), line: text.thisRun(queue.in) },
    {
      key: "review",
      value: String(approved ?? review.notes.approved ?? 0),
      line: `${minus(review.drops.rejected, text.drops.rejected)} · ${minus(review.drops.expired, text.drops.expired)}`,
    },
    {
      key: "deliver",
      value: delivery.last_sent_at ? delivery.last_sent_at.slice(5, 10) : text.never,
      line: delivery.sent_items > 0 ? text.sent(delivery.sent_items, delivery.messages) : text.approvedOnly,
    },
  ];

  return rows.map((row) => {
    const hits = result.failures.filter(
      (f) => RAIL_STAGE[f.stage] === row.key && (topic === "all" || f.scope === topic || f.scope === FEED_SCOPE),
    );
    const failed = hits.length ? [...new Set(hits.map((f) => f.source ?? "run"))].join(", ") : null;
    return { ...row, failed };
  });
}
```

- [ ] **Step 4: Run the rail tests**

Run: `npx vitest run lib/pipeline-stages.test.ts`
Expected: PASS.

- [ ] **Step 5: Replace `lib/agent-config.ts` with `lib/agent-schedule.ts`**

```bash
git mv lib/agent-config.ts lib/agent-schedule.ts
git mv lib/agent-config.test.ts lib/agent-schedule.test.ts
```

`lib/agent-schedule.ts` (whole file):

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type CronSchedule, parseCron } from "./cron";

// The agent's schedule for the control room's pulse, read at build time
// from the `cron:` line of .github/workflows/agent-run.yml — the one fact
// about the agent its run-result.json (lib/run-result.ts) doesn't carry.
// Not exactly one such line throws, so the build fails instead of the
// pulse counting down to the wrong slot. Server-only (node:fs).

const WORKFLOW = ".github/workflows/agent-run.yml";
const CRON_RE = /^\s*-\s*cron:\s*["']([^"'\r\n]+)["']\s*$/gm;

export function loadSchedule(root: string = process.cwd()): CronSchedule {
  const matches = [...readFileSync(join(root, WORKFLOW), "utf8").matchAll(CRON_RE)];
  if (matches.length !== 1) {
    throw new Error(`agent schedule: expected one cron schedule in ${WORKFLOW}, found ${matches.length}`);
  }
  return parseCron(matches[0][1]);
}
```

`lib/agent-schedule.test.ts` (whole file):

```ts
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadSchedule } from "./agent-schedule";

/** A throwaway repo root holding only agent-run.yml. */
function repoWith(workflow: string): string {
  const root = mkdtempSync(join(tmpdir(), "agent-schedule-"));
  mkdirSync(join(root, ".github", "workflows"), { recursive: true });
  writeFileSync(join(root, ".github", "workflows", "agent-run.yml"), workflow);
  return root;
}

describe("loadSchedule", () => {
  it("reads this repo's agent-run.yml", () => {
    expect(loadSchedule()).toEqual({ minute: 0, hourStep: 4, hour: null });
  });

  it("reads a fixture's cron line", () => {
    expect(loadSchedule(repoWith('on:\n  schedule:\n    - cron: "15 */6 * * *"\n'))).toEqual({ minute: 15, hourStep: 6, hour: null });
  });

  it.each([
    ["no cron line", "on: push\n", /found 0/],
    ["two cron lines", 'on:\n  schedule:\n    - cron: "0 */4 * * *"\n    - cron: "0 9 * * *"\n', /found 2/],
    ["an unsupported cron", 'on:\n  schedule:\n    - cron: "0 9 * * 1"\n', /unsupported cron/],
  ])("fails on %s", (_, workflow, message) => {
    expect(() => loadSchedule(repoWith(workflow))).toThrow(message);
  });
});
```

In `lib/cron.ts`'s header comment, replace "so lib/agent-config.ts fails the build" with "so lib/agent-schedule.ts fails the build".

- [ ] **Step 6: Drop the `yaml` dependency**

Run: `npm uninstall yaml` then `git grep -n "from \"yaml\"" -- app components lib scripts`
Expected: the grep prints nothing; `package.json` no longer lists `yaml`.

- [ ] **Step 7: `components/TopicChips.tsx`** (moved out of `ControlRoom.tsx`, shared with the demo)

```tsx
import type { Text } from "@/lib/control-room-text";
import type { TopicFilter } from "@/lib/pipeline-stages";

/** "all" plus one chip per topic, each with its queue count; filters the whole page. */
export default function TopicChips({
  topics,
  counts,
  topic,
  onPick,
  text,
}: {
  topics: { slug: string; name: string }[];
  counts: Record<string, number>;
  topic: TopicFilter;
  onPick: (topic: TopicFilter) => void;
  text: Text["topics"];
}) {
  const options: [TopicFilter, string][] = [["all", text.all], ...topics.map((t): [TopicFilter, string] => [t.slug, t.name])];
  return (
    <div className="cr-chips cr-topics" role="group" aria-label={text.label}>
      {options.map(([key, label]) => (
        <button key={key} type="button" className="cr-chip" aria-pressed={topic === key} onClick={() => onPick(key)}>
          {label} <span className="cr-chip-n">{counts[key] ?? 0}</span>
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 8: Text in `PipelineRail` and `QueuePane`**

`components/PipelineRail.tsx`: add `import type { Text } from "@/lib/control-room-text";`, a `text: Text` prop, and use `aria-label={text.rail.label}`, `<span className="cr-label">{text.stages[stage.key]}</span>`, and `{stage.failed !== null ? text.rail.failed(stage.failed) : stage.line}`.

`components/QueuePane.tsx`: add `import type { Text } from "@/lib/control-room-text";` and a `text: Text["queue"]` prop (last in the props list), then replace the literals:

| literal | becomes |
|---|---|
| `<span className="cr-label">Queue</span>` | `{text.label}` |
| `aria-label="Queue"` / `aria-label="Status"` | `text.label` / `text.statusLabel` |
| chip label `{status}` | `{text.statuses[status]}` |
| badge `{status}` (in `.cr-decision`) | `{text.statuses[status]}` |
| `queue unavailable` / `nothing here` | `{text.unavailable}` / `{text.empty}` |
| `approve` / `reject` / `undo` / `open ↗` after each `<kbd>` | `{text.approve}` / `{text.reject}` / `{text.undo}` / `{text.open}` |
| footer `move` / `approve` / `reject` / `undo` / `open` | `{text.keysMove}` / `{text.approve}` / `{text.reject}` / `{text.undo}` / `{text.keysOpen}` |

- [ ] **Step 9: `ConfigSpine` on `ConfigView` and the dictionary**

Replace `components/ConfigSpine.tsx` with:

```tsx
"use client";

import { Fragment, type ReactNode, useEffect, useState } from "react";
import type { ConfigView, TopicView } from "@/lib/config-view";
import type { Part, Text } from "@/lib/control-room-text";
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

/** A dictionary line: text, with its values as <ConfigValue>. */
function Parts({ parts }: { parts: Part[] }) {
  return (
    <>
      {parts.map((part, i) => (typeof part === "string" ? <Fragment key={i}>{part}</Fragment> : <V key={i}>{part.v}</V>))}
    </>
  );
}

/** Groups of parts joined by " · ". */
function joined(groups: Part[][]): Part[] {
  return groups.flatMap((group, i) => (i ? [" · ", ...group] : group));
}

function Tags({ items, max, text }: { items: string[]; max?: number; text: Text["spine"] }) {
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
          {open ? text.less : text.more(items.length - max)}
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

function feedNames(feeds: { name: string; full_text: boolean }[], text: Text["spine"]): string[] {
  return feeds.map((f) => (f.full_text ? `${f.name} · ${text.fullText}` : f.name));
}

/** What one topic collects from: its enabled sources, else the shared feeds. */
function collectOne(config: ConfigView, topic: TopicView, text: Text["spine"]): Part[] {
  const groups: Part[][] = [];
  if (topic.hackerNews) groups.push(text.hnOn(topic.keywords.length, topic.hackerNews.minPoints));
  if (topic.github) groups.push(text.githubOn(topic.github.topics.length, topic.github.minStars));
  if (topic.rss.length) groups.push(text.rssOn(topic.rss.length));
  if (config.feeds.length) groups.push(text.presetFeeds(config.feeds.length));
  return joined(groups);
}

function collectAll(config: ConfigView, text: Text["spine"]): Part[] {
  const groups: Part[][] = [];
  const points = config.topics.flatMap((t) => (t.hackerNews ? [t.hackerNews.minPoints] : []));
  const stars = config.topics.flatMap((t) => (t.github ? [t.github.minStars] : []));
  const topicFeeds = config.topics.reduce((n, t) => n + t.rss.length, 0);
  if (points.length) groups.push(text.hnSearch(spread(points)));
  if (stars.length) groups.push(text.githubSearch(spread(stars)));
  if (topicFeeds) groups.push(text.rssOn(topicFeeds));
  if (groups.length) groups.push([text.perTopic]);
  if (config.feeds.length) groups.push(text.presetFeeds(config.feeds.length));
  return joined(groups);
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="cr-detail-row">
      <span className="cr-k">{label}</span>
      {children}
    </div>
  );
}

interface StageRow {
  params: ReactNode;
  detail?: ReactNode;
}

function rowsFor(
  config: ConfigView,
  one: TopicView | null,
  verdicts: { count: number; rubric: string | null } | null,
  text: Text["spine"],
): Record<StageKey, StageRow> {
  const scope = one ? [one] : config.topics;
  const growth = scope.filter((t) => t.attention.enabled);
  const feeds = one ? one.rss : config.feeds;

  const collectDetail: ReactNode[] = [];
  if (one?.keywords.length)
    collectDetail.push(
      <Row key="kw" label={text.hnKeywords}>
        <Tags items={one.keywords} max={8} text={text} />
      </Row>,
    );
  if (one?.github)
    collectDetail.push(
      <Row key="gh" label={text.githubTopics}>
        <Tags items={one.github.topics} text={text} />
      </Row>,
    );
  if (feeds.length)
    collectDetail.push(
      <Row key="rss" label={text.feeds}>
        <Tags items={feedNames(feeds, text)} text={text} />
      </Row>,
    );
  if (config.telegram)
    collectDetail.push(
      <Row key="tg" label={text.telegram}>
        <Tags items={config.telegram.map((c) => c.name)} text={text} />
        <span className="agent-muted"> {text.telegramSoon}</span>
      </Row>,
    );

  const cache: Part[] = [text.cache];
  if (one && verdicts?.rubric) cache.push(` · ${text.rubric} `, { v: verdicts.rubric });
  if (verdicts) cache.push(" · ", { v: verdicts.count }, ` ${text.cached}`);
  cache.push(" · ", ...(growth.length ? text.regrow(spread(growth.map((t) => t.attention.minScoreGain))) : [text.noRegrow]));

  return {
    collect: {
      params: <Parts parts={one ? collectOne(config, one, text) : collectAll(config, text)} />,
      detail: collectDetail.length ? collectDetail : undefined,
    },
    window: { params: <Parts parts={text.window(spread(scope.map((t) => t.maxAgeDays)))} /> },
    dedupe: { params: text.dedupe },
    cache: { params: <Parts parts={cache} /> },
    rank: {
      params: (
        <Parts
          parts={text.rank(
            config.llm.model,
            config.llm.temperature,
            config.llm.batchSize,
            config.llm.promptVersion,
            spread(scope.map((t) => t.minRelevance)),
          )}
        />
      ),
      detail: (
        <>
          <Row label={text.reader}>
            <span className="cr-prose">{config.reader}</span>
          </Row>
          <Row label={text.criteria}>
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
              <span className="agent-muted">{text.pickTopic}</span>
            )}
          </Row>
        </>
      ),
    },
    cap: { params: <Parts parts={text.cap(scope.map((t) => t.maxItemsPerDay).join(" + "), config.queueWindowHours)} /> },
    queue: { params: text.queue },
    review: {
      params: (
        <Parts
          parts={
            config.approval.kind === "inbox"
              ? text.reviewInbox(config.approval.repo, config.approval.expireDays)
              : text.reviewFile(config.approval.expireDays)
          }
        />
      ),
    },
    deliver: {
      params: (
        <Parts
          parts={
            config.delivery.kind === "telegram" && config.delivery.chat
              ? text.deliverTelegram(config.delivery.chat, config.delivery.cadenceHours)
              : text.deliverFile(config.delivery.title, config.delivery.cadenceHours)
          }
        />
      ),
    },
  };
}

/**
 * A preset's config, one row per rail stage on a vertical spine. With a
 * topic picked, collect unfolds its keywords, GitHub topics and feeds,
 * and rank its include/exclude criteria. Preset feeds and the Telegram
 * "coming soon" channels unfold under collect.
 */
export default function ConfigSpine({
  config,
  topic,
  active,
  onPick,
  verdicts,
  text,
}: {
  config: ConfigView;
  topic: TopicFilter;
  active: StageKey | null;
  onPick: (key: StageKey) => void;
  verdicts: { count: number; rubric: string | null } | null;
  text: Text;
}) {
  const one = topic === "all" ? null : (config.topics.find((t) => t.slug === topic) ?? null);
  const rows = rowsFor(config, one, verdicts, text.spine);

  useEffect(() => {
    if (active) document.getElementById(`cr-stage-${active}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [active]);

  return (
    <ol className="cr-spine" aria-label={text.spine.label}>
      {STAGE_KEYS.map((key) => (
        <li key={key} id={`cr-stage-${key}`} className="cr-stage" data-active={active === key} onClick={() => onPick(key)}>
          <span className="cr-dot" aria-hidden="true" />
          <span className="cr-label">{text.stages[key]}</span>
          <span className="cr-params">{rows[key].params}</span>
          {rows[key].detail && <div className="cr-detail">{rows[key].detail}</div>}
        </li>
      ))}
    </ol>
  );
}
```

- [ ] **Step 10: `ControlRoom` and the page**

Replace `components/ControlRoom.tsx` with:

```tsx
"use client";

import { useMemo, useState } from "react";
import ConfigSpine from "@/components/ConfigSpine";
import ControlPulse from "@/components/ControlPulse";
import Outcomes from "@/components/Outcomes";
import PipelineRail from "@/components/PipelineRail";
import QueuePane from "@/components/QueuePane";
import TopicChips from "@/components/TopicChips";
import { useInbox } from "@/components/useInbox";
import { useJson } from "@/components/useJson";
import { STATUS_URL, parseAgentStatus } from "@/lib/agent-status";
import { configView } from "@/lib/config-view";
import { TEXT } from "@/lib/control-room-text";
import type { CronSchedule } from "@/lib/cron";
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
import { RUN_RESULT_URL, parseRunResult } from "@/lib/run-result";

const acceptQueue = (value: unknown): PendingQueue | null => (isPendingQueue(value) ? value : null);
const text = TEXT.en;

/**
 * Tony Scraponi's control room (/researcher/queue/). The config and the
 * rail come from the last run's run-result.json; the pulse from
 * status.json and the workflow's schedule (read at build time); the
 * queue from pending.json with the inbox's decisions; the outcomes from
 * state.json. Each is fetched on its own, so one failing source never
 * blanks the rest. The topic chips filter the rail, the queue, the spine
 * and the outcomes.
 */
export default function ControlRoom({ schedule }: { schedule: CronSchedule }) {
  const status = useJson(STATUS_URL, parseAgentStatus);
  const run = useJson(RUN_RESULT_URL, parseRunResult);
  const pending = useJson(PENDING_URL, acceptQueue);
  const state = useJson(STATE_URL, parseAgentState);
  const inbox = useInbox(pending.data, pending.loadedAt);

  const [topic, setTopic] = useState<TopicFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("waiting");
  const [selectedUrl, setSelectedUrl] = useState<string | null>(null);
  const [stage, setStage] = useState<StageKey | null>(null);

  const config = useMemo(() => (run.data ? configView(run.data.config) : null), [run.data]);
  const topics: { slug: string; name: string }[] = config?.topics ?? status.data?.topics ?? [];
  const slugs = topicSlugs(topics, topic);
  const items = pending.data?.items ?? [];
  const rows = visibleItems(items, inbox.decisions, topic, statusFilter);
  const topicNames = topic === "all" ? Object.fromEntries(topics.map((t) => [t.slug, t.name])) : null;
  const thresholds = (config?.topics ?? []).filter((t) => slugs.includes(t.slug)).map((t) => t.minRelevance);
  const threshold = thresholds.length ? Math.min(...thresholds) : Infinity;
  const cadence = schedule.hourStep !== null ? text.rail.every(schedule.hourStep) : text.rail.daily;
  const caption = run.data
    ? `${text.configPane.fromRun(new Date(run.data.run.at).toISOString().slice(11, 16))} · ${text.configPane.hint}`
    : text.configPane.hint;

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
          schedule={schedule}
          owner={{ signedIn: inbox.signedIn, error: inbox.error, onSignIn: inbox.signIn, onSignOut: inbox.signOut }}
        />
        <PipelineRail
          stages={buildStages(run.data, { queue: pending.data?.items ?? null, decisions: inbox.decisions }, topic, text.rail)}
          active={stage}
          onPick={(key) => setStage((current) => (current === key ? null : key))}
          titles={{ review: text.rail.reviewHint(cadence) }}
          text={text}
        />
        <TopicChips
          topics={topics}
          counts={topicCounts(items, topics.map((t) => t.slug))}
          topic={topic}
          onPick={setTopic}
          text={text.topics}
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
            text={text.queue}
          />
          <section className="cr-pane cr-flow" aria-label={text.configPane.region}>
            <header className="cr-pane-head">
              <span className="cr-label">{text.configPane.label}</span>
              <span className="agent-muted">{caption}</span>
            </header>
            <div className="cr-scroll">
              {config ? (
                <ConfigSpine
                  config={config}
                  topic={topic}
                  active={stage}
                  onPick={setStage}
                  verdicts={state.data ? topicVerdicts(state.data, slugs) : null}
                  text={text}
                />
              ) : (
                run.failed && <p className="agent-unavailable cr-empty">{text.configPane.unavailable}</p>
              )}
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

`app/researcher/queue/page.tsx` — import `loadSchedule` from `@/lib/agent-schedule` (not `loadAgentConfig`) and render:

```tsx
export default function QueuePage() {
  // The workflow's cron line, read from this repo at build time (static
  // export: once); everything else is fetched by the page.
  return <ControlRoom schedule={loadSchedule()} />;
}
```

- [ ] **Step 11: `CLAUDE.md`**

Replace the bullet that starts "**`/researcher/queue/` (Tony Scraponi's control room) reads the agent's config at build time.**" with:

```markdown
- **`/researcher/queue/` (Tony Scraponi's control room) reads the agent's
  last `run-result.json`** (`agent-data/agent/run-result.json`, written
  by every `agent-run.yml` run) client-side: config, rail stages, drop
  reasons and failures, through `lib/run-result.ts` (schema 2 only). Only
  the workflow's `cron:` line is read at build time
  (`lib/agent-schedule.ts`), and a missing one fails the build on purpose.
  Tony's config lives in `agent/presets/tony.yaml`. Renaming or removing a
  `run-result.json` field means bumping `agent/run_result.py`'s
  `SCHEMA_VERSION` and updating `lib/run-result.ts` in the same push.
```

In the "Verify site changes" `npm test` comment, replace `lib/agent-config` with `lib/agent-schedule, lib/run-result, lib/config-view, lib/control-room-text`.

In the "Verify agent changes" paragraph, replace the sentence about `test_control_room_contract.py` with: `` `agent/tests/test_control_room_contract.py` pins the workflow's `cron:` line, which the control room reads at build time. `` (Task 6 reduces that test to match.)

- [ ] **Step 12: Run everything**

Run: `npm test` then `npm run build`
Expected: all Vitest files pass; the build completes. `git grep -n "agent-config\|loadAgentConfig\|isAgentStatus" -- app components lib` prints nothing.

- [ ] **Step 13: Check the page against Tony's golden run**

`agent-data` has no `run-result.json` until push 1, so serve Tony's golden in its place. Run `npm run serve` (note the port it prints), then with headless Chrome (memory note "Headless browser checks without the Chrome extension": `chrome.exe --headless=new --remote-debugging-port=9333 --user-data-dir=<scratchpad>\chrome`) run a Node script with `node --experimental-websocket` that:

1. opens a CDP session to the page target, sends `Fetch.enable` with `patterns: [{ urlPattern: "*run-result.json*" }]`;
2. on `Fetch.requestPaused`, answers `Fetch.fulfillRequest` with `responseCode: 200`, headers `content-type: application/json` and `access-control-allow-origin: *`, and the base64 of `agent/tests/fixtures/tony/golden/real/run-result.json`;
3. sets `Emulation.setDeviceMetricsOverride` to 1440×900, navigates to `http://localhost:<port>/researcher/queue/`, waits 3 s;
4. evaluates `[...document.querySelectorAll('.cr-node')].map(n => n.innerText)` and `document.querySelector('.cr-flow .cr-pane-head').innerText`, and captures a screenshot to the scratchpad.

Expected: the nine rail nodes read the "sums every topic under all" table of Step 1 (live `pending.json`/decisions may change queue and review — those two come from the live files); the caption reads `as of last run 12:00 utc · a criteria change re-scores the topic`; the screenshot shows the spine with three topics and no layout overflow at 1440×900.

- [ ] **Step 14: Commit**

```bash
git add lib/pipeline-stages.ts lib/pipeline-stages.test.ts lib/agent-schedule.ts lib/agent-schedule.test.ts lib/cron.ts components/TopicChips.tsx components/PipelineRail.tsx components/QueuePane.tsx components/ConfigSpine.tsx components/ControlRoom.tsx app/researcher/queue/page.tsx package.json package-lock.json CLAUDE.md
git commit -m "Read the control room's config and rail from run-result.json"
```

(`git mv` already staged the deletions of `lib/agent-config.ts` and its test.)

---

### Task 6: Remove Tony's legacy config files

**Files:**
- Delete: `agent/defaults.yaml`, `agent/topics/` (three files)
- Modify: `agent/config.py` (keep `load_env` only), `agent/tests/test_preset.py` (delete the migration test and the `config` import), `agent/tests/test_control_room_contract.py`
- Modify docstrings: `agent/sources/base.py:34-35`, `agent/rank_cache.py:4`
- Modify: `docs/agent-plan.md:68-72,95`

**Interfaces:**
- Produces: `agent.config` exposes `load_env(path: Path) -> None` only.

- [ ] **Step 1: Delete the files and the loaders**

```bash
git rm agent/defaults.yaml agent/topics/ai-engineering.yaml agent/topics/tooling.yaml agent/topics/web-products.yaml
```

`agent/config.py` (whole file):

```python
"""Environment for local runs: agent/.env, loaded without overriding the
real environment. Tony's settings live in agent/presets/tony.yaml."""

from __future__ import annotations

import os
from pathlib import Path


def load_env(path: Path) -> None:
    """Load KEY=VALUE lines from path into os.environ, without overwriting
    variables the real environment already set."""
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip())
```

In `agent/tests/test_preset.py`, delete `test_tony_preset_matches_the_legacy_files_it_replaces` and the line `from agent import config`. (`test_rubric_hash_of_the_real_topics_is_pinned` in `test_summarize.py` keeps guarding the texts.)

- [ ] **Step 2: Reduce the contract test**

`agent/tests/test_control_room_contract.py` (whole file):

```python
"""The control room (/researcher/queue/) reads one thing from this repo at
site build time: the workflow's cron line (lib/agent-schedule.ts). It
must exist exactly once; a failure here would also fail the site build.
Everything else it shows comes from run-result.json (test_run_result.py)."""

import re
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]


def test_cron_line_in_the_workflow():
    workflow = REPO / ".github" / "workflows" / "agent-run.yml"
    matches = re.findall(r'^\s*- cron: "([^"]+)"$', workflow.read_text(encoding="utf-8"), flags=re.MULTILINE)
    assert matches == ["0 */4 * * *"]
```

- [ ] **Step 3: Docstrings and docs**

- `agent/sources/base.py` `TopicConfig` docstring: `"""One topic's fully merged configuration -- the preset's defaults with the topic's own settings on top (agent/preset.py)."""`
- `agent/rank_cache.py` line 4: replace `(the \`attention\` block in defaults.yaml)` with `(the preset's \`attention\` settings)`.
- `docs/agent-plan.md`: in "Presets and engine", replace "Tony is the default preset, `agent/presets/tony.yaml`, which still reads `defaults.yaml` and `topics/*.yaml`; its data stays in `agent/`." with "Tony is the default preset, `agent/presets/tony.yaml` — its topics, reader, LLM, approval and delivery in one file; its `data` section keeps its data in `agent/` and writes `status.json`." and replace "…the contract a future preset switcher reads." with "…the contract the control room and the demo section read (`docs/superpowers/specs/2026-10-06-preset-switcher-design.md`)."; in "Cadence & format", replace "(`delivery_cadence_hours` in `defaults.yaml`)" with "(`delivery.cadence_hours` in `presets/tony.yaml`)".
- `git grep -n "defaults.yaml\|agent/topics" -- agent CLAUDE.md docs/agent-plan.md docs/tony-scraponi-roadmap.md app lib components` — fix any remaining live reference (historical specs/plans under `docs/superpowers/` and `PROGRESS.md`'s history stay as written).

- [ ] **Step 4: Run both suites and the build**

Run: `agent/venv/Scripts/python -m pytest agent/tests -q`, `npm test`, `npm run build`
Expected: all pass; the goldens are unchanged (`git status --short agent/tests/fixtures` prints nothing).

- [ ] **Step 5: Commit**

```bash
git add -A agent/defaults.yaml agent/topics agent/config.py agent/tests/test_preset.py agent/tests/test_control_room_contract.py agent/sources/base.py agent/rank_cache.py docs/agent-plan.md
git commit -m "Remove Tony's legacy defaults.yaml and topics/"
```

---

### Task 7: Push 1 — regression check, docs, push, live check

**Files:**
- Modify: `PROGRESS.md` (D bullet, "How to resume"), `docs/tony-scraponi-roadmap.md` (D line, #7 note)

- [ ] **Step 1: Regression check against `origin/main`** (needs `DEEPSEEK_API_KEY`: copy its one line from `C:\A\polozov\agent\.env` into this worktree's `agent/.env`, which is git-ignored)

```bash
S=<scratchpad>/regress
mkdir -p $S/main $S/data-main $S/data-branch
git archive origin/main agent | tar -x -C $S/main
git show origin/agent-data:agent/state.json > $S/data-main/state.json
git show origin/agent-data:agent/pending.json > $S/data-main/pending.json
cp $S/data-main/*.json $S/data-branch/
cp agent/.env $S/main/agent/.env
# main's code: legacy preset, data in its own agent/ dir
cp $S/data-main/*.json $S/main/agent/
(cd $S/main && <worktree>/agent/venv/Scripts/python -m agent --preview > $S/preview-main.txt)
agent/venv/Scripts/python -m agent --preview --data-dir $S/data-branch > $S/preview-branch.txt
diff $S/preview-main.txt $S/preview-branch.txt
```

Expected: identical except rows DeepSeek scored fresh in both runs (their scores/summaries may differ). Then the same pair with `--dry-run` (main writes into `$S/main/agent/`, the branch into `$S/data-branch`): stdout identical except the branch's extra `Run result:` line and live HN points/stars; the two `state.json` files differ only in HN points/GitHub stars.

- [ ] **Step 2: Docs**

`PROGRESS.md`: under "Content Direction & Tony Scraponi", add a bullet **Content engine, sub-project D (preset switcher): push 1 shipped** — spec and plan paths, what push 1 contains (M1/M2 guard, Tony self-contained in `presets/tony.yaml`, `run-result.json` schema 2 published to `agent-data`, control room on `run-result.json`, legacy files removed), and that push 2 (demo section, Tasks 8–10) is next. Update #8's bullet: M1 and M2 fixed (D, Task 1). Update the status line and "How to resume".

`docs/tony-scraponi-roadmap.md`: in the D line add "Push 1 shipped (Tony on `run-result.json`); push 2 is the demo section."; replace the paragraph starting "Item 7 above becomes a topic-scoped `rss` entry" with: "Item 7 above is now a `rss:` list under Web Products' `sources` in `agent/presets/tony.yaml`; the control room shows it with no site change."

Commit: `git add PROGRESS.md docs/tony-scraponi-roadmap.md && git commit -m "Reconcile status docs with D's push 1"`

- [ ] **Step 3: Ask Artem for the go-ahead to push**

Show him: the commits since `origin/main` (`git log --oneline origin/main..HEAD`), the regression check result, and the reminder that the push changes the code the next scheduled agent run executes. **Do not push without an explicit yes.**

- [ ] **Step 4: Push and dispatch the agent at once**

```bash
git fetch origin main
git log --oneline HEAD..origin/main   # must print nothing; if it doesn't, merge origin/main first and re-run the suites
git push origin HEAD:main
gh workflow run agent-run.yml --ref main
```

(Flaky TLS on this machine: retry `gh`/`git` with `||` chains, not loops.)

- [ ] **Step 5: Live check** (when both the deploy and the agent run are green: `gh run list --limit 4`)

```bash
git fetch origin agent-data
git show origin/agent-data:agent/run-result.json | agent/venv/Scripts/python -c "import json,sys; r=json.load(sys.stdin); print(r['schema_version'], r['failures'], [t['slug'] for t in r['config']['topics']])"
mkdir -p <scratchpad>/live
git show origin/agent-data:agent/state.json > <scratchpad>/live/state.json
agent/venv/Scripts/python -m agent report --days 2 --data-dir <scratchpad>/live
```

Expected: `2 [] ['ai-engineering', 'tooling', 'web-products']`; the report's scored-per-day line for today grows only by what a normal run scores (no re-scoring burst). Then headless at 1440×900: `https://hpnssflw.github.io/researcher/queue/` — rail numbers equal the summed `stages`, the caption reads "as of last run …", three topic chips; `https://hpnssflw.github.io/` — the Tony teaser shows its proof line.

- [ ] **Step 6: Record the live check**

Add the run ids and results to D's bullet in `PROGRESS.md`; commit `"Record D push 1's live check"` and push it (docs only — no agent code changes, so no go-ahead needed beyond Step 3's).

---

## Push 2 — the demo section

### Task 8: `lib/digest.ts` — the digest, as the engine builds it

**Files:**
- Create: `lib/digest.ts`, `lib/digest.test.ts`

**Interfaces:**
- Consumes: `groupByTopic`, `PendingItem` (`lib/pending-queue.ts`); `Language`, `RunResult` (`lib/run-result.ts`).
- Produces: `COUNT_PHRASES: Record<Language, (total: number) => string>`; `interface DigestBlocks { title: string; count: string; topics: { name: string; items: PendingItem[] }[] }`; `digestBlocks(items: PendingItem[], title: string, language: Language): DigestBlocks`; `recordedDigest(run1: RunResult): DigestBlocks`; `digestHtml(digest: DigestBlocks): string`.

- [ ] **Step 1: Write the failing tests**

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { digestBlocks, digestHtml, recordedDigest } from "./digest";
import type { PendingItem } from "./pending-queue";
import { parseRunResult } from "./run-result";

function read(slug: string, file: string): string {
  // Fixtures may check out with CRLF (core.autocrlf); the engine writes LF.
  return readFileSync(join(process.cwd(), "agent", "tests", "fixtures", slug, "golden", file), "utf8").replace(/\r\n/g, "\n");
}

function item(url: string, topicName: string, score: number, title = url, summary = "s"): PendingItem {
  return { url, title, source: "rss", topic: topicName, topic_name: topicName, summary, score, pending_since: "2026-10-06T06:00:00+00:00" };
}

describe("digestHtml", () => {
  it.each(["newsroom-demo", "agro-demo"])("reproduces %s's sent digest byte for byte", (slug) => {
    const run1 = parseRunResult(JSON.parse(read(slug, "run1.json")));
    expect(run1).not.toBeNull();
    expect(`${digestHtml(recordedDigest(run1!))}\n`).toBe(read(slug, "outbox.html"));
  });

  it("escapes like Python's html.escape", () => {
    const html = digestHtml(digestBlocks([item('https://x.example/?a=1&b="2"', "T<1>", 5, `<a & "b">`, "it's")], "T&T", "en"));
    expect(html).toBe(
      "<b>T&amp;T — 1 item</b>\n\n<b>T&lt;1&gt;</b>\n" +
        '• <a href="https://x.example/?a=1&amp;b=&quot;2&quot;">&lt;a &amp; &quot;b&quot;&gt;</a>\nit&#x27;s',
    );
  });
});

describe("digestBlocks", () => {
  it("groups by topic name in first-appearance order, highest score first", () => {
    const blocks = digestBlocks([item("a", "B", 6), item("b", "A", 9), item("c", "B", 8)], "Digest", "en");
    expect(blocks.topics.map((t) => [t.name, t.items.map((i) => i.url)])).toEqual([
      ["B", ["c", "a"]],
      ["A", ["b"]],
    ]);
  });

  it("counts in the preset's language", () => {
    expect(digestBlocks([item("a", "A", 1), item("b", "A", 1)], "x", "en").count).toBe("2 items");
    expect(digestBlocks([item("a", "A", 1)], "x", "en").count).toBe("1 item");
    expect(digestBlocks([item("a", "A", 1), item("b", "A", 1), item("c", "A", 1)], "x", "ru").count).toBe("материалов: 3");
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run lib/digest.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `lib/digest.ts`**

```ts
import { type PendingItem, groupByTopic } from "./pending-queue";
import type { Language, RunResult } from "./run-result";

// The digest the engine sends, mirrored for the demo section: approved
// items grouped as agent/pending.py's group_by_topic does, under
// agent/digest.py's header. digestHtml is digest.build's one-message
// output, pinned to the demos' outbox.html by lib/digest.test.ts; the
// split at Telegram's 4096 characters isn't mirrored (a demo digest never
// reaches it). The page renders DigestBlocks, never the HTML.

/** agent/digest.py's COUNT_PHRASES. */
export const COUNT_PHRASES: Record<Language, (total: number) => string> = {
  en: (total) => `${total} item${total === 1 ? "" : "s"}`,
  ru: (total) => `материалов: ${total}`,
};

export interface DigestBlocks {
  title: string;
  count: string;
  topics: { name: string; items: PendingItem[] }[];
}

export function digestBlocks(items: PendingItem[], title: string, language: Language): DigestBlocks {
  return {
    title,
    count: COUNT_PHRASES[language](items.length),
    topics: Object.entries(groupByTopic({ last_email_at: null, items })).map(([name, group]) => ({ name, items: group })),
  };
}

/** The digest a demo's second run sent: its first run's queue items that
 * the preset's decisions file approves, in queue order. */
export function recordedDigest(run1: RunResult): DigestBlocks {
  return digestBlocks(
    run1.queue.items.filter((i) => i.decision === "approve"),
    run1.config.delivery.title,
    run1.preset.language,
  );
}

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#x27;" };

/** Python's html.escape(text) (quote=True). */
function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => ESCAPES[char]);
}

export function digestHtml(digest: DigestBlocks): string {
  const header = `<b>${escapeHtml(digest.title)} — ${digest.count}</b>`;
  const topics = digest.topics.map(({ name, items }) =>
    [
      `<b>${escapeHtml(name)}</b>`,
      ...items.map((i) => `• <a href="${escapeHtml(i.url)}">${escapeHtml(i.title)}</a>\n${escapeHtml(i.summary)}`),
    ].join("\n"),
  );
  return [header, ...topics].join("\n\n");
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run lib/digest.test.ts`
Expected: PASS. If a demo digest differs, compare `digestHtml(...)` with `outbox.html` line by line — topic order and score ties are the usual suspects; the engine's order is the source of truth.

- [ ] **Step 5: Commit**

```bash
git add lib/digest.ts lib/digest.test.ts
git commit -m "Mirror the engine's digest for the demo section"
```

---

### Task 9: The demo section

**Files:**
- Create: `lib/demo-presets.ts`, `lib/demo-presets.test.ts`
- Create: `app/researcher/demo/[slug]/page.tsx`
- Create: `components/DemoRoom.tsx`, `components/DigestPanel.tsx`
- Modify: `app/globals.css` (a demo block after the control room's rules)
- Modify: `docs/superpowers/specs/2026-10-06-preset-switcher-design.md` (§ 4: the chips don't filter the digest — see Step 6)

**Interfaces:**
- Consumes: everything from Tasks 3–5 and 8; `EMPTY_DECISIONS`, `setDecision`, `itemStatus`, `Decisions`, `Decision` (`lib/inbox.ts`); `nextSelection`, `resolveSelection`, `statusCounts`, `topicCounts`, `visibleItems`, `StatusFilter` (`lib/queue-view.ts`).
- Produces: `DEMO_SLUGS: string[]`; `interface Demo { slug: string; run1: RunResult; run2: RunResult }`; `interface DemoLink { slug: string; name: string }`; `loadDemo(slug: string, root?: string): Demo`; `demoLinks(root?: string): DemoLink[]`; components `DemoRoom({ demo, presets })`, `DigestPanel({ digest, empty })`.

- [ ] **Step 1: Read the Next.js guides this task relies on**

Read the pages on `generateStaticParams`, `dynamicParams` and the Metadata API's `robots` field under `node_modules/next/dist/docs/` (find them with `ls node_modules/next/dist/docs` / `grep -ril generateStaticParams node_modules/next/dist/docs | head`). Follow them where they differ from `app/lab/[slug]/page.tsx`.

- [ ] **Step 2: Write the failing registry test**

`lib/demo-presets.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { DEMO_SLUGS, demoLinks, loadDemo } from "./demo-presets";

describe("demo presets", () => {
  it.each(DEMO_SLUGS)("loads %s's two recorded runs", (slug) => {
    const demo = loadDemo(slug);
    expect(demo.run1.preset.slug).toBe(slug);
    expect(demo.run2.preset.slug).toBe(slug);
    expect(demo.run1.preset.language).toBe("ru");
    expect(demo.run2.delivery.sent_items).toBe(3);
  });

  it("names them for the switcher", () => {
    expect(demoLinks()).toEqual([
      { slug: "newsroom-demo", name: "Редакция (демо)" },
      { slug: "agro-demo", name: "Агродистрибутор (демо)" },
    ]);
  });

  it("refuses a slug it doesn't list", () => {
    expect(() => loadDemo("tony")).toThrow(/not a demo preset/);
  });
});
```

Run: `npx vitest run lib/demo-presets.test.ts` — Expected: FAIL (module not found).

- [ ] **Step 3: Implement `lib/demo-presets.ts`**

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { RUN_RESULT_SCHEMA, type RunResult, parseRunResult } from "./run-result";

// The demo section's presets (/researcher/demo/<slug>/), read at build
// time from their committed goldens — run1.json and run2.json, recorded by
// agent/tests/test_presets_offline.py — so a re-recorded golden updates
// the demo. A golden that doesn't parse fails the build. Server-only
// (node:fs): DemoRoom imports the types alone.

export const DEMO_SLUGS = ["newsroom-demo", "agro-demo"];

export interface Demo {
  slug: string;
  run1: RunResult;
  run2: RunResult;
}

export interface DemoLink {
  slug: string;
  name: string;
}

function readRun(root: string, slug: string, file: string): RunResult {
  const path = join(root, "agent", "tests", "fixtures", slug, "golden", file);
  const run = parseRunResult(JSON.parse(readFileSync(path, "utf8")));
  if (!run) throw new Error(`demo ${slug}: ${file} is not a schema-${RUN_RESULT_SCHEMA} run result`);
  return run;
}

export function loadDemo(slug: string, root: string = process.cwd()): Demo {
  if (!DEMO_SLUGS.includes(slug)) throw new Error(`${slug} is not a demo preset (lib/demo-presets.ts)`);
  return { slug, run1: readRun(root, slug, "run1.json"), run2: readRun(root, slug, "run2.json") };
}

export function demoLinks(root: string = process.cwd()): DemoLink[] {
  return DEMO_SLUGS.map((slug) => ({ slug, name: loadDemo(slug, root).run1.preset.name }));
}
```

Run: `npx vitest run lib/demo-presets.test.ts` — Expected: PASS.

- [ ] **Step 4: `components/DigestPanel.tsx`**

```tsx
import type { DigestBlocks } from "@/lib/digest";

/** A digest as the editor gets it in Telegram: bold header and topic
 * names, each item a linked title over its one-line summary. */
export default function DigestPanel({ digest, empty }: { digest: DigestBlocks; empty: string }) {
  if (digest.topics.length === 0) return <p className="agent-muted cr-digest-empty">{empty}</p>;
  return (
    <article className="cr-digest">
      <p>
        <b>
          {digest.title} — {digest.count}
        </b>
      </p>
      {digest.topics.map((topic) => (
        <section key={topic.name}>
          <p>
            <b>{topic.name}</b>
          </p>
          <ul>
            {topic.items.map((item) => (
              <li key={item.url}>
                •{" "}
                <a href={item.url} target="_blank" rel="noreferrer">
                  {item.title}
                </a>
                <br />
                {item.summary}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </article>
  );
}
```

- [ ] **Step 5: `components/DemoRoom.tsx`**

```tsx
"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import ConfigSpine from "@/components/ConfigSpine";
import DigestPanel from "@/components/DigestPanel";
import PipelineRail from "@/components/PipelineRail";
import QueuePane from "@/components/QueuePane";
import TopicChips from "@/components/TopicChips";
import { configView } from "@/lib/config-view";
import { TEXT } from "@/lib/control-room-text";
import type { Demo, DemoLink } from "@/lib/demo-presets";
import { digestBlocks, recordedDigest } from "@/lib/digest";
import { type Decision, type Decisions, EMPTY_DECISIONS, itemStatus, setDecision } from "@/lib/inbox";
import type { PendingItem } from "@/lib/pending-queue";
import { type StageKey, type TopicFilter, buildStages } from "@/lib/pipeline-stages";
import {
  type StatusFilter,
  nextSelection,
  resolveSelection,
  statusCounts,
  topicCounts,
  visibleItems,
} from "@/lib/queue-view";
import type { RunResult } from "@/lib/run-result";

/** A run's own decisions on its queue items, as the queue pane reads them. */
function recordedDecisions(run: RunResult): Decisions {
  const decisions: Decisions["decisions"] = {};
  for (const item of run.queue.items) {
    if (item.decision) decisions[item.url] = { decision: item.decision, at: run.run.at };
  }
  return { version: 1, decisions };
}

/**
 * A demo preset (/researcher/demo/<slug>/): the control room's shell over
 * the engine's two recorded offline runs, in the preset's language. Run 1
 * is a sandbox — the visitor approves and rejects, the review stage and
 * the digest preview follow, nothing is saved; run 2 is what the engine
 * did with the preset's own decisions, and the digest it sent.
 */
export default function DemoRoom({ demo, presets }: { demo: Demo; presets: DemoLink[] }) {
  const { run1, run2 } = demo;
  const language = run1.preset.language;
  const text = TEXT[language];

  const [runNo, setRunNo] = useState<1 | 2>(1);
  const [sandbox, setSandbox] = useState<Decisions>(EMPTY_DECISIONS);
  const [topic, setTopic] = useState<TopicFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("waiting");
  const [selectedUrl, setSelectedUrl] = useState<string | null>(null);
  const [stage, setStage] = useState<StageKey | null>(null);

  const run = runNo === 1 ? run1 : run2;
  const config = useMemo(() => configView(run.config), [run]);
  const recorded = useMemo(() => recordedDecisions(run2), [run2]);
  const decisions = runNo === 1 ? sandbox : recorded;
  const items: PendingItem[] = run.queue.items;
  const slugs = config.topics.map((t) => t.slug);
  const rows = visibleItems(items, decisions, topic, statusFilter);
  const digest =
    runNo === 1
      ? digestBlocks(
          run1.queue.items.filter((i) => itemStatus(sandbox, i.url) === "approved"),
          run1.config.delivery.title,
          language,
        )
      : recordedDigest(run1);

  function pickRun(next: 1 | 2) {
    setRunNo(next);
    setStatusFilter(next === 1 ? "waiting" : "all");
    setSelectedUrl(null);
  }

  function decide(item: PendingItem, decision: Decision | null) {
    setSelectedUrl(nextSelection(rows, item.url));
    setSandbox((current) => setDecision(current, item.url, decision, new Date()));
  }

  return (
    <section className="cr" lang={language}>
      <div className="wrap cr-wrap">
        <header className="cr-pulse cr-demo-head">
          <p className="cr-pulse-id">
            <span className="tony-name">{run1.preset.name}</span>
            <span className="agent-muted">{text.demo.tag(run1.run.at.slice(0, 10))}</span>
          </p>
          <div className="cr-runs">
            <div className="cr-chips" role="group" aria-label={text.demo.runs}>
              {([1, 2] as const).map((n) => (
                <button key={n} type="button" className="cr-chip" aria-pressed={runNo === n} onClick={() => pickRun(n)}>
                  {n === 1 ? text.demo.run1 : text.demo.run2}
                </button>
              ))}
            </div>
            {runNo === 1 && (
              <p className="cr-sandbox agent-muted">
                {text.demo.sandbox} ·{" "}
                <button type="button" className="cr-chip" onClick={() => setSandbox(EMPTY_DECISIONS)}>
                  {text.queue.reset}
                </button>
              </p>
            )}
          </div>
          <nav className="cr-demo-nav" aria-label={text.demo.switcher}>
            {presets.map((preset) => (
              <Link
                key={preset.slug}
                href={`/researcher/demo/${preset.slug}/`}
                aria-current={preset.slug === demo.slug ? "page" : undefined}
              >
                {preset.name}
              </Link>
            ))}
            <Link href="/researcher/queue/">{text.demo.tonyLive}</Link>
          </nav>
        </header>
        <PipelineRail
          stages={buildStages(run, { queue: null, decisions: runNo === 1 ? sandbox : null }, topic, text.rail)}
          active={stage}
          onPick={(key) => setStage((current) => (current === key ? null : key))}
          titles={{}}
          text={text}
        />
        <TopicChips topics={config.topics} counts={topicCounts(items, slugs)} topic={topic} onPick={setTopic} text={text.topics} />
        <div className="cr-grid">
          <QueuePane
            rows={rows}
            counts={statusCounts(items, decisions, topic)}
            statusFilter={statusFilter}
            onStatusFilter={setStatusFilter}
            selected={resolveSelection(rows, selectedUrl)}
            onSelect={setSelectedUrl}
            decisions={decisions}
            topicNames={topic === "all" ? Object.fromEntries(config.topics.map((t) => [t.slug, t.name])) : null}
            canDecide={runNo === 1}
            busy={false}
            loaded
            failed={false}
            onDecide={decide}
            text={text.queue}
          />
          <section className="cr-pane cr-flow" aria-label={text.demo.region}>
            <header className="cr-pane-head">
              <span className="cr-label">{text.demo.digest}</span>
              <span className="agent-muted">{runNo === 1 ? text.demo.digestPreview : text.demo.digestSent}</span>
            </header>
            <div className="cr-scroll">
              <DigestPanel digest={digest} empty={text.demo.digestEmpty} />
              <p className="cr-label cr-demo-config">{text.configPane.label}</p>
              <ConfigSpine config={config} topic={topic} active={stage} onPick={setStage} verdicts={null} text={text} />
            </div>
          </section>
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 6: The route, and the spec's digest line**

`app/researcher/demo/[slug]/page.tsx`:

```tsx
import type { Metadata } from "next";
import DemoRoom from "@/components/DemoRoom";
import { DEMO_SLUGS, demoLinks, loadDemo } from "@/lib/demo-presets";

export function generateStaticParams() {
  return DEMO_SLUGS.map((slug) => ({ slug }));
}

export const dynamicParams = false;

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  // Unlisted: Artem sends the link to prospective clients; nothing links
  // here and search engines are asked to stay out.
  return { title: loadDemo(slug).run1.preset.name, robots: { index: false, follow: false } };
}

export default async function DemoPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  // Read from the committed demo goldens at build time (static export: once).
  return <DemoRoom demo={loadDemo(slug)} presets={demoLinks()} />;
}
```

In the spec, § 4 "Topic chips", change "filter the rail, the queue, the config and the digest." to "filter the rail, the queue and the config. The digest stays whole: it is one message, and a filtered one was never sent."

- [ ] **Step 7: Styles** — append to `app/globals.css`, after the control room's last rule block:

```css
/* --- Demo presets (/researcher/demo/<slug>/) -------------------------
   The control room's shell over an engine preset's two recorded runs:
   .cr-demo-head takes the pulse's place (name and tag, run toggle,
   preset switcher); the digest, styled like the Telegram message it is,
   sits above the config in the right pane. */
.cr-demo-head {
  grid-template-columns: auto minmax(0, 1fr) auto;
}

.cr-runs {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.cr-sandbox {
  margin: 0;
}

.cr-demo-nav {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 4px 16px;
  text-transform: lowercase;
}

.cr-demo-nav a {
  color: var(--muted);
}

.cr-demo-nav a:hover,
.cr-demo-nav a[aria-current="page"] {
  color: var(--text-strong);
}

.cr-digest {
  margin: 0 0 16px;
  padding: 10px 12px;
  border-left: 2px solid var(--agent-lime);
  background: #ffffff08;
  font-family: var(--font-sans);
  font-size: var(--fs-xs);
  line-height: 1.5;
  color: var(--text);
}

.cr-digest p {
  margin: 0 0 6px;
}

.cr-digest ul {
  list-style: none;
  margin: 0 0 10px;
  padding: 0;
}

.cr-digest li {
  margin: 0 0 6px;
}

.cr-digest a {
  color: var(--text-strong);
}

.cr-digest-empty {
  margin: 0 0 16px;
}

.cr-demo-config {
  margin: 0 0 6px;
}

@media (max-width: 899px) {
  .cr-demo-head {
    grid-template-columns: minmax(0, 1fr);
  }

  .cr-demo-nav {
    justify-content: flex-start;
  }
}
```

- [ ] **Step 8: Run the suites and the build**

Run: `npm test` then `npm run build`
Expected: all pass; the build lists `/researcher/demo/newsroom-demo` and `/researcher/demo/agro-demo` as static pages; `out/researcher/demo/newsroom-demo/index.html` exists and contains `<meta name="robots" content="noindex, nofollow"`; `ls out/researcher/demo` shows the two slugs only (no `index.html`).

- [ ] **Step 9: Look at it**

`npm run serve`, then headless Chrome (as in Task 5 Step 13, no interception needed) for each demo at 1440×900 and 390×844:

1. screenshot run 1 as loaded: Russian labels (`сбор`, `оценка`, `ждут`…), the digest panel's empty state, the spine's preset feeds and Telegram channels under `сбор` (click the `сбор` stage first: `document.querySelector('#cr-stage-collect').click()`);
2. press `a` twice (`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }))`), then read `.cr-digest` text and the review node: the digest shows two items and the header `… — материалов: 2`, review shows `2`;
3. click the run-2 chip: the digest equals the recorded one (three items), the queue is read-only (no approve buttons);
4. no horizontal scroll at 390 px (`document.documentElement.scrollWidth <= 390`).

Then confirm nothing links to the section: `grep -rl "/researcher/demo" out --include=*.html | grep -v "^out/researcher/demo/"` prints nothing.

- [ ] **Step 10: Commit**

```bash
git add lib/demo-presets.ts lib/demo-presets.test.ts "app/researcher/demo/[slug]/page.tsx" components/DemoRoom.tsx components/DigestPanel.tsx app/globals.css docs/superpowers/specs/2026-10-06-preset-switcher-design.md
git commit -m "Add the unlisted demo section for the engine's demo presets"
```

---

### Task 10: Push 2 — docs, push, live check

**Files:**
- Modify: `CLAUDE.md`, `PROGRESS.md`, `docs/tony-scraponi-roadmap.md`

- [ ] **Step 1: Docs**

`CLAUDE.md` — after the control-room bullet, add:

```markdown
- **`/researcher/demo/<slug>/` is an unlisted demo of the engine's demo
  presets** (`lib/demo-presets.ts`: `newsroom-demo`, `agro-demo`), built
  at build time from their committed goldens
  (`agent/tests/fixtures/<slug>/golden/run1.json`, `run2.json`), in the
  preset's language (`lib/control-room-text.ts`). `noindex`, and no page
  links to it — Artem sends the link. Don't add a link to it from the
  site without asking.
```

and add `lib/digest, lib/demo-presets` to the `npm test` comment.

`PROGRESS.md` — D's bullet: push 2 contents (demo section, sandbox, digest mirror); the status line ("sub-projects #1-#6, #8 and content engine A, D shipped"); "How to resume": next in the engine line are B (stories), C (Telegram approval buttons), and #7 (a `rss:` entry for Web Products in `tony.yaml`, once #6's watch numbers are in).

`docs/tony-scraponi-roadmap.md` — D line: "Shipped (push 1: Tony on `run-result.json`; push 2: the demo section)."

Commit: `git add CLAUDE.md PROGRESS.md docs/tony-scraponi-roadmap.md && git commit -m "Reconcile status docs with D's push 2"`

- [ ] **Step 2: Ask Artem for the go-ahead** — show `git log --oneline origin/main..HEAD` and the two demo screenshots (1440 px) from Task 9 Step 9. Push 2 holds no agent code, but it still goes to `main`; **do not push without an explicit yes.**

- [ ] **Step 3: Push**

```bash
git fetch origin main
git log --oneline HEAD..origin/main   # must print nothing; else merge origin/main and re-run the suites
git push origin HEAD:main
```

- [ ] **Step 4: Live check** (when the deploy run is green)

Headless: `https://hpnssflw.github.io/researcher/demo/newsroom-demo/` and `/agro-demo/` render in Russian (repeat Task 9 Step 9's points 1–3 on one of them); the page source has `noindex, nofollow`; `https://hpnssflw.github.io/researcher/queue/` still renders as after push 1. Record the deploy run id in D's `PROGRESS.md` bullet, commit `"Record D push 2's live check"`, push.

- [ ] **Step 5: Hand off**

Remind Artem to `/clear`, and give him the next session's prompt: session per CLAUDE.md; Content Direction & Tony Scraponi; D shipped; check #6's 3-day watch (`python -m agent report` against `agent-data`'s `state.json`, window ended 2026-10-08 ~18:22Z) and decide #7 (Web Products RSS, now a `rss:` entry in `agent/presets/tony.yaml`); alternatives B (stories), C (Telegram approval buttons); brainstorming → spec → plan before any code.
