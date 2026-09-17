# LAB — Direction & Voice

Background: `docs/tony-scraponi-roadmap.md`'s sub-project #3 (Blog
content & direction) and
`docs/superpowers/specs/2026-09-17-blog-content-direction-design.md`.

## What LAB is

Personal essays and lessons-learned from building and running things —
not curated links. RESEARCHER's three themes (Web Products, AI
Engineering, Tooling — see `app/researcher/page.tsx`) are the research
agent's curated beat: machine-surfaced links, ranked and delivered
automatically. LAB is the opposite of that — it's Artem's own writing,
in his own voice.

LAB's scope is the same general territory as those three themes, as a
loose center of gravity, not a hard boundary. A post outside them is
fine as long as it's genuinely a lesson learned from building or
running something.

## Tagging convention

Each post gets one freeform tag in its frontmatter: short (1–3 words),
specific to what the post is actually about, not a generic category.

- Good: `AGENT ARCHITECTURE`, `STATE MANAGEMENT`, `INCIDENT REVIEW`
- Bad: `AI`, `ENGINEERING`, `MISC`

There's no fixed list enforced anywhere in code — `lib/posts.ts` reads
whatever string is in a post's `tag:` frontmatter field. This is a
convention for whoever's picking the tag, not a schema.

## Relationship to RESEARCHER

RESEARCHER (`app/researcher/page.tsx`) and LAB cover similar ground but
serve different purposes: RESEARCHER is what the agent found; LAB is
what Artem thought about it. Don't reuse RESEARCHER's three theme names
as LAB tags — see "Tagging convention" above.

## Backlog — candidate next posts

1. **State without a database** — using a git branch (`agent-data`) +
   JSON files as the entire backend for the status widget, instead of
   standing up a database for what's fundamentally a single write per
   run.
2. **The email that never got sent** — why SMTP delivery got planned,
   built, then dropped twice (once for the on-page dashboard, once for
   Telegram) before anything ever shipped, and what that says about
   picking a delivery mechanism before you have users.
3. **Config that lied** — the themes rework's discovery that topic
   YAMLs referenced `reddit`/`rss`/`releases`/`web_search` keys no
   connector ever read; how dead config accumulates silently and what
   actually caught it.
4. **Reviewing your own claims** — what the final whole-plan reviews
   kept finding that per-task review missed (the `pending.json`
   exposure, the redaction rationale half-defeated by public topic
   config) — the case for a last cross-cutting pass even when every
   task passed individually.
