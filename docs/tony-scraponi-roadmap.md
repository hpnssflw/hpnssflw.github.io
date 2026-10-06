# Content Direction & Tony Scraponi — Roadmap

A third initiative alongside the site and the research agent (see
`PROGRESS.md`'s "Content Direction & Tony Scraponi" section for live
status). This doc is background: what the pieces are and why they're
ordered this way. It doesn't track status — `PROGRESS.md` does.

## Source material

The full product vision for Tony Scraponi — a separate control/monitor
app for a personal research-and-publishing agent — lives outside this
repo, in the user's Obsidian vault (not tracked in git, referenced here
for continuity across sessions):

- `Obsidian Vault/tony scraponi/personal-data-collection-agent-plan.md` —
  product direction, themes, data flow, publishing, queue model, UI
  screens, suggested stack (Next.js + FastAPI + Postgres + Redis +
  Celery/BullMQ), service boundaries, MVP phases.
- `Obsidian Vault/tony scraponi/tony-scraponi-design-direction.md` —
  visual design system for that future app: dark minimal, green/red
  status semantics, spacing/type/component rules.

That plan describes the eventual standalone product. What we build here,
inside this repo, is a much smaller first cut — see item 4 below.

## Themes (used by both the agent and Tony Scraponi's theme model)

1. **Web Products** — product/web trends, securities & market data, data
   visualization, browser performance, web architecture, SEO.
2. **AI Engineering** — agent/automated pipelines and harnesses, LLM
   assistants, self-hosted/private AI platform development, LLM/inference
   optimization.
3. **Tooling** — tools developers use to build software: editors, CLIs,
   libraries, and AI coding tools. (Until sub-project #6 this read
   "trending GitHub repos, web development tools"; a trending repo that
   isn't a developer tool no longer qualifies.)

## Sub-projects, in order

Each gets its own brainstorm → spec → plan → implementation cycle before
the next one starts.

1. **Agent themes rework.** Replace the current `ai-agents` /
   `data-viz` / `full-stack` topic configs with the three themes above.
   Reconcile config with reality: `agent/main.py`'s `CONNECTORS` dict
   only wires up `hacker_news` today, but the topic YAMLs already
   reference `reddit`, `rss`, `releases`, and `web_search` keys that no
   connector reads — dead config. The `Tooling` theme (GitHub trending)
   needs at least one real new connector to mean anything.
2. **Telegram delivery.** A Telegram publisher for the agent, plus a
   link to the channel on the branding site. Supersedes the dead SMTP
   path per the delivery-pivot decision already on file.
3. **Blog content & direction.** What the LAB/RESEARCHER pages actually
   say — separate from agent internals, site-side work.
4. **Tony Scraponi MVP.** A single page inside *this* repo — not the
   separate FastAPI/Postgres/Redis app the full plan describes. Reuses
   this repo's existing pattern (JSON state files + GitHub Actions,
   as already proven by the agent status widget) rather than standing up
   a new backend stack. Source/topic visibility and monitoring first;
   full control (editing sources, triggering runs, scraper creation
   wizard, multi-platform publishing) is later scope, explicitly gated
   on this MVP (or an MVP+) proving out before Tony Scraponi is split
   into its own project — see the Obsidian plan's "Phase 2/3" for what
   that split eventually includes.
5. **Inbox (moderated delivery).** Approve/reject each queued item on
   `/researcher/queue/`; only approved items go to Telegram. Decisions
   live in a separate public repo, `hpnssflw/tony-inbox`, so the
   browser-held token can't write to this one. Spec:
   `docs/superpowers/specs/2026-09-28-tony-scraponi-inbox-design.md`.
6. **Topic & source quality.** Strict title-only HN search, GitHub
   topic queries for every topic, per-topic include/exclude criteria
   for the ranker, a verdict cache so an item is scored once, and a
   daily cap per topic. Spec:
   `docs/superpowers/specs/2026-09-30-topic-source-quality-design.md`.
7. **A Web Products source.** Hacker News barely covers market data,
   dataviz and SEO, so Web Products needs a source of its own (RSS or
   otherwise) — designed once #6's numbers are in.

Later candidate: give the ranker Artem's recent inbox decisions as
few-shot examples, once there are 30–50 of them.

`agent/panel.py` + `agent/panel_page.html` (a local-only, `127.0.0.1`
monitoring panel built by a separate concurrent session — see
`PROGRESS.md`'s note under the agent status widget section) is directly
relevant groundwork for item 4 and should be reviewed before designing
it, rather than duplicated.

## Content engine (sub-projects A–D)

From 2026-10-06 the agent becomes a configurable content-pipeline
engine — sources → filter → processing → formatting → approval →
delivery — with one preset file per client and Tony as the first preset
(research: `docs/research/oss-reuse.md`, local notes). Each sub-project
gets its own spec → plan → implementation cycle:

- **A. Engine core + presets** — `Item`, presets, two source scopes
  (topic feeds; preset feeds classified across topics), RSS and full
  text ported from Horizon (MIT), `--data-dir`, `--offline`,
  `run-result.json`; Tony unchanged; newsroom and agro demo presets on
  offline fixtures. Spec:
  `docs/superpowers/specs/2026-10-06-content-engine-core-design.md`.
- **B. Stories** — one news item across sources, "who was first", facts
  tied to their sources.
- **C. Approval and delivery** — Telegram buttons as a second approval
  adapter; several delivery targets per preset.
- **D. Preset switcher in the control room** — the site reads each
  preset's `run-result.json`; Tony's settings then move into
  `agent/presets/tony.yaml`.

Item 7 above becomes a topic-scoped `rss` entry for Web Products. A
alone isn't enough: Tony's topics still load through `agent/config.py`,
which doesn't read `sources.rss`, so the entry needs either that loader
taught to read topic feeds or Tony's settings moved into
`agent/presets/tony.yaml` (D). `agent/topics/*.yaml` is also a file the
control room reads, so #7 lands after D or together with the control
room's support for it.
