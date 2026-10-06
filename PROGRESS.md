# Project Progress

## Site — LAB + RESEARCHER

**Status: migrated to Next.js; home page redesigned 2026-10-02.**

- Home redesign (2026-10-02, commit `bb39ce0`, iterated live with Artem —
  no spec/plan): one 1040px container on every route, content flush left,
  long prose on a 592px column (`--measure` / `--measure-text`); hero
  without "Digital Craftsman", pinned to the top; RESEARCHER and LAB side
  by side on a subgrid (`.home-columns`) so labels and cards share rows.
  RESEARCHER: label lists the topics, agent widget card (`watch ↗`,
  slow lime comet), subtopics as text below. LAB: "takes on
  experience.", one post at a time (`components/LabCarousel.tsx`) on a
  15s comet timer that pauses on hover. Both cards share one frosted
  surface (`--card-bg`, "Home cards" in `app/globals.css`).
  `lib/topics.ts` now stores `subtopics[]`; `gloss()` builds
  `/researcher/`'s descriptions. Header on inner routes moved left the
  same day (`6f2f1f2`): one group, `ARTEM POLOZOV / LAB RESEARCHER NOW`,
  dim slash (`.site-header-sep`), wraps below ~320px.
- Hero rebuilt as a card the same day and the next (`a76c02a`..`8a77c64`,
  iterated live from rendered variants): the home cards' borderless
  `--card-bg` surface (shared by the hero, agent widget and LAB card), a
  120px avatar inside the card's padding (`public/avatar.jpg`, a 352px
  crop of the face — `photo.jpg` is unused but kept), name in normal case
  at 24px, roles "web products · data visualization · AI engineering",
  `email ↗ github ↗ telegram ↗` top right. The thesis moved to the
  site-wide footer, centred above the signature (`bfc52e8`). At the
  card's foot, two widgets share a caption baseline: Claude Code
  (`components/ClaudeActivity.tsx`) — status line, a strip of the last
  28 days' active minutes (lime, today glowing while a session runs) —
  and a mini GitHub contribution grid (`868b73e`): last 26 weeks, 8px
  violet cells, every active day twinkling on its own seeded rhythm,
  fetched at build time (`lib/github-calendar.ts`,
  `components/GitHubGrid.tsx`). The strip reads presence.json's new
  `dailyMinutes` (`c79bf1c`: 28 numbers; run.mjs recomputes the 27 past
  days once a day into a local `daily-cache.json`; `install.ps1` was
  re-run on 2026-10-03 and the task published the 11-key file). The LAB
  card rotates the five newest LAB posts and the five newest posts from
  the agent's Telegram channel, shuffled per page load, with a violet
  source badge (`82882dc`; `lib/home-feed.ts`; Telegram read at build
  time from `t.me/s/hypnosisflow`, `lib/telegram-post.ts`). Under the
  columns, a two-line teaser for Tony Scraponi in the site's own
  language (`8a77c64`, `components/AppsStrip.tsx`): an animated spy mark
  (the fedora tips, a glint crosses the glasses), name, "coming soon",
  pitch and features on the left; the agent's live numbers from
  status.json and "follow the build ↗" (Telegram) on the right. (Tony's
  own design direction, in the Obsidian vault, was tried and rejected
  for the site.) `deploy.yml` passes `GITHUB_TOKEN`
  and rebuilds every 6 h for both build-time sources. At desktop widths "/" fits one screen: its four
  vertical gaps shrink with the window height (`--home-fixed` in
  globals.css — raise it if the home content grows; windows under ~640px
  tall scroll). **Live since 2026-10-03:** merged with `origin/main` (the
  Tony Scraponi inbox, `bc18878`; CLAUDE.md kept both new bullets) and
  pushed; deploy run 37099706848 succeeded, and the live page shows the
  GitHub grid (Actions' `GITHUB_TOKEN` can read the calendar) and five
  Telegram slides (t.me is reachable from the runners). One local commit
  in that range, `c79bf1c`, doesn't build on its own — it deletes
  `ClaudeWidget.tsx` while `app/page.tsx` still imports it; `45f2274`
  fixes it.
- Next.js App Router + TypeScript, statically exported (`output: 'export'`,
  `trailingSlash: true`), deployed to GitHub Pages by
  `.github/workflows/deploy.yml` on every push to `main`.
- Routes: `/` (hero, RESEARCHER + LAB cards — see the redesign above),
  `/lab/` + `/lab/[slug]/` (MDX posts from `content/lab/`, five so far —
  "Cheap Models, Strong Graphs", "State Without a Database", "The Email
  That Never Got Sent", "Config That Lied", "Reviewing Your Own
  Claims"), `/researcher/`, `/researcher/agent/`
  (the agent plan page + live dashboard).
- One persistent header (`components/SiteHeader.tsx`) and footer, rendered
  by the root layout — this replaced the old ad-hoc per-page back links.
  All nav is `next/link` (client-side).
- The agent status widget is now `components/AgentWidget.tsx` +
  `lib/agent-status.ts` (was `assets/agent-widget.js`); it still
  client-fetches the same `status.json` from the `agent-data` branch.
- Design system: `app/globals.css`, ported ~verbatim from the original
  `styles.css` (token scale + "case" system unchanged).
- Tests: `npm test` (Vitest) — see CLAUDE.md for the module list.
- Old `.html` URLs are kept alive by redirect stubs in `public/`.
- Migration spec+plan: `docs/superpowers/specs/2026-09-09-nextjs-migration-design.md`
  and `.claude/plans/lucky-rolling-aurora.md`.

Design history for the site lives in `docs/superpowers/specs/` and
`docs/superpowers/plans/` (one spec+plan pair per feature, in the order
they were built). `landing-plan.md` at the repo root is the original design
brief this all started from — see the note at its top for what's since
changed. The specs written before the Next.js move describe pages by their
old `.html` paths (`researcher/agent.html` → `/researcher/agent/`, etc.).

## Now page (`/now/`)

**Status: shipped.** `/now/` is live: Yandex Music playlists (inline
player on tap), a Games "upcoming" placeholder, and a live Claude Code
widget (working / waiting / offline, today's active time, sessions, model
family). Both live blocks read the `presence-data` branch (`playlists.json`,
`presence.json`), which the `polozov-presence` scheduled task on Artem's
machine updates every 5 minutes — Yandex answers GitHub's runners 451, so
nothing is fetched at build time (spec's Plan B, adopted after the Task 1
probe). Known limitation: the Yandex player may not play for visitors
outside Yandex Music's regions. Out of scope for this phase: last-played
track, cloud claude.ai/code sessions, friends/login/pager/extension (all
need a backend — see the spec intro and the research report).

- How it works now (architecture, data, privacy, operations,
  troubleshooting; in Russian): `docs/now-page.md` — keep it current
  when `/now/` or `scripts/presence/` changes.
- Spec: `docs/superpowers/specs/2026-09-28-now-page-design.md`
- Plan: `docs/superpowers/plans/2026-09-28-now-page.md`
- Research behind it (local, uncommitted): `reports/Интеграции Яндекс и Claude Code.md`
- Phase 1 of a larger presence/pager idea; later phases need a backend
  and have open legal/reachability decisions (see the spec intro).
- Probes (throwaway branches, deleted): run 36386492821 — API `451
  Unavailable For Legal Reasons` from a US runner; run 36387764861 —
  iframe page, playlist page and `avatars.yandex.net` cover all 200 from
  a US runner (whether the player actually plays abroad is unknown).
- The runner fetches Yandex over `node:https`, not `fetch()`: Yandex's
  anti-robot layer answers `403` (`x-yandex-captcha: 403`) to Node TLS
  handshakes that advertise ALPN, which undici's `fetch` always does;
  `node:https` and curl get `200` from this machine. If playlists go
  stale, check `run.log` for `yandex music failed` first.
- Final-review fix wave (2026-09-28): the task runs a pinned copy of the
  runner, every publish passes `assertPublishable`, `model` comes from
  main sessions only (not subagents), a failed push is retried once and
  forces the next publish, a fresh clone keeps the published
  `playlists.json`, killed-run git states heal, presence goes stale after
  20 min, and cover URIs are limited to `avatars.yandex.net`. `install.ps1`
  was re-run the same day: the task now runs the pinned copy, and its
  first run published `model: "opus"` with `playlists=kept` (Yandex timed
  out).
- Final whole-plan review (opus): 0 Critical; 2 Important + 10 Minor
  fixed in one wave (`525e887..e76c57a`); scoped re-review clean. Its
  three parked Minor follow-ups were fixed on 2026-09-29 (`953e5c0..e0591f9`;
  spec `docs/superpowers/specs/2026-09-29-presence-runner-minors-design.md`,
  plan `docs/superpowers/plans/2026-09-29-presence-runner-minors.md`):
  `ensureRemote` writes `.git/config` only when `origin` is missing or
  wrong, and a stale `config.lock` is swept like `index.lock`; the
  `assertPublishable` message test can fail now; the previous state is
  read from the clone's `HEAD`, not its working tree. `install.ps1` was
  re-run on 2026-09-30; its first run published with `playlists=same` and
  left `.git/config` untouched.
- Parked by that fix's final review (all Minor, none a regression):
  `ensureRemote` doesn't restore a missing `remote.origin.fetch`, so a
  run killed inside the first `remote add` would leave a URL-only origin
  and publish every 5 minutes forever (fix: also check
  `git config --get-all remote.origin.fetch`); the `REPO/.git` guard
  doesn't stop git walking up from a half-initialized `.git` (no parent
  repo above `%LOCALAPPDATA%` today; fix: `GIT_CEILING_DIRECTORIES` in
  `GIT_ENV`); the /now/ spec's runner step 5 says "only if both hold"
  but lists three conditions.
- Known self-healing noise in `run.log`: Yandex timeouts and
  `getaddrinfo() thread failed to start` push failures, a few times a
  day. Seen once (2026-09-28 16:03, right after the machine woke): a run
  started before sleep collided with a fresh one (`index.lock` exists,
  `cannot lock ref 'HEAD'`). Git refused safely and the next run
  published 20 s later. No run-level lock was added.
- SDD ledger (git-ignored, full task history + the headless-Chrome check
  scripts `now-check.mjs` / `presence-check.mjs`):
  `.superpowers/sdd/2026-09-28-now-page/`.

## Research Agent

**Status: Task 6 of 6 code-complete — one verification step deferred.**

- Narrative plan (public, on the site): `app/researcher/agent/page.tsx`,
  rendered at `/researcher/agent/`
- Technical plan (background/design, not the task list): `docs/agent-plan.md`
- Canonical implementation plan (the actual step-by-step tasks):
  `docs/superpowers/plans/2026-08-12-research-agent.md` — supersedes the
  coarser TASK-001–007 breakdown at the bottom of `docs/agent-plan.md`.
- `agent/` exists: package scaffold, YAML config (`defaults.yaml` +
  `topics/*.yaml`), the `Candidate`/`Drop`/`TopicConfig` dataclasses
  (`sources/base.py`), and the config loader (`config.py`). Shipped in
  commit `cd77594` — Task 1 of the plan above.
- `agent/date_guard.py` (recency window) and `agent/sources/hn.py` (HN
  Algolia connector) shipped in commit `c4ab1ec` — Task 2. Verified this
  session: synthetic date-guard check passes, and a live Algolia query for
  the `ai-agents` topic returned 32 timezone-aware candidates, 0 drops.
- `agent/dedupe.py` (URL-hash seen-state store, `times_sent`-based
  filtering) shipped in commit `8cc137d` — Task 3. Verified this session:
  a sent item is dropped as `seen` on a later pass, an unsent item is
  kept, and state round-trips through save/load correctly.
- `agent/events.py` (JSONL `EventWriter`), `agent/main.py` (`run_dry`
  funnel), `agent/__main__.py` shipped in commit `7dc7ca1` — Task 4.
  Verified this session: `python -m agent --dry-run --topic ai-agents`
  ran end to end (32 candidates, 0 drops at every stage) and recorded a
  `.jsonl` run file; the event file round-tripped through `read_events`
  with the `collect` stage present; a temporary `max_age_days: 1` edit to
  `ai-agents.yaml` re-ran cleanly with 0 assertion errors (0
  `outside_window` drops, since `hn.collect` already applies
  `max_age_days` server-side via Algolia's `numericFilters`, so
  `date_guard` sees nothing left to catch by the time it runs) and the
  file was restored to its committed form.
- `agent/summarize.py` (batched-per-topic DeepSeek ranking, validated
  against the expected id set, one retry then per-candidate fallback)
  shipped in commit `dd28832` — Task 5. Also updates
  `agent/defaults.yaml`'s `llm.model`: `deepseek-chat` was discontinued
  2026-07-24, so it's now `deepseek-v4-flash` (the non-thinking mode
  `deepseek-chat` used to point to). Verified this session: the
  synthetic response-validator checks all pass with no network, and a
  live batched call against 5 real `ai-agents` candidates returned
  well-formed scores (1–10) and one-sentence summaries for all 5 —
  first paid call in the build. `DEEPSEEK_API_KEY` is set in
  `agent/.env` (gitignored, not committed).
