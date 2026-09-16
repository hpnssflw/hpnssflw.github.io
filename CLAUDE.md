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
   (superpowers skills) before writing any of its code.
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
- **Verify site changes** by building and serving the export, plus the
  test suite:
  ```
  npm run dev             # iterate locally (http://localhost:3000)
  npm run build           # static export into out/
  npm run serve           # serve out/ exactly as Pages will
  npm test                # Vitest — lib/posts, lib/agent-status
  ```
  (`next dev` occasionally hangs the TCP handshake in this environment;
  if a port won't come up, kill node and retry, or verify against
  `npm run build` + `npm run serve` instead.)
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
