# LAB Backlog Posts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Draft the four posts in `docs/lab-direction.md`'s backlog as short notes in `drafts/lab/`, ready for Artem to edit and publish one at a time.

**Architecture:** Content-only. Each task researches one post's facts from
git history/specs, writes `drafts/lab/<slug>.mdx` (not read by the site, so
committing it publishes nothing), verifies it with the shared check command
below, and commits. Publishing is a separate micro-step triggered by Artem
(see "Publishing procedure" at the end).

**Tech Stack:** MDX with `gray-matter` frontmatter (read by `lib/posts.ts`
once a file is in `content/lab/`), Node 20 for the check command, `git`.

Spec: `docs/superpowers/specs/2026-09-28-lab-backlog-posts-design.md`.

## Global Constraints

- **Language:** English.
- **Length:** body ≤ 200 words (frontmatter and the sources comment don't count).
- **Frontmatter fields:** `title`, `date` (`"YYYY-MM"`, quoted), `tag`, `excerpt`, `subtitle`, `description` — all non-empty.
- **Tag:** one freeform tag, 1–3 words, uppercase, specific; never `WEB PRODUCTS`, `TOOLING`, or `AI ENGINEERING` (RESEARCHER theme names).
- **Body skeleton, in this order:**
  1. One-line hook — the technique or problem (plain paragraph, no heading).
  2. `## What to watch for` — 2–3 bullets.
  3. `## Why it's interesting` — 1–2 bullets.
  4. `## In practice` — the real example in this repo, linked to GitHub as `https://github.com/hpnssflw/hpnssflw.github.io/blob/<branch>/<path>`; or, with no example, which direction to look to apply it.
- **Voice:** first person, Artem's voice, plain and direct — match `content/lab/cheap-models-strong-graphs.mdx`'s register, not its length. No marketing adjectives.
- **AI mention:** honest, where relevant — the center of post #4, at most one sentence in posts #1–#3.
- **Accuracy:** every concrete claim (number, file, decision, sequence of events) must trace to a commit, diff, spec, or plan in this repo. Nothing invented for color. A missing fact becomes a visible `[TODO: Artem — <what's missing>]` in the body, never a guess. Re-verify counts that drift (commit counts, dates) at drafting time; the facts listed in each task were verified on 2026-09-28.
- **Sources comment:** the file ends with an MDX comment `{/* sources: … */}` listing, per claim, the commit hash / file it came from.
- **No code or CSS changes.** `app/globals.css` already styles `ul`/`li`, `code`, and links in `.post .body`.
- **Never stage `.claude/settings.local.json`.** Stage only the files the task lists.
- **Commit trailer:** end every commit message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Known site inaccuracy (do not fix in this plan):** `app/researcher/agent/page.tsx` says "Six kinds of source" and describes RSS, releases, subreddits, and web search as if they run; `agent/main.py`'s `CONNECTORS` wires only `hacker_news` and `github_trending`. Posts must not claim the site copy is accurate.
- **Draft check command** (run from the repo root in Git Bash; exits non-zero on any failure; prints word count and each link's HTTP status):

```bash
node -e '
const fs = require("fs"), matter = require("gray-matter");
const file = process.argv[1];
const { data, content } = matter(fs.readFileSync(file, "utf8"));
for (const k of ["title", "date", "tag", "excerpt", "subtitle", "description"])
  if (!data[k]) { console.error("MISSING frontmatter: " + k); process.exitCode = 1; }
if (!/^\d{4}-\d{2}$/.test(String(data.date))) { console.error("BAD date: " + data.date); process.exitCode = 1; }
const body = content.replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
const links = [...body.matchAll(/\]\((https?:[^)\s]+)\)/g)].map((m) => m[1]);
const words = body.replace(/\]\([^)]*\)/g, "]").replace(/<[^>]+>/g, " ")
  .split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w)).length;
console.log("words: " + words + (words > 200 ? "  OVER 200" : "  ok"));
if (words > 200) process.exitCode = 1;
(async () => {
  for (const u of links) {
    const r = await fetch(u, { method: "HEAD", redirect: "follow" });
    console.log(r.status + "  " + u);
    if (r.status !== 200) process.exitCode = 1;
  }
})();
' drafts/lab/<slug>.mdx
```

- **Handoff after each task** (per `CLAUDE.md`): tell Artem the draft path, remind him to run `/clear`, and give a short prompt for the next task that routes through `CLAUDE.md`'s session-start protocol, names this plan file and the next task number, and notes that the task's design is already approved (spec above), so no new brainstorm is needed for it.

---

### Task 1: Format section + post #1 "State Without a Database"

**Files:**
- Modify: `docs/lab-direction.md` (add a "Format" section; mark backlog item 1 as drafted)
- Create: `drafts/lab/state-without-a-database.mdx`
- Modify: `PROGRESS.md` (Content Direction & Tony Scraponi section + "How to resume")

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: the `drafts/lab/` folder; the "Format" section in `docs/lab-direction.md` that Tasks 2–4 follow; a "LAB backlog posts" bullet in `PROGRESS.md` that Tasks 2–4 update.

- [ ] **Step 1: Add the Format section to `docs/lab-direction.md`**

Insert this section directly after the "Tagging convention" section (before "Relationship to RESEARCHER"):

```markdown
## Format

New posts are short notes, not essays: English, body ≤ 200 words, in
this order —

1. A one-line hook: the technique or problem.
2. `## What to watch for` — 2–3 bullets: the non-obvious parts, where it
   goes wrong.
3. `## Why it's interesting` — 1–2 bullets: when it pays off.
4. `## In practice` — the real example in this repo, linked to the file
   on GitHub; or, with no example, which direction to look to apply it.

Every concrete claim traces to the repo (commit, diff, spec, plan). The
existing essay post (`cheap-models-strong-graphs.mdx`) predates this
format and stays as-is.

Drafts live in `drafts/lab/<slug>.mdx` — nothing reads that folder, so a
committed draft never reaches the site. Publishing = moving the file into
`content/lab/` (see `docs/superpowers/plans/2026-09-28-lab-backlog-posts.md`,
"Publishing procedure").
```

- [ ] **Step 2: Re-verify post #1's facts**

Run:

```bash
git fetch -q origin agent-data
git rev-list --count origin/agent-data
git log origin/agent-data --reverse --date=short --pretty="%ad %s" | head -2
grep -n "concurrency\|git pull\|git push" .github/workflows/agent-run.yml
curl -sI https://raw.githubusercontent.com/hpnssflw/hpnssflw.github.io/agent-data/agent/status.json | grep -i cache-control
git show c41b696 --stat --oneline
git show 6ad4b2a -- researcher/agent.html docs/agent-plan.md
```

Facts verified 2026-09-28 (confirm, and use the fresh numbers):
- `agent-data` is an orphan branch created 2026-08-15 ("Initialize agent-data branch"); 211 commits as of 2026-09-28 — one per run that changed state.
- `.github/workflows/agent-run.yml`: cron `0 */4 * * *` + `workflow_dispatch`; checks out `main` read-only into `code/` and `agent-data` into `data/`; copies `state.json`/`pending.json`/`status.json` in, runs `python -m agent`, copies them back; commits only if something changed (`git diff --cached --quiet || git commit …`), then `git push`.
- No `concurrency:` key and no pull/rebase before `git push` → two overlapping runs (a manual dispatch during a cron run) would race; the later push is rejected as non-fast-forward and that run's state is lost.
- The first live run failed with a 403: the default `GITHUB_TOKEN` is read-only; fixed with a scoped `permissions: contents: write` (commit `c41b696`).
- `raw.githubusercontent.com` serves the file with `Cache-Control: max-age=300` → the site widget can lag a push by up to 5 minutes.
- The site reads the branch client-side with no token (`lib/agent-status.ts`, `lib/pending-queue.ts` → `raw.githubusercontent.com/.../agent-data/agent/*.json`), which requires a public repo; so `pending.json` (full curated titles, summaries, scores) is public too. The site copy claimed "nothing published, nothing public" until the final whole-plan review corrected it (commit `6ad4b2a`).

- [ ] **Step 3: Write `drafts/lab/state-without-a-database.mdx`**

Frontmatter (edit `excerpt`/`subtitle` wording freely, keep all fields):

```yaml
---
title: State Without a Database
date: "2026-09"
tag: STATE MANAGEMENT
excerpt: A git branch and three JSON files are the research agent's entire backend.
subtitle: One write every four hours doesn't need a database — a git branch does the job, with a few sharp edges.
description: One write every four hours doesn't need a database — a git branch does the job, with a few sharp edges.
---
```

Body: follow the Global Constraints skeleton. Angle: one write per run → a git branch + JSON files instead of a database. `What to watch for` draws from: no concurrency guard (race / rejected push), public repo = public data (`pending.json`, the corrected "nothing public" claim), the 5-minute raw CDN cache, the read-only default token. `Why it's interesting` draws from: zero infrastructure, every state change is a commit (history, diffs, rollback for free). `In practice` links `.github/workflows/agent-run.yml` (branch `main`) and `agent/status.json` (branch `agent-data`). Pick the 2–3 / 1–2 strongest points; ≤ 200 words means not all fit. End the file with the `{/* sources: … */}` comment.

- [ ] **Step 4: Run the draft check command** (Global Constraints) on `drafts/lab/state-without-a-database.mdx`

Expected: `words: N  ok` with N ≤ 200, every link `200`, exit code 0. If over 200, cut — don't shrink the check.

- [ ] **Step 5: Mark backlog item 1 as drafted**

In `docs/lab-direction.md`'s "Backlog" list, append to item 1's first line: ` — drafted: \`drafts/lab/state-without-a-database.mdx\``.

- [ ] **Step 6: Commit the draft**

```bash
git add docs/lab-direction.md drafts/lab/state-without-a-database.mdx
git commit -m "Draft LAB post: State Without a Database

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 7: Update `PROGRESS.md`**

Under "## Content Direction & Tony Scraponi", after the sub-project #4 bullet, add:

```markdown
- **LAB backlog posts: in progress (1 of 4 drafted).** Spec:
  `docs/superpowers/specs/2026-09-28-lab-backlog-posts-design.md`. Plan:
  `docs/superpowers/plans/2026-09-28-lab-backlog-posts.md`. Short-note
  format (≤ 200 words) now in `docs/lab-direction.md`. Drafts live in
  `drafts/lab/` until Artem edits and publishes them.
  - Drafted: `state-without-a-database` (Task 1).
```

In "### How to resume in a new session", replace the Content Direction paragraph's last sentence ("…no confirmed next step for this initiative; …if that's ever picked up.") with: "Active follow-up: the LAB backlog posts plan (`docs/superpowers/plans/2026-09-28-lab-backlog-posts.md`) — next is Task 2; drafts awaiting Artem's edit are listed in the section above."

```bash
git add PROGRESS.md
git commit -m "Reconcile status docs with LAB post 1 drafted

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 8: Hand off** (Global Constraints → Handoff). Next: Task 2.

---

### Task 2: Post #2 "The Email That Never Got Sent"

**Files:**
- Create: `drafts/lab/the-email-that-never-got-sent.mdx`
- Modify: `docs/lab-direction.md` (mark backlog item 2 as drafted)
- Modify: `PROGRESS.md` (LAB backlog posts bullet + "How to resume")

**Interfaces:**
- Consumes: `docs/lab-direction.md`'s "Format" section and `PROGRESS.md`'s "LAB backlog posts" bullet (both added in Task 1).
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Re-verify post #2's facts**

Run:

```bash
git log --date=short --pretty="%ad %h %s" -- agent/deliver.py agent/digest.py agent/pending.py
git show c65c8cb --stat --oneline
git show e2f8dfa --stat --oneline
git show ec64725 --stat --oneline
git show c0a6dc1 --stat --oneline
grep -n "124\|2026-09-18\|2026-08-17" PROGRESS.md
```

Facts verified 2026-09-28 (confirm):
- 2026-08-15 `c65c8cb` "Wire ranking, digest assembly, and SMTP delivery" — SMTP send built as Task 6 of the original agent plan; the live-send step was deferred because `SMTP_*` credentials were never added to `agent/.env`.
- 2026-08-15 `e2f8dfa` "Spec: report storage + dashboard, replacing email delivery for now" and `ec64725` "Decouple email delivery from collection/ranking cadence via a pending queue" — collection moved to every 4h, delivery decoupled onto a queue (`agent/pending.py`), items marked sent only on actual delivery.
- 2026-08-17: Artem chose to drop push delivery and treat the on-page dashboard as the only surface. Per his notes, he had said email was dropped "many times" across sessions, but the docs still listed "add SMTP credentials, send a live email" as the next step, so it kept resurfacing (source: Artem's project memory note, not in git — cite as "author's notes" in the sources comment).
- 2026-09-16: Telegram delivery added back as sub-project #2 of the Content Direction initiative. 2026-09-17 `c0a6dc1` "Rewrite digest/deliver for Telegram, replacing dead SMTP path" — `agent/deliver.py`/`agent/digest.py` rewritten in place.
- 2026-09-18: first real send — a manual workflow run delivered the whole accumulated backlog, 124 items across 5 topics, queue drained to 0 (`PROGRESS.md`, commit `886f97c`). No email was ever sent.

- [ ] **Step 2: Write `drafts/lab/the-email-that-never-got-sent.mdx`**

Frontmatter (edit wording freely, keep all fields):

```yaml
---
title: The Email That Never Got Sent
date: "2026-09"
tag: DELIVERY
excerpt: SMTP delivery was built, pivoted away from twice, and never sent a single message.
subtitle: Picking a delivery channel before anyone reads the output — and why the queue behind it was the part that mattered.
description: Picking a delivery channel before anyone reads the output — and why the queue behind it was the part that mattered.
---
```

Body: Global Constraints skeleton. Angle: the channel was picked before there was a reader; the durable part was the queue. `What to watch for` draws from: SMTP was fully built but blocked on credentials nobody added; stale docs kept resurrecting a decision already reversed; the queue grew silently to 124 items. `Why it's interesting` draws from: decoupling collect/rank from delivery made the channel swappable — Telegram replaced SMTP by rewriting two files in place. `In practice` links `agent/pending.py` and `agent/deliver.py` (branch `main`). End with the `{/* sources: … */}` comment.

- [ ] **Step 3: Run the draft check command** (Global Constraints) on `drafts/lab/the-email-that-never-got-sent.mdx`

Expected: `words: N  ok` with N ≤ 200, every link `200`, exit code 0.

- [ ] **Step 4: Mark backlog item 2 as drafted**

In `docs/lab-direction.md`'s "Backlog" list, append to item 2's first line: ` — drafted: \`drafts/lab/the-email-that-never-got-sent.mdx\``.

- [ ] **Step 5: Commit the draft**

```bash
git add docs/lab-direction.md drafts/lab/the-email-that-never-got-sent.mdx
git commit -m "Draft LAB post: The Email That Never Got Sent

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 6: Update `PROGRESS.md`**

In the "LAB backlog posts" bullet: change "(1 of 4 drafted)" to "(2 of 4 drafted)" (or the current count, if any draft has since been published — then list it as "Published: …"), and append `the-email-that-never-got-sent` (Task 2) to the "Drafted:" line. In "How to resume", change "next is Task 2" to "next is Task 3".

```bash
git add PROGRESS.md
git commit -m "Reconcile status docs with LAB post 2 drafted

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 7: Hand off** (Global Constraints → Handoff). Next: Task 3.

---

### Task 3: Post #3 "Config That Lied"

**Files:**
- Create: `drafts/lab/config-that-lied.mdx`
- Modify: `docs/lab-direction.md` (mark backlog item 3 as drafted)
- Modify: `PROGRESS.md` (LAB backlog posts bullet + "How to resume")

**Interfaces:**
- Consumes: `docs/lab-direction.md`'s "Format" section and `PROGRESS.md`'s "LAB backlog posts" bullet (both added in Task 1).
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Re-verify post #3's facts**

Run:

```bash
git show 8d8033c^:agent/topics/ai-agents.yaml
git show 8d8033c^:agent/main.py | grep -n "CONNECTORS" -A6
git show 8d8033c^:agent/config.py | sed -n 60,85p
git log --date=short --pretty="%ad %h %s" -- agent/topics
git show fdb76dc -- docs/tony-scraponi-roadmap.md | grep -n "dead config" -B4
grep -n "CONNECTORS = " -A4 agent/main.py
grep -n "kinds of source" app/researcher/agent/page.tsx
```

Facts verified 2026-09-28 (confirm):
- From `cd77594` (2026-08-12, agent scaffold) until `8d8033c` (2026-09-16), topic YAMLs declared `reddit`, `rss`, `releases`, and `web_search` sources (e.g. `ai-agents.yaml` listed subreddits, Simon Willison's feed, `anthropics/claude-code` releases, a web-search query).
- `agent/main.py`'s `CONNECTORS` held only `hacker_news`. The run loop iterates `CONNECTORS` and skips any connector not named in `topic.sources` — so lookup ran code → config, and config keys with no connector were silently ignored. `agent/config.py`'s loader passed `sources` through as a raw dict with no validation.
- What caught it: writing the Content Direction roadmap (commit `fdb76dc`, 2026-09-16) required reading `CONNECTORS` to plan the themes rework, which surfaced the mismatch ("dead config"). The rework (`8d8033c`) removed the dead keys.
- It hasn't fully gone away: as of 2026-09-28, `/researcher/agent/` still says "Six kinds of source" and describes RSS, releases, subreddits, and web search, while `CONNECTORS` wires two (`hacker_news`, `github_trending`). If the draft mentions this, state it as currently true — don't claim it's fixed. (If the site copy has been fixed by drafting time, say that instead.)

- [ ] **Step 2: Write `drafts/lab/config-that-lied.mdx`**

Frontmatter (edit wording freely, keep all fields):

```yaml
---
title: Config That Lied
date: "2026-09"
tag: DEAD CONFIG
excerpt: For five weeks the agent's config listed four sources nothing ever read.
subtitle: How config keys with no code behind them survive silently — and the one-line check that would have caught them.
description: How config keys with no code behind them survive silently — and the one-line check that would have caught them.
---
```

(Re-check "five weeks": 2026-08-12 → 2026-09-16 is 35 days.)

Body: Global Constraints skeleton. Angle: config that describes intent instead of behavior. `What to watch for` draws from: lookup direction (code iterates its connectors, never the config's keys, so extras are invisible); a loader that accepts any dict; public copy that repeats the config's claims. `Why it's interesting`: the fix is cheap — reject unknown source keys at load time (direction to look, not implemented here; say so). `In practice` links `agent/main.py` and `agent/config.py` (branch `main`) and references commit `8d8033c`. End with the `{/* sources: … */}` comment.

- [ ] **Step 3: Run the draft check command** (Global Constraints) on `drafts/lab/config-that-lied.mdx`

Expected: `words: N  ok` with N ≤ 200, every link `200`, exit code 0.

- [ ] **Step 4: Mark backlog item 3 as drafted**

In `docs/lab-direction.md`'s "Backlog" list, append to item 3's first line: ` — drafted: \`drafts/lab/config-that-lied.mdx\``.

- [ ] **Step 5: Commit the draft**

```bash
git add docs/lab-direction.md drafts/lab/config-that-lied.mdx
git commit -m "Draft LAB post: Config That Lied

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 6: Update `PROGRESS.md`**

In the "LAB backlog posts" bullet: bump the drafted count, and append `config-that-lied` (Task 3) to the "Drafted:" line (move any since-published posts to a "Published:" line). In "How to resume", change "next is Task 3" to "next is Task 4".

```bash
git add PROGRESS.md
git commit -m "Reconcile status docs with LAB post 3 drafted

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 7: Hand off** (Global Constraints → Handoff). Next: Task 4.

---

### Task 4: Post #4 "Reviewing Your Own Claims"

**Files:**
- Create: `drafts/lab/reviewing-your-own-claims.mdx`
- Modify: `docs/lab-direction.md` (mark backlog item 4 as drafted)
- Modify: `PROGRESS.md` (LAB backlog posts bullet + "How to resume")

**Interfaces:**
- Consumes: `docs/lab-direction.md`'s "Format" section and `PROGRESS.md`'s "LAB backlog posts" bullet (both added in Task 1).
- Produces: nothing.

- [ ] **Step 1: Re-verify post #4's facts**

Run:

```bash
git log --date=short --pretty="%ad %h %s" --grep="final whole-plan review\|final review" -i
git show 6ad4b2a --stat --oneline
git show 6ad4b2a -- researcher/agent.html docs/agent-plan.md
git show 8fb7ee9 --stat --oneline
git show c1bc7b2 --stat --oneline
```

Also read `PROGRESS.md`'s "Final whole-plan review complete — plan shipped" bullet (agent status widget section) and the sub-project #1 and #2 "Final whole-plan review" bullets.

Facts verified 2026-09-28 (confirm):
- Five plans ran via subagent-driven development (agent status widget, themes rework, Telegram delivery, blog content direction, Tony Scraponi MVP): an AI subagent implemented each task, fresh AI reviewers checked it against its own brief (spec compliance, then code quality), then one final review read the whole plan's diff at once. The final pass forced code fixes in three of the five (below); in the blog plan it found two doc cross-reference errors; in the MVP it found no code defects, only one product call.
- Agent status widget plan, final review → fix commit `6ad4b2a` (2026-08-16): the site claimed "nothing published, nothing public" while `agent/pending.json` (full curated titles/summaries/scores) was pushed to the public `agent-data` branch every run; the first rewording still under-claimed (mentioned only `status.json`) and needed a second round. Same pass: the spec's redaction rationale was undercut because the repo had been made public, so the topic config was public anyway; a case-system bug; `pending_email_count` written but never displayed.
- Themes rework, final review → `8fb7ee9` (2026-09-16): one connector's exception could abort a whole topic and that run's delivery; CI ran the GitHub connector unauthenticated (the workflow never passed `GITHUB_TOKEN`); site copy missed the new source.
- Telegram delivery, final review → `c1bc7b2` (2026-09-17): the bot token could leak into the run event log via exception messages; multi-message sends had no pacing or 429 handling.
- Common thread: each finding crossed task boundaries — a claim in copy vs. data another task published, config in one file vs. a workflow in another. No per-task review could see it, because each checked its task against its own brief.

- [ ] **Step 2: Write `drafts/lab/reviewing-your-own-claims.mdx`**

Frontmatter (edit wording freely, keep all fields):

```yaml
---
title: Reviewing Your Own Claims
date: "2026-09"
tag: REVIEW PROCESS
excerpt: Every task passed review. The final pass over the whole plan still found the real problems.
subtitle: Why per-task review can't catch what crosses task boundaries — and what a last whole-plan pass found that no task review did.
description: Why per-task review can't catch what crosses task boundaries — and what a last whole-plan pass found that no task review did.
---
```

Body: Global Constraints skeleton. Angle: per-task review verifies a task against its own brief, so boundary-crossing problems pass every gate. This is the one post where AI is the center: say plainly that implementers and reviewers were AI subagents and the final pass was a separate review of the whole diff. `What to watch for` draws from: the "nothing public" claim vs. `pending.json`; a first fix that still under-claimed; the token leak. `Why it's interesting`: across five plans, the final pass forced code fixes in three — and it's cheap, one extra review per plan. Don't overclaim: it found nothing code-level in the MVP. `In practice` links a fix commit on GitHub (`https://github.com/hpnssflw/hpnssflw.github.io/commit/6ad4b2a8940553f768eaf467ca44a6aabf9468c3`) or the relevant file. End with the `{/* sources: … */}` comment.

- [ ] **Step 3: Run the draft check command** (Global Constraints) on `drafts/lab/reviewing-your-own-claims.mdx`

Expected: `words: N  ok` with N ≤ 200, every link `200`, exit code 0.

- [ ] **Step 4: Mark backlog item 4 as drafted**

In `docs/lab-direction.md`'s "Backlog" list, append to item 4's first line: ` — drafted: \`drafts/lab/reviewing-your-own-claims.mdx\``.

- [ ] **Step 5: Commit the draft**

```bash
git add docs/lab-direction.md drafts/lab/reviewing-your-own-claims.mdx
git commit -m "Draft LAB post: Reviewing Your Own Claims

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 6: Update `PROGRESS.md`**

In the "LAB backlog posts" bullet: change the status to "all 4 drafted" (keep any "Published:" line accurate) and append `reviewing-your-own-claims` (Task 4). In "How to resume", replace "next is Task 4" with "all four drafted; remaining work is Artem's edits and the plan's Publishing procedure, one post at a time".

```bash
git add PROGRESS.md
git commit -m "Reconcile status docs with LAB post 4 drafted

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 7: Hand off.** No next task in this plan — tell Artem all four drafts are ready and list them.

---

## Publishing procedure (per post, when Artem says a draft is ready)

Not a numbered task — triggered by Artem, one post at a time, in any session.

- [ ] **Step 1:** Confirm with Artem which draft, and that his edits are in the file (all `[TODO: Artem — …]` markers resolved: `grep -n "TODO" drafts/lab/<slug>.mdx` returns nothing).
- [ ] **Step 2:** `git mv drafts/lab/<slug>.mdx content/lab/<slug>.mdx`
- [ ] **Step 3:** Delete the trailing `{/* sources: … */}` comment from `content/lab/<slug>.mdx`; set `date:` to the current month (`"YYYY-MM"`).
- [ ] **Step 4:** Run the draft check command (Global Constraints) on `content/lab/<slug>.mdx`. Expected: exit code 0.
- [ ] **Step 5:** `npm test` — expected: all Vitest suites pass.
- [ ] **Step 6:** `npm run build` — expected: `out/lab/<slug>/index.html` exists.
- [ ] **Step 7:** `npm run serve` (runs `npx serve out`, port 3000 by default — use whatever port it prints), then `curl -s http://localhost:3000/lab/<slug>/ | grep -c "<title of the post>"` ≥ 1 and `curl -s http://localhost:3000/lab/ | grep -c "<slug>"` ≥ 1. Stop the server.
- [ ] **Step 8:** In `docs/lab-direction.md`'s backlog, change that item's " — drafted: …" suffix to " — published: `/lab/<slug>/`". In `PROGRESS.md`'s "LAB backlog posts" bullet, move the slug from "Drafted:" to "Published:".
- [ ] **Step 9:** Commit and push (the push deploys — Artem's "ready" is the go-ahead):

```bash
git add content/lab/<slug>.mdx docs/lab-direction.md PROGRESS.md
git commit -m "Publish LAB post: <Title>

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push
```

- [ ] **Step 10:** `gh run list --workflow deploy.yml --limit 1` until it shows `completed success`, then confirm `https://hpnssflw.github.io/lab/<slug>/` returns 200.