- `agent/digest.py` (subject/body assembly), `agent/deliver.py` (SMTP
  send), and `agent/main.py`'s `run_real` shipped in commit `c65c8cb` —
  Task 6, code side. `docs/agent-plan.md` and `researcher/agent.html`
  synced to the shipped design in commit `5d3605d` (site re-served
  locally and curled to confirm the new copy landed). Verified this
  session: digest assembly (subject line, body content) passes with no
  network. **Deferred:** the plan's Step 5 — one real run
  (`python -m agent --topic ai-agents`) that actually sends mail — is
  not yet done. `SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASSWORD`
  aren't in `agent/.env` yet; a TODO in `agent/deliver.py` marks this.
  Once those credentials are added, run that command and check
  `hypnosisflow@gmail.com` — that's the last thing standing between here
  and "v1 shipped." **Superseded:** `agent/digest.py`/`agent/deliver.py`
  no longer do SMTP — see the Content Direction & Tony Scraponi section
  below, sub-project #2, which replaced this with Telegram Bot API
  delivery. This entry stays as the historical record of what Task 6
  originally shipped.

### Agent status widget + public dashboard

**Status: shipped.** All 7 tasks complete, final whole-plan review clean
(2 fix rounds), pushed to `main`. The homepage widget and
`researcher/agent.html` dashboard are both live and rendering real data
from the GitHub Actions workflow, which runs every 4 hours against real
infrastructure.

