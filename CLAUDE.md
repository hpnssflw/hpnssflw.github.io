# CLAUDE.md

Artem Polozov's personal site (Next.js App Router, TypeScript, statically
exported: landing page, LAB blog, RESEARCHER section) plus a
research/scraping agent that feeds his own writing. One repo, two
initiatives — see `PROGRESS.md` for status of each.

## Session start protocol

1. Read `PROGRESS.md` for current status of the site, the agent, and the
   Content Direction & Tony Scraponi initiative.
2. If the work is on the agent, also read `docs/agent-plan.md`.
3. If the work is on the Content Direction & Tony Scraponi initiative,
   also read `docs/tony-scraponi-roadmap.md` — it lists that
   initiative's sub-projects in order. Confirm with the user that the
   sub-project `PROGRESS.md` names as active is still the right one,
   then run it through brainstorming → writing-plans → implementation
   (superpowers skills) before writing any of its code. If that
   sub-project is Blog content & direction, also read
   `docs/lab-direction.md` before writing or editing any LAB post.
4. State where things stand and confirm the next task with the user
   before writing any code.

## Conventions actually used in this repo

- **The site is a Next.js app** (App Router, TypeScript) that is
  **statically exported** (`output: 'export'` in `next.config.mjs`) and
  served by GitHub Pages via `.github/workflows/deploy.yml` (build type:
  "GitHub Actions"). Every push to `main` rebuilds and redeploys. The
  design history is in `docs/superpowers/specs/` and
  `docs/superpowers/plans/`; the migration itself is
  `2026-09-09-nextjs-migration-design.md`.
- Because it's a static export, **do not use features that need a Node
  server**: no dynamic route without `generateStaticParams` +
  `dynamicParams = false`, no Route Handlers that read `Request`, no
  `redirects`/`rewrites`/`headers` in config, no Server Actions. Client
  data fetching (the agent widget) is fine.
