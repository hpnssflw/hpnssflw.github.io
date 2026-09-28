# LAB Backlog Posts — Design

Follow-up to the Blog content & direction sub-project
(`docs/superpowers/specs/2026-09-17-blog-content-direction-design.md`),
which left four candidate posts in `docs/lab-direction.md`'s backlog.
This writes them.

## Decisions (confirmed with the user, 2026-09-28)

- **Authorship:** Claude drafts each post in full from repo facts; Artem
  edits before anything is published.
- **Scope:** all four backlog posts, one post per plan task, `/clear`
  between tasks.
- **Drafts:** live in `drafts/lab/<slug>.mdx`, committed. Nothing reads
  that folder, so a committed draft never reaches the site. Publishing
  = moving the file into `content/lab/`.
- **AI mention:** honest, where relevant — the center of post #4, at
  most one sentence in #1–#3.

## Post format

Short notes, not essays. English, like the rest of the site.

- **Length:** body ≤ 200 words (frontmatter and the sources comment
  don't count).
- **Frontmatter:** same fields as the existing post — `title`, `date`
  (`"YYYY-MM"` of publication), `tag`, `excerpt`, `subtitle`,
  `description`. One freeform tag per `docs/lab-direction.md`'s
  convention, never a RESEARCHER theme name. Working tags:
  `STATE MANAGEMENT`, `DELIVERY`, `DEAD CONFIG`, `REVIEW PROCESS` —
  final pick per task.
- **Body skeleton:**
  1. One-line hook — the technique or problem.
  2. `## What to watch for` — 2–3 bullets: the non-obvious parts, where
     it goes wrong.
  3. `## Why it's interesting` — 1–2 bullets: when it pays off.
  4. `## In practice` — the real example in this repo, linked to the
     file on GitHub
     (`https://github.com/hpnssflw/hpnssflw.github.io/blob/<branch>/<path>`);
     or, where there's no example, which direction to look to apply it.
- **Accuracy:** every concrete claim (number, file, decision, sequence
  of events) must trace to the repo — a commit, diff, spec, or plan.
  Nothing invented for color. A missing fact becomes a visible
  `[TODO: Artem — …]` in the draft, not a guess.
- **Sources comment:** each draft ends with an MDX comment
  `{/* sources: … */}` listing the commits/files each claim came from,
  for Artem's review. Removed on publish.

No code or CSS changes: `app/globals.css` already styles `ul`/`li`,
`code`, and links inside `.post .body`, and `lib/posts.test.ts` makes no
assumption about the number of posts.

## The four posts

Angles, not final copy — facts get re-verified in each task.

1. **State without a database** (`state-without-a-database`) — the
   `agent-data` branch + JSON files as the agent's entire backend.
   Watch for: one writer per branch, yet `agent-run.yml` has no
   `concurrency` guard; a public repo means public data
   (`pending.json`); raw.githubusercontent.com caching (verify the
   actual `Cache-Control` with `curl -I` before claiming a number).
   Interesting: zero infra, full history for free via git. Example:
   `.github/workflows/agent-run.yml`, `agent/status.json` on
   `agent-data`.
2. **The email that never got sent** (`the-email-that-never-got-sent`)
   — SMTP delivery was built (`c65c8cb`), its credentials were never
   added, the plan pivoted twice (dashboard, then Telegram), and the
   queue reached 124 items before the first real send. Lesson: build
   the queue/state first, pick the channel last. Example:
   `agent/pending.py` (`ec64725`), `agent/deliver.py` rewritten in place
   for Telegram.
3. **Config that lied** (`config-that-lied`) — topic YAMLs carried
   `reddit`/`rss`/`releases`/`web_search` keys no connector read; the
   loader never rejected unknown keys. What caught it: the themes
   rework forced reading `agent/main.py`'s `CONNECTORS`. Direction:
   strict config schema that rejects unknown keys. Example: `8d8033c`.
4. **Reviewing your own claims** (`reviewing-your-own-claims`) —
   per-task review checks a task against its own brief; the final
   whole-plan pass caught what none could see alone (the site's
   "nothing published, nothing public" claim vs. `pending.json` being
   pushed publicly; the redaction rationale undercut by public topic
   config). The reviewers were AI subagents. Example: the agent status
   widget plan's final review.

## Process per task

1. Gather facts for the post from `git log`/diffs/specs/plans.
2. Write `drafts/lab/<slug>.mdx` in the format above.
3. Verify: body ≤ 200 words; frontmatter parses (`gray-matter`, same as
   `lib/posts.ts`); every GitHub link returns 200.
4. Commit the draft; hand off to Artem for editing; `/clear`.

Task 1 also adds a **Format** section to `docs/lab-direction.md`
describing the short-note format above (the existing essay post stays
as-is), and marks drafted posts in its backlog.

## Publishing (separate micro-step, per post)

Triggered when Artem says a draft is ready: `git mv` it into
`content/lab/`, strip the sources comment, set `date`, run `npm test`,
`npm run build`, `npm run serve`, confirm `/lab/<slug>/` renders and
appears in the `/lab/` feed, commit, push (the push deploys).

## Out of scope

Rewriting the existing essay post; a `draft:` frontmatter flag or any
change to `lib/posts.ts`; new CSS; RSS/feeds; posts beyond the four in
the backlog.