- Spec: `docs/superpowers/specs/2026-08-15-agent-status-widget-design.md`
  — explicitly supersedes the Windows-Task-Scheduler scheduling decision
  and weekly-cadence-unchanged note in the research-agent spec, and the
  build-time-snapshot public-replay plan in the run-panel spec.
- Plan: `docs/superpowers/plans/2026-08-15-agent-status-widget.md`.
- This repo now has a GitHub remote for the first time:
  `https://github.com/hpnssflw/webpage.git`, local branch renamed
  `master` → `main` to match. The repo is public (required so the site's
  client-side `fetch()` can read `status.json` with no auth token). An
  orphan `agent-data` branch (single commit, `README.md` only) is pushed
  and ready for the GitHub Actions workflow (Task 4) to write to.
  `DEEPSEEK_API_KEY` is set as a repo secret — Task 1, no code changes.
- `.github/workflows/agent-run.yml` (cron `0 */4 * * *` + `workflow_dispatch`,
  two isolated checkouts — `main` read-only into `code/`, `agent-data`
  writable into `data/` — commits/pushes exactly `state.json`,
  `pending.json`, `status.json`) shipped in commit `4c27185`, Task 4. The
  first live run failed with a 403 — the default `GITHUB_TOKEN` is
  read-only unless the workflow requests write access — fixed with a
  scoped `permissions: contents: write` block, commit `c41b696` (an
  overly broad repo-wide permission change was tried first, then
  correctly reverted in favor of this narrower fix). **Both trigger paths
  are now confirmed working against real GitHub infrastructure**: the
  cron schedule fired on its own during testing and pushed successfully,
  and a manual `workflow_dispatch` run right after it pushed again on top
  — `agent-data` now has real commits with a well-formed `status.json`
  (`streak: 2`, real HN titles and DeepSeek relevance scores in
  `recent_events`). Task review independently re-verified the runtime
  token grant (`Contents: write` / `Metadata: read` — confirmed minimal,
  not broader) and reproduced all live-CI claims firsthand; approved, two
  minors deferred (a cp/test terseness nit matching the brief verbatim,
  and the still-open SMTP-not-configured gap from Task 1).
- `agent/pending.py` (pending-email queue), plus rewiring
  `agent/dedupe.py` (`mark_sent` → `mark_sent_url`, called only on actual
  delivery), `agent/digest.py`/`agent/summarize.py` (dropped "weekly"
  wording), `agent/config.py`/`agent/defaults.yaml`
  (`email_cadence_hours: 24`), and `agent/main.py`'s `run_real` — shipped
  in commit `ec64725`, Task 2. This decouples collection/ranking (moving
  to every 4h in Task 4) from email delivery (staying on a 24h rollup),
  and fixes a real bug the spec review caught: without
  `pending.filter_already_pending`, an item sitting in the queue would
  get re-collected and re-sent to DeepSeek for ranking on every
  subsequent cycle until the email gate fires. Verified this session:
  synthetic checks for `is_email_due` (empty/1h/25h against a 24h
  cadence) and `filter_already_pending` (a re-collected duplicate
  correctly dropped) all pass with no network; a live
  `python -m agent --topic ai-agents` run correctly hit the
  SMTP-not-configured graceful-failure path (caught, logged, no
  traceback) rather than crashing, leaving 8 kept items in
  `agent/pending.json` with `last_email_at: null`, ready to send once
  SMTP credentials exist. Task review: spec compliant, no
  Critical/Important findings, approved.