- **`/now/`'s data is written from Artem's machine, not by Actions.**
  `scripts/presence/run.mjs` (Task Scheduler task `polozov-presence`,
  every 5 min, installed by `scripts/presence/install.ps1`) force-pushes
  a one-commit orphan branch `presence-data` from its own clone under
  `%LOCALAPPDATA%\polozov-presence\`, with two files the page reads
  client-side: `presence.json` (Claude Code presence) and
  `playlists.json` (Yandex Music playlists — the API answers GitHub's
  runners 451 and browsers 403, so only his machine can fetch them).
  Both have fixed allowlists in `scripts/presence/collect.mjs`
  (`buildPresence`, `trimPlaylists`, leak-tested, re-checked by
  `assertPublishable` before every publish) — never add a key that
  could carry a path, project name, branch, prompt text, or Yandex account
  details. Nothing on `/now/` is fetched at build time. The task runs only
  while Artem is logged on (LogonType Interactive), from a pinned copy in
  `%LOCALAPPDATA%\polozov-presence\bin\` with node's path fixed at install:
  re-run `install.ps1` after changing `scripts/presence/*.mjs` or after a
  Node upgrade/move. In `run.log`, `claude agents failed` explains a widget
  that never shows `working`; `yandex music failed`, stale playlists.
- **Two home blocks are fetched at build time**, and `deploy.yml`
  rebuilds every 6 hours to keep them recent; either one failing is
  skipped and the build still succeeds. `components/GitHubGrid.tsx` asks
  GitHub's GraphQL API for the public contribution calendar
  (`lib/github-calendar.ts`) — it needs a token: `deploy.yml` passes
  Actions' `GITHUB_TOKEN`, and locally start `npm run dev` /
  `npm run build` with `GITHUB_TOKEN` set (e.g. from `gh auth token`) to
  see it. The home LAB card mixes in the agent channel's five latest
  Telegram posts (`app/page.tsx` → `lib/telegram-post.ts`,
  `lib/home-feed.ts`), read from its public preview page,
  `t.me/s/hypnosisflow` — no token, but t.me may be unreachable from a
  dev machine without a VPN.
- **`/researcher/queue/` (Tony Scraponi's control room) reads the agent's
  last `run-result.json`** (`agent-data/agent/run-result.json`, written
  by every `agent-run.yml` run) client-side: config, rail stages, drop
  reasons and failures, through `lib/run-result.ts` (schema 2 only). Only
  the workflow's `cron:` line is read at build time
  (`lib/agent-schedule.ts`; the home agent widget reads it the same way,
  for its countdown), and a missing one fails the build on purpose.
  Tony's config lives in `agent/presets/tony.yaml`. Renaming or removing a
  `run-result.json` field means bumping `agent/run_result.py`'s
  `SCHEMA_VERSION` and updating `lib/run-result.ts` in the same push.
  `status.json` is held to `lib/agent-status.ts`'s `AgentStatus` type at
  run time: `parseAgentStatus` checks every field the type declares, so
  an agent change that renames, removes or retypes one (or adds a
  `recent_events` verdict) must update that type and guard in the same
  change, or every agent widget shows "unavailable". `npm test` parses
  the agent's golden `real/status.json` with `parseAgentStatus`
  (`lib/agent-status.test.ts`), so a drift fails there — once the
  golden is re-recorded.
- **The Tony Scraponi inbox's decisions live in a separate public repo,
  `hpnssflw/tony-inbox`** (`decisions.json` on its `main`). The site's
  `/researcher/queue/` owner mode is its only writer, with a
  fine-grained PAT scoped to that repo alone and kept in the owner's
  `localStorage`; the agent only reads it at the start of each run and
  delivers approved items only (rejected/expired → `dismissed` in
  `state.json`). Never make the agent write `decisions.json`, and never
  give the site a token for this repo (`hpnssflw.github.io`): one that
  can push here can change agent code that runs with the Telegram and
  DeepSeek secrets. If the agent side is ever reverted, keep
  `StateEntry.dismissed` (or strip the `dismissed` key from `state.json`
  on `agent-data` first): after the first run of the inbox code every
  entry carries that key, and the older `StateEntry(**value)` raises
  `TypeError` on it.
  The same goes for `StateEntry.ranks` (sub-project #6): once the
  topic-quality code has run, every entry carries `ranks`, so code from
  before #6 can't load `state.json` until that key is stripped.
- **The GitHub remote is `hpnssflw/hpnssflw.github.io`** (a user site —
  served at the domain root, so no `basePath`). Work happens directly on
  `main` — no feature branches, no PRs — unless the user explicitly asks
  for that workflow. `gh` is a normal part of managing Pages settings,
  Actions, and secrets for both the site deploy and the agent workflow.
- Commit in small, focused commits. Stage only the files relevant to the
  change — this repo has a habitually-uncommitted local
  `.claude/settings.local.json`; never stage it.
- **Agent work: commit automatically per task, no extra confirmation
  needed.** When executing a task from
  `docs/superpowers/plans/2026-08-12-research-agent.md`, after its
  verification steps pass, make two commits without asking first: (1) the
  task's own commit, staging only the files that task's plan section
  lists, using the commit message the plan gives; (2) a small follow-up
  commit updating `PROGRESS.md`'s status line and "How to resume" section
  to reflect the task just shipped and name the next task, message
  `"Reconcile status docs with Task N shipping"`. This does not relax the
  rule below it — confirm the *next* task with the user before writing any
  of its code; only the commits for the task just finished are automatic.
- **Clean context after each micro-task, across all three initiatives**
  (site, agent, Content Direction & Tony Scraponi) — not just the
  agent-specific auto-commit rule above. Once a micro-task (a single
  numbered task from an implementation plan, or an equally small
  discrete unit of work) is verified and committed, stop and hand off:
  remind the user to run `/clear`, then give them a short, self-
  contained prompt for the next task — naming the plan file and task,
  and any state a fresh session needs to pick up cleanly. That handoff
  prompt should route the next session back through the session-start
  protocol and the brainstorm-before-implement rule, not skip them.
- **Verify site changes** by building and serving the export, plus the
  test suite:
  ```
  npm run dev             # iterate locally (http://localhost:3000)
  npm run build           # static export into out/
  npm run serve           # serve out/ exactly as Pages will
  npm test                # Vitest — lib/posts, lib/agent-status, lib/pending-queue,
                          # lib/topics, lib/yandex-music, lib/claude-presence,
                          # lib/now-format, lib/github-calendar, lib/telegram-post, lib/home-feed,
                          # lib/cron, lib/agent-schedule, lib/run-result, lib/config-view,
                          # lib/control-room-text, lib/pipeline-stages,
                          # lib/outcomes, lib/queue-view, scripts/presence
  ```
  (`next dev` occasionally hangs the TCP handshake in this environment;
  if a port won't come up, kill node and retry, or verify against
  `npm run build` + `npm run serve` instead.)
- **Verify agent changes** with pytest (Python 3.12 in `agent/venv`:
  `py -3.12 -m venv agent/venv`, then
  `agent/venv/Scripts/python -m pip install -r agent/requirements-dev.txt`):
  ```
  agent/venv/Scripts/python -m pytest agent/tests -q
  ```
  `agent/tests/fixtures/tony/golden/` pins Tony's real run, preview and
  dry run byte for byte — a golden that changes is a regression unless
  the change is the point of the work.
  `agent/tests/test_control_room_contract.py` pins the workflow's `cron:`
  line, which the control room and the home agent widget read at build
  time.
- The public plan page (`app/researcher/agent/page.tsx`) and
  `docs/agent-plan.md` describe the same agent at two levels of detail
  (narrative vs. technical). Keep them in sync at a high level whenever
  the agent's design changes materially — they don't need to match
  word-for-word.

## Do not

- Don't add Tailwind, a CSS-in-JS runtime, or a component library. The
  design is a hand-built token + "case" system in `app/globals.css`
  (ported from the original `styles.css`) — extend it in that file.
- Don't add heavyweight dependencies without being asked — the site is
  deliberately close to plain HTML/CSS, just built through Next now.
- Don't touch the agent (`agent/`, Python) or its
  `.github/workflows/agent-run.yml` when doing site work — they are a
  separate initiative, on the `agent-data` branch for state.
- Don't start implementing the agent without confirming the task with the
  user first, even if `docs/agent-plan.md` makes the next step obvious.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
