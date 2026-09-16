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
3. **Tooling** — trending GitHub repos, web development tools.

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

`agent/panel.py` + `agent/panel_page.html` (a local-only, `127.0.0.1`
monitoring panel built by a separate concurrent session — see
`PROGRESS.md`'s note under the agent status widget section) is directly
relevant groundwork for item 4 and should be reviewed before designing
it, rather than duplicated.
