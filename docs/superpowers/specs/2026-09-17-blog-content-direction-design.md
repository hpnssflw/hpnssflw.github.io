# Blog Content & Direction — Design

Sub-project #3 of the Content Direction & Tony Scraponi initiative (see
`docs/tony-scraponi-roadmap.md` and `PROGRESS.md`). Site-side work, separate
from agent internals — sub-projects #1 (agent themes rework) and #2
(Telegram delivery) are done.

## Problem

RESEARCHER and LAB currently conflate two different things:

- RESEARCHER's three themes (Web Products, AI Engineering, Tooling) are the
  research agent's curated beat — machine-surfaced links, defined in
  `agent/topics/*.yaml` and mirrored as site copy.
- LAB is Artem's own writing. Its one existing post
  (`content/lab/cheap-models-strong-graphs.mdx`) is tagged `AI AGENTS` — a
  name that predates the themes rework and no longer matches anything on
  RESEARCHER. There's no stated scope or tagging convention for LAB, so
  nothing stops future posts from drifting the same way.

Separately, the RESEARCHER topic list itself is hand-copied verbatim in both
`app/page.tsx` and `app/researcher/page.tsx` — a straightforward drift risk
now that it has two copies to keep in sync.

## Goal

Establish LAB as its own thing — same general territory as RESEARCHER's
three themes as a loose center of gravity, not a hard boundary, written in
Artem's voice rather than curated — and stop the copy from drifting further
in either section.

## Scope

1. A short **LAB direction doc**, `docs/lab-direction.md`.
2. **Retag** the existing LAB post.
3. **De-duplicate** the RESEARCHER topic list between the two pages that
   render it.
4. A **short backlog** of candidate next posts, inside the direction doc.

Out of scope: reconciling RESEARCHER's site copy with `agent/topics/*.yaml`
(separate data source, agent-side); writing any new post in full; a fixed
tag enum enforced in code.

## 1. `docs/lab-direction.md`

Sections:

- **What LAB is** — personal essays and lessons-learned from building and
  running things, not curated links. Same general territory as RESEARCHER's
  three themes (web products, AI engineering, tooling) as a loose center of
  gravity, not a hard boundary — a post outside those themes is fine if it's
  genuinely a lesson learned.
- **Tagging convention** — freeform, one tag per post, short (1–3 words),
  specific to the post's actual subject rather than a generic category
  (e.g. "AGENT ARCHITECTURE" beats "AI"). A guideline with a couple of
  good/bad examples, not an enum — MDX frontmatter already accepts any
  string, so nothing in code enforces this.
- **Relationship to RESEARCHER** — one sentence pointing at
  `app/researcher/page.tsx`'s three themes, so a future session doesn't
  reintroduce the conflation this sub-project is fixing.
- **Backlog** — candidate next posts, title + one-sentence angle each, same
  register as the existing post's frontmatter `excerpt`:
  1. "State without a database" — using a git branch (`agent-data`) + JSON
     files as the entire backend for the status widget, instead of standing
     up a database for what's fundamentally a single write per run.
  2. "The email that never got sent" — why SMTP delivery got planned,
     built, then dropped twice (once for the on-page dashboard, once for
     Telegram) before anything ever shipped, and what that says about
     picking a delivery mechanism before you have users.
  3. "Config that lied" — the themes rework's discovery that topic YAMLs
     referenced `reddit`/`rss`/`releases`/`web_search` keys no connector
     ever read; how dead config accumulates silently and what actually
     caught it.
  4. "Reviewing your own claims" — what the final whole-plan reviews kept
     finding that per-task review missed (the `pending.json` exposure, the
     redaction rationale half-defeated by public topic config) — the case
     for a last cross-cutting pass even when every task passed
     individually.

`CLAUDE.md`'s session-start protocol gets a one-line pointer to this doc,
mirroring the existing pointers to `docs/agent-plan.md` and
`docs/tony-scraponi-roadmap.md`, so future LAB work reads it first.

## 2. Retag the existing post

`cheap-models-strong-graphs.mdx`'s `tag:` frontmatter field changes from
`AI AGENTS` to `AGENT ARCHITECTURE` — specific to what the post is actually
about (pipeline/architecture decisions), distinct from RESEARCHER's "AI
Engineering". No content changes.

## 3. De-duplicate the RESEARCHER topic list

- New `lib/topics.ts` (parallel to `lib/posts.ts`), exporting a `Topic[]`:
  `{ name: string; gloss: string; href?: string }` for the three RESEARCHER
  themes. Only "AI Engineering" gets an `href` (`/researcher/agent/`).
- New `components/ResearcherTopics.tsx` rendering that array into the
  existing `<ul className="topics">` markup — same DOM structure and CSS
  classes as today (`topic-name`, `topic-gloss`), so `app/globals.css` needs
  no changes.
- `app/page.tsx` and `app/researcher/page.tsx` each replace their inline
  `<ul className="topics">` block with `<ResearcherTopics />`.
- `app/researcher/agent/page.tsx` and `agent/topics/*.yaml` are untouched —
  separate data source (agent config vs. site copy), reconciling them is a
  different problem from this sub-project's.

## Testing

No new runtime behavior to unit-test (`ResearcherTopics` is static content
rendering, matching the existing untested `app/page.tsx`/`app/researcher/
page.tsx` pattern). Verify by building and serving the export
(`npm run build && npm run serve`) and visually confirming both pages still
render the identical topic list they do today, plus `npm test` staying
green.