- `agent/status_export.py` (`build_status`, pure — never accepts
  `TopicConfig`, only a `dict[str, str]` of slug→name, so source config
  structurally cannot leak into the public output) shipped in commit
  `905b5e9`, Task 3, wired into `run_real`'s tail to write
  `agent/status.json` after every run (added to `.gitignore` on `main`,
  same as `state.json`/`pending.json` — it's only ever tracked on the
  future `agent-data` branch). Verified this session: a synthetic JSONL
  fixture produces correct funnel counts, `streak` increments on a
  `"run"/"complete"` event and resets to 0 without one, and (added in a
  fix round after task review) a seeded 24-entry `run_history` truncates
  correctly, dropping the oldest and keeping the new entry — all with no
  network; a live run produced a real `status.json` with the expected
  keys and `streak: 1`. Task review: spec compliant; one Important
  plan-mandated finding (the brief's own test script didn't cover the
  24-entry cap) fixed in a follow-up round; three Minor items deferred
  (worth noting for Task 4: a genuinely crashed run never reaches
  `build_status` at all, so `streak` only ever resets via the code path,
  not via an actual production failure — a crashed run just leaves the
  public widget's last-known state stale rather than flipping it red;
  the stale-dot logic in Task 5/6/7 is what actually catches that case).
- `assets/agent-widget.js` (shared vanilla-JS fetch/render script — fetch
  on load only, no polling; renders into `#agent-widget` and/or
  `#agent-dashboard`, whichever exists; `STATUS_URL` points at
  `raw.githubusercontent.com/hpnssflw/webpage/agent-data/agent/status.json`)
  shipped in commit `226406f`, Task 5. All status.json-derived string
  content (title, topic, reason, topic name) is HTML-escaped before
  interpolation. Verified this session via jsdom driving the actually-
  served page (no real browser tool available in this environment) —
  confirmed dot-class toggling on fresh vs. stale `updated_at`, sparkline
  rendering, countdown math, and per-topic counts; literal color
  rendering is correctly deferred to Task 6, since the CSS classes don't
  exist yet. Task review: spec compliant, approved, three minors
  deferred (notably: the dashboard's countdown call is currently a
  harmless no-op — the dashboard mockup never included a countdown
  element by design, so there's no `[data-countdown]` target for it to
  find).
- Homepage widget markup (`#agent-widget` mount under the RESEARCHER
  topics list, `assets/agent-widget.js` script tag) and its CSS (card
  chrome on `.agent-widget-link`, not a bare `.agent-widget` class —
  there is no such class in the DOM, only the `#agent-widget` id; the
  `.accent` comment updated to acknowledge this as the second deliberate
  monochrome-palette break) shipped in commit `02797dc`, Task 6.
  **Confirmed rendering real production data** — verified this session
  against the actual live `agent-data` `status.json` (streak 2, sparkline
  `█▃`, real per-topic counts), not just the fallback state. Task review
  independently re-fetched the same live JSON and confirmed the reported
  figures weren't fabricated; approved, two minors deferred (both in the
  plan's own text, not implementation: a self-contradictory CSS comment,
  and an intentionally-unstyled `.agent-topics` span).
- `researcher/agent.html` gains a dashboard-first `#agent-dashboard`
  mount (status header + sparkline, per-topic funnel bars, live-style
  ticker, all sourced from the same `assets/agent-widget.js`/`status.json`
  as the homepage widget), plus its CSS, plus narrative sync in both
  `researcher/agent.html` and `docs/agent-plan.md` (weekly → 4h
  collection/daily email rollup, Windows Task Scheduler → GitHub
  Actions) — shipped in commit `8563878`, Task 7, **the final task in
  this plan**. Verified this session against real production
  `status.json` (funnel counts, ticker rows, streak all rendered
  correctly). Task review: spec compliant, approved. One confirmed gap
  deferred to the final whole-plan review rather than fixed ad hoc:
  `docs/agent-plan.md`'s "Daily vs weekly"/"Resurfacing" Open Questions
  bullets are still stale — this plan's own Task 7 brief never specified
  that edit (a plan omission, not an implementer error).
- **Final whole-plan review complete — plan shipped.** No Critical
  findings; all three core guarantees (redaction-by-construction,
  mark-on-send-only delivery, CSS selectors matching real DOM output)
  verified end-to-end. Cross-task issues no single task review could see:
  the site's "nothing published, nothing public" claim was flatly false
  (`agent/pending.json`, containing full curated titles/summaries/scores,
  is pushed to the public `agent-data` branch every run, same as
  `status.json`) — reworded in `researcher/agent.html` and
  `docs/agent-plan.md` to be honest about it (2 fix rounds — round 1's
  rewording still under-claimed exposure by only mentioning
  `status.json`, not `pending.json`); the spec's redaction rationale was
  half-defeated by Task 1's public flip (source config is public via
  `agent/topics/*.yaml` regardless) — noted honestly in the spec; a real
  case-system bug in `assets/agent-widget.js` (`.toLowerCase()`/
  `.toUpperCase()` mutating topic name strings instead of using CSS
  `text-transform`, violating the site's own documented convention) —
  fixed; `CLAUDE.md` was stale on the GitHub remote/branch-name and the
  unqualified "no JS" rule — updated; `docs/agent-plan.md`'s stale Open
  Questions bullets and `agent/deliver.py`'s "weekly" docstring — synced;
  `pending_email_count` was written to `status.json` but never displayed
  (silent queue growth with SMTP still unconfigured) — now shown on the
  dashboard. Deferred as lower-value/lower-risk: workflow
  `timeout-minutes`/`concurrency` hardening, a low-probability same-minute
  `run_id` JSONL-collision edge case, CSS token-discipline nits, and
  escaping uniformity for non-string JSON fields (not exploitable) — see
  the SDD ledger for the full list if picking any of these up later.
- Note: there is unrelated concurrent work on `main` from a different
  session implementing the local run panel
  (`docs/superpowers/specs/2026-08-12-run-panel-design.md`) —
  `agent/panel.py`, `agent/funnel.py`, `agent/panel_page.html`, and edits
  to `agent/main.py` (a `panel` subcommand, and — as of this writing, seen
  mid-edit — refactoring `run_dry` into `run_dry_pipeline` for a live-
  trigger feature). No conflict with this plan's tasks so far; flagging
  so a future session isn't surprised by commits it didn't make.

## Content Direction & Tony Scraponi

**Status: sub-projects #1-#6 shipped.**

- Background/full plan: `docs/tony-scraponi-roadmap.md` — a third
  initiative alongside the site and the agent: reworking the agent's
  content themes, adding Telegram delivery, fixing the blog's content
  direction, and eventually a Tony Scraponi control page. Decomposed
  into 4 ordered sub-projects; each gets its own brainstorm → spec →
  plan → implementation cycle.
- **Sub-project #1, agent themes rework: shipped.** Spec:
  `docs/superpowers/specs/2026-09-16-agent-themes-rework-design.md`.
  Plan: `docs/superpowers/plans/2026-09-16-agent-themes-rework.md`
  (executed via subagent-driven-development, 3 tasks + a final
  whole-plan review with one fix round).
  - `agent/topics/{web-products,ai-engineering,tooling}.yaml` replace
    the old `ai-agents`/`data-viz`/`full-stack` topics and drop the
    dead `reddit`/`rss`/`releases`/`web_search` keys that
    `agent/main.py`'s `CONNECTORS` dict never wired up — commit
    `8d8033c`, Task 1. Verified: `agent.config.load_topics` loads all
    three with the expected slugs/sources, and a full `--dry-run`
    collects real Hacker News results for all three.
  - `agent/sources/github_trending.py` (GitHub Search API — recent
    repos ranked by stars, not `github.com/trending` scraping) shipped
    and wired into `CONNECTORS`, backing Tooling's second source —
    commit `8198e73`, Task 2. Verified: a mocked no-network check
    (field mapping, excerpt truncation, undated-drop path) and a live
    `--dry-run --topic tooling` run (52 combined HN+GitHub items, no
    crash). Deliberately does not filter by `topic.keywords` — queries
    "recently created, highly starred" globally and relies on the
    downstream DeepSeek ranker (`min_relevance: 6`) to discard
    off-topic results; the final whole-plan review flagged this as
    noisier than ideal (live check: ~3 of 12 top results were
    tooling-relevant) but the user confirmed on 2026-09-16 to keep the
    design as approved during brainstorming rather than add
    query-level filtering now.
  - Site/doc copy synced to the new theme names (RESEARCHER lists on
    `/` and `/researcher/`, the `/researcher/agent/` narrative,
    `docs/agent-plan.md`'s Topics section) — commit `12a54a4`, Task 3.
  - Final whole-plan review (Critical: none; Important: 4, one fix
    round, commit `8fb7ee9`) confirmed slugs/names agree everywhere
    (`agent/topics/*.yaml` ↔ `agent/main.py` ↔ all three site pages ↔
    `docs/agent-plan.md`) and no dead source keys remain. Fixed in the
    review's one fix round: `docs/agent-plan.md`'s Sources section and
    `/researcher/agent/`'s "Five kinds of source" list now mention
    GitHub trending; `agent/main.py`'s connector loop no longer lets
    one source's exception abort the whole topic (and, with it, that
    run's email delivery); `.github/workflows/agent-run.yml` now passes
    `GITHUB_TOKEN` (previously the GitHub connector always ran
    unauthenticated in CI, at a tighter rate limit); the two
    RESEARCHER topic lists' ordering was reconciled to match; a stale
    `--topic ai-agents` reference in `agent/deliver.py`'s docstring was
    fixed; `.gitignore`'s `__pycache__` entry was generalized to cover
    `agent/sources/`. Deferred as lower-value (see the SDD ledger,
    `.superpowers/sdd/2026-09-16-agent-themes-rework/progress.md`, for
    the full list): description/keyword drift inside the new topic
    YAMLs (descriptions promise slightly more than the keywords
    actually search for — matches the plan verbatim), a magic-number
    nit in `github_trending.py`, and a short-lived widget/copy mismatch
    expected after the next deploy+push (the live `status.json` on the
    `agent-data` branch won't show the new topic names until the next
    scheduled agent run, up to 4h later — self-healing, not a bug).
  - One cosmetic nit left as-is: commit `8198e73`'s `Co-Authored-By`
    trailer reads "Claude Haiku 4.5" instead of this repo's standard
    attribution — git trailer text only, not worth rewriting published
    history for.
  - **Pushed to the remote** as part of the combined push with
    sub-projects #2 and #3 — see below.
- **Sub-project #2, Telegram delivery: shipped, live send verified.**
  Spec: `docs/superpowers/specs/2026-09-17-telegram-delivery-design.md`.
  Plan: `docs/superpowers/plans/2026-09-17-telegram-delivery.md`
  (executed via subagent-driven-development, 3 tasks + a final
  whole-plan review with one fix round). Commits `0b7ab1c`..`c1bc7b2`
  (Task 1 + its fix round, Task 2, Task 3, final-review fix wave) — see
  `.superpowers/sdd/2026-09-17-telegram-delivery/progress.md` for the
  full execution ledger.
  - `agent/digest.py`/`agent/deliver.py` rewritten in place: `digest.build`
    now returns Telegram-ready HTML messages (escaped, split at Telegram's
    4096-char limit, including a further intra-topic split for an
    oversized single topic — a deviation from the plan's literal example
    code that the human partner confirmed keeping, since the literal code
    failed the plan's own verification script for that case);
    `deliver.send` POSTs via `requests` (no new dependency), with
    inter-message pacing and a 429-retry-once mechanism added in the
    final review's fix wave, and the bot token scrubbed from any
    exception message that reaches the run event log. `DeliveryConfig`/
    `status.json` field names are delivery-neutral now
    (`telegram_channel`/`delivery_cadence_hours`, `last_sent_at`/
    `pending_count`) — `agent/pending.py`'s internal `last_email_at`/
    `is_email_due` names are intentionally unchanged (private, not part
    of the public contract).
  - Site synced: `lib/agent-status.ts`/`.test.ts`, `components/
    AgentWidget.tsx` follow the renamed `status.json` keys;
    `components/SiteFooter.tsx` gets a site-wide Telegram channel link;
    `app/researcher/agent/page.tsx` and `docs/agent-plan.md`'s narrative
    no longer describe email/SMTP delivery.
  - **Live send verified 2026-09-18.** The @hypnosisflow bot/channel now
    exist; `TELEGRAM_BOT_TOKEN` is set as a repo secret,
    `agent/defaults.yaml`'s `telegram_channel` and the footer's Telegram
    `href` both point at the real handle (commit `f5736ec`), and a manual
    `workflow_dispatch` run of `.github/workflows/agent-run.yml` sent the
    full accumulated backlog — 124 items across 5 topics, per the user's
    earlier decision not to trim it first — with no errors.
    `agent-data`'s `status.json` confirms `pending_count: 0` and a fresh
    `last_sent_at`. This was the last deferred step from the original v1
    plan's never-completed SMTP step.
  - Final whole-plan review (opus): no Critical findings. Two Important
    findings needed code fixes and were fixed in the final-review fix
    wave (token leak into the run log; no pacing/flood-limit handling on
    multi-message sends). Two more Important findings were the human
    partner's call, not code gaps: the `status.json` rename is a
    breaking contract change until the next scheduled agent run picks up
    the new keys (decided: push, then immediately trigger the workflow
    by hand and confirm before calling the deploy done — see below); and
    the footer's placeholder link ships as planned (decided: keep, per
    the plan's literal Global Constraints).
  - **Pushed to the remote and verified.** A `workflow_dispatch` run
    (2026-09-17T04:34:28Z) confirmed `agent-data`'s `status.json` carries
    the renamed keys (`last_sent_at`/`delivery_cadence_hours`/
    `pending_count`); widget/dashboard are healthy again.
- **Sub-project #3, Blog content & direction: shipped.** Spec:
  `docs/superpowers/specs/2026-09-17-blog-content-direction-design.md`
  (commit `e1d40c6`). Plan:
  `docs/superpowers/plans/2026-09-17-blog-content-direction.md` (commit
  `0266d45`; executed via subagent-driven-development, 2 tasks).
  - `docs/lab-direction.md` states LAB's scope (personal essays/
    lessons-learned, the same general territory as RESEARCHER's three
    themes but not a hard boundary) and its freeform tagging convention,
    plus a backlog of four candidate next posts. The one existing LAB
    post (`content/lab/cheap-models-strong-graphs.mdx`) is retagged from
    the stale `AI AGENTS` to `AGENT ARCHITECTURE`, with
    `lib/posts.test.ts`'s fixture updated to match, and `CLAUDE.md`'s
    session-start protocol (step 3) now points to
    `docs/lab-direction.md` before any LAB post is written or edited —
    commit `1ea4987`, Task 1.
  - `lib/topics.ts` (+ `lib/topics.test.ts`) de-duplicates the RESEARCHER
    topic list (Web Products, Tooling, AI Engineering) that `app/page.tsx`
    and `app/researcher/page.tsx` had each hand-copied and had already
    drifted (AI Engineering linked to the agent page on one but not the
    other); a new shared `components/ResearcherTopics.tsx` renders it on
    both pages, with AI Engineering now consistently linked on both —
    commit `af801db`, Task 2.
  - Final whole-plan review: no Critical findings. Two Important findings
    were both documentation cross-reference issues (`docs/lab-direction.md`
    still pointed at `app/researcher/page.tsx` for the theme names and
    `CLAUDE.md`'s pointer needed the same fix) — fixed in this same
    reconcile pass, along with Minor doc-clarity notes: the theme order
    in `docs/lab-direction.md` corrected to match `lib/topics.ts`'s
    actual order (Web Products, Tooling, AI Engineering, not the
    roadmap prose's Web Products, AI Engineering, Tooling), the "no
    fixed list enforced anywhere in code" sentence scoped explicitly to
    LAB tags, and a one-line disambiguating comment added above
    `lib/topics.ts`'s `Topic` type distinguishing it from
    `agent/topics/*.yaml` and `lib/agent-status.ts`'s unrelated
    `TopicStatus`.
  - **Pushed to the remote** together with sub-projects #1 and #2 (no
    agent code in this sub-project, so no workflow re-verification
    needed beyond sub-project #2's).
- **Sub-project #4, Tony Scraponi MVP: shipped.** Spec:
  `docs/superpowers/specs/2026-09-17-tony-scraponi-mvp-design.md`. Plan:
  `docs/superpowers/plans/2026-09-17-tony-scraponi-mvp.md` (executed via
  subagent-driven-development, 2 tasks + a final whole-plan review, no
  fix rounds needed on either task). A single page, `/researcher/queue/`,
  rendering `agent/pending.json` — the curated delivery queue, already
  public on `agent-data` but previously unreadable except as raw JSON —
  grouped by topic. Source/topic visibility only, per the roadmap's MVP
  scope; no editing/triggering/publishing controls.
  - `lib/pending-queue.ts` (+ `lib/pending-queue.test.ts`) mirrors
    `agent/pending.py`'s `PendingItem`/`PendingQueue` dataclasses
    field-for-field as TypeScript types, with a runtime shape guard
    (`isPendingQueue`) and a `groupByTopic` transform (topic-keyed,
    score-descending within each group) — commit `59babf7`, Task 1.
    Verified: 11 Vitest cases covering the guard's accept/reject paths
    and the grouping transform, no network.
  - `components/PendingQueue.tsx` (client-side fetch, same
    `useEffect`/cancelled-guard/`Unavailable` pattern as
    `components/AgentWidget.tsx`), the `/researcher/queue/` route
    (`app/researcher/queue/page.tsx`), and nav links from
    `/researcher/` and `/researcher/agent/` — commit `6438ec6`, Task 2.
    Deliberately adds **zero new CSS**: reuses `/lab/`'s existing
    `.feed`/`.title`/`.excerpt`/`.meta` list pattern and `.section-label`
    for per-topic headings verbatim. Verified against the live
    `agent-data` `pending.json` (101 items across 5 topics, confirmed
    sorted correctly per topic) and against a live 404 (confirmed the
    "queue unavailable" failure path).
  - Final whole-plan review (opus): no Critical findings, no code-level
    Important findings. One Important finding was a data/product call,
    not a code defect: the live pending queue's oldest, most prominent
    entries sit under two topic names (`AI Agents & Engineering`,
    `Data Viz`) that sub-project #1's themes rework retired everywhere
    else on the site, and because the Telegram bot/channel still don't
    exist (sub-project #2's deferred item), delivery has never
    succeeded, so the queue only grows and `last_sent` will always read
    "never." Confirmed with the user on 2026-09-17: ship as-is, matching
    the agent's existing full-transparency stance — revisit once
    Telegram delivery actually lands and the queue starts draining.
    Redaction/exposure independently re-confirmed clean: every field the
    new page renders was already public in `pending.json`; nothing from
    `agent/topics/*.yaml` or `status.json`'s internals is newly exposed.
    Four Minor findings were all confirmed non-issues rather than
    deferred (the reused case system's lowercase/uppercase
    `text-transform` on external titles/sources is a deliberate
    site-wide design choice, not a bug; no loading skeleton matches
    `AgentWidget`'s existing behavior; a stricter-than-Python guard on
    `last_email_at` and an unvalidated `pending_since` date both fail
    safely and match the producer's actual output, so neither needs a
    change).
  - **Pushed to the remote.**
- **LAB backlog posts: done — all 4 published.** Spec:
  `docs/superpowers/specs/2026-09-28-lab-backlog-posts-design.md`. Plan:
  `docs/superpowers/plans/2026-09-28-lab-backlog-posts.md`. Short-note
  format (≤ 200 words) now in `docs/lab-direction.md`. Future drafts go
  in `drafts/lab/` until Artem edits and publishes them.
  - Published: `state-without-a-database` (Task 1) —
    `/lab/state-without-a-database/`, 2026-09-28;
    `the-email-that-never-got-sent` (Task 2) —
    `/lab/the-email-that-never-got-sent/`, 2026-09-28 (published as the
    post-review draft text; Artem chose to skip his own edit pass);
    `config-that-lied` (Task 3) — `/lab/config-that-lied/`, 2026-09-28
    (likewise published as the post-review draft text, no edit pass);
    `reviewing-your-own-claims` (Task 4) —
    `/lab/reviewing-your-own-claims/`, 2026-09-28 (no edit pass; one
    publish-time fact refresh, approved by Artem: "five plans" → "six",
    since this plan's own final review was the sixth — it caught three
    claims stronger than their sources, one in this post's hook).
  - Final whole-branch review (opus): no Critical findings; four
    Important (no first person in post #1; three claims stronger than
    their sources — two of them from the plan's own fact list/angle)
    plus seven Minor fixed in one fix wave, commit `2327a5e`. The one
    residual (post #1's sources comment misdating `64a745d`) went away
    when Publishing Step 3 deleted that comment.
- **Sub-project #5, Inbox (moderated delivery): shipped.**
  Spec: `docs/superpowers/specs/2026-09-28-tony-scraponi-inbox-design.md`.
  Plan: `docs/superpowers/plans/2026-09-28-tony-scraponi-inbox.md`.
  Merged to `main` and pushed 2026-09-29 (`57fa600`). Decisions live in
  `hpnssflw/tony-inbox`; owner mode was verified locally against it
  (approve/reject/undo, conflict retry) headlessly with the gh CLI
  token. Artem created the owner-mode PAT (the plan's Task 5 Step 2
  settings) and signed in on the live `/researcher/queue/` on
  2026-09-30. Live check (agent run 2026-09-29T07:31Z): the rejected
  item (Rafah / Google Maps) left the queue as `dismissed: rejected`;
  the two approved items (Vespper Docx MCP, KKKKhazix/AIHOT) were held
  until the 24h cadence came due. **Moderated delivery verified live
  2026-09-30:** the scheduled run at 04:08Z (GitHub skipped the 00:00Z
  cron slot) logged "Sent 2 approved items across 2 topics."; on
  `agent-data` exactly those two went `times_sent 0 → 1`, nothing else
  was sent, and the undecided jev-chat-windows is still pending.
  Undecided items expire after 7 days. The agent-run cron was paused
  during the rollout so the old code couldn't deliver unmoderated, and
  is active again.
  Final whole-branch review (opus): no Critical. I1 (a stale tab's
  prune could delete another device's decisions) and minors M2, M3, M5
  fixed in one fix wave (`aa73dac`, `a2bf96e`); I2 (the old agent
  could deliver items rejected during rollout) handled by the cron
  pause above; M6 (rollback needs `StateEntry.dismissed`) documented in
  `CLAUDE.md`; M1, M4, M7-M10 deferred.
- **Sub-project #6, Topic & source quality: shipped.**
  Spec: `docs/superpowers/specs/2026-09-30-topic-source-quality-design.md`.
  Plan: `docs/superpowers/plans/2026-09-30-topic-source-quality.md`.
  Pushed 2026-10-05 (24882c2); first live run 2026-10-05T18:22Z (workflow_dispatch 37355404165): 159 verdicts cached, queued per topic 4/3/3 (ai-engineering/tooling/web-products), no duplicate URLs in pending.json. Watch for 3 days (spec's success criteria 2–3): items sent to DeepSeek (the scored-per-day line of `python -m agent report`) should drop to single digits per run after the first day, at most 10 queued a day; then run python -m agent report against agent-data's state.json and decide on #7 (Web Products source).
  Tuned with Artem against two live previews: Tooling's keywords gained Claude Code / Codex / Cursor / Copilot / coding agent, and AI Engineering's exclude names coding agents and their add-ons. Final review (opus): 0 Critical, 3 Important — the same URL could be queued twice in one run (fixed: one copy per URL), `new` keeps counting cached over-cap items (watch criterion restated around `report`'s scored-per-day line), and the `lib/topics.ts` merge with main's `subtopics[]` (resolved) — plus a fix wave for a 23h cap window (cron jitter), per-keyword HN and per-topic ranking failure isolation, and doc drift. Parked: failed rankings pass the threshold as score 1 (latent, only if `min_relevance` 1); the local panel's `new` drill-down lists only `seen` drops; `state.json` grows with a `RankRecord` per topic (prune later); same story from several sources still takes several cap slots (story clustering); equal-score ties mix HN points and GitHub stars (break by recency instead). The main checkout's `agent/.env` has no `DEEPSEEK_API_KEY` line (lost around 2026-09-18); local previews read the worktree's `agent/.env`.
- **Content engine, sub-project A (engine core + presets): in progress — Task 6 of 13 done.**
  Spec: `docs/superpowers/specs/2026-10-06-content-engine-core-design.md`.
  Plan: `docs/superpowers/plans/2026-10-06-content-engine-core.md`.
  Worktree `.claude/worktrees/engine`, branch `worktree-engine`; merged
  into `main` only after the plan's Task 13 live check and Artem's
  go-ahead (every push to `main` changes the code the next scheduled
  agent run executes). Tests: `agent/venv/Scripts/python -m pytest agent/tests -q`;
  Tony's goldens in `agent/tests/fixtures/tony/golden/` were recorded on `ec82c98`.

### How to resume in a new session

**Research agent v1 (original 6-task plan): done, with a superseded
step.** Read `docs/superpowers/plans/2026-08-12-research-agent.md` for
the original task list if historical context is needed, but its Task 6
Step 5 (add SMTP credentials, send a live email) is **not** a live next
step — the user decided on 2026-08-17 to drop email/Telegram-as-only-
extra push delivery in favor of the on-page dashboard, then on
2026-09-16 to add a Telegram publisher after all as part of the Content
Direction & Tony Scraponi initiative (see that section above).
`agent/deliver.py`/`digest.py` are **not** dead code — sub-project #2
(Telegram delivery, see the Content Direction & Tony Scraponi section
above) rewrote them in place; they now do Telegram Bot API delivery, not
SMTP. TASK-007 onward in `docs/agent-plan.md`
(Reddit, RSS, releases, web search, attention rescue, scheduling,
keyword suggestion) remains out of scope for this plan and would need
its own.

**Agent status widget (7-task plan): shipped.** Nothing to resume — see
this file's section above for what shipped and what's deferred. The SDD
ledger at `.superpowers/sdd/2026-08-15-agent-status-widget/progress.md`
(git-ignored) has the full task-by-task history if ever needed, and can
be deleted once nobody expects to reference it.

**Site (Next.js migration): shipped.** The static HTML site is now a
statically-exported Next.js app, deployed to Pages by
`.github/workflows/deploy.yml`. Nothing to resume — see the Site section
at the top of this file. Plan:
`.claude/plans/lucky-rolling-aurora.md`; spec:
`docs/superpowers/specs/2026-09-09-nextjs-migration-design.md`.

**Now page (`/now/`): shipped.** Nothing to resume. Presence and
playlists update only while Artem is logged on (the task's LogonType is
Interactive; `scripts/presence/install.ps1` / `uninstall.ps1`; log at
`%LOCALAPPDATA%\polozov-presence\run.log`). The task runs a pinned copy
of `run.mjs` + `collect.mjs` in `%LOCALAPPDATA%\polozov-presence\bin\`
with node's path fixed at install — re-run `install.ps1` after changing
`scripts/presence/*.mjs` or after a Node upgrade/move. If Music shows the
`yandex music ↗` fallback, look for `yandex music failed` lines in that
log; if the widget never shows `working`, look for `claude agents failed`.
Next phase (backend: friends, Yandex ID login, pager) needs its own
brainstorm, starting from the research report's decision points.

**Content Direction & Tony Scraponi: sub-projects #1-#6 shipped.** See
this file's section above for what shipped in
each and what the final reviews found and fixed. Sub-project #2's bot/
channel now exist (`@hypnosisflow`) and live delivery is verified
(2026-09-18: 124-item backlog sent, queue drained to 0) — sub-project
#4's queue page will now show whatever accumulates between 24h delivery
cycles rather than an ever-growing backlog. All four sub-projects #1-#4
are pushed to the remote; the manual agent-workflow trigger for #2
confirmed the renamed `status.json` keys landed on `agent-data`
(2026-09-17T04:34:28Z run), and a second manual trigger the next day
confirmed the real Telegram send. `docs/tony-scraponi-roadmap.md`'s four
ordered sub-projects #1-#4 are now complete. The LAB backlog posts
follow-up (`docs/superpowers/plans/2026-09-28-lab-backlog-posts.md`) is
done too: all four posts are published. Sub-project #5 (Inbox) is
shipped. Sub-project #6 (topic & source quality) is shipped; its 3-day watch
and the #7 decision are next (see its bullet above). Also next: the
agent admin redesign (one-screen admin showing the agent's full config
and flow), brainstormed in its own worktree. Later candidates: a Web
Products source (#7), a Telegram DM when items await review, summary
editing.

**General:** see `CLAUDE.md` for this repo's actual conventions —
`CLAUDE.md` was rewritten for the Next.js move (build step, Pages
Actions deploy, `npm` verification commands). Commits still go directly
to `main`, no PR flow.
