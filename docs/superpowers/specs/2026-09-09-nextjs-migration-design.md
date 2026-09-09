# Site migration to Next.js + shared navigation

## Purpose

Rebuild the static site as a statically-exported Next.js (App Router,
TypeScript) application, and in doing so fix the cross-page navigation UX.

Two problems drive this:

1. **No shared navigation.** Every sub-page invents its own back-link
   (`← Home` on `lab/index.html`, `← RESEARCHER` on `researcher/agent.html`,
   etc.). There is no way to move from `/lab/` to `/researcher/` without
   returning home, and no "you are here" indication anywhere. Every
   navigation is a full document load — visible flash, scroll jump to top.
2. The site should run on **Next.js** — this is a goal in itself (future
   features, tooling familiarity), not only a means to (1).

The outcome is the same site, visually near-identical, with one persistent
header + footer rendered by a shared layout and client-side routing between
pages.

## Supersedes

This spec knowingly revises standing conventions in `CLAUDE.md`:

- **"static HTML/CSS", "no build step", "no framework", "deliberately plain
  HTML/CSS"** — the site now has a build step (`next build`), a framework
  (Next.js), and a Node toolchain. `CLAUDE.md`'s "Conventions" and "Do not"
  sections and the session-start protocol are rewritten as part of this work
  (task 11).
- **Verify site changes by serving with `python -m http.server 5678`** —
  replaced by `npm run dev` (development) and `npm run build && npx serve out`
  (production parity).
- **`assets/agent-widget.js` as a sanctioned one-time JS exception** — the
  widget becomes a normal React component (`components/AgentWidget.tsx`); the
  "one-time exception" framing no longer applies because JS is now the norm
  for the site.

Unchanged: commits go directly to `main` (no feature branch, no PR flow);
small focused commits; never stage `.claude/settings.local.json`; the
`researcher/agent` page and `docs/agent-plan.md` stay loosely in sync.

## Out of scope

The Python research agent (`agent/`), its `.github/workflows/agent-run.yml`
workflow, the `agent-data` branch, and `agent/panel_page.html` (the agent's
local run panel) are untouched. `docs/agent-plan.md` is edited only to fix
the one cross-reference path (`researcher/agent.html` → `/researcher/agent/`).

No visual redesign. No new pages. No CMS. No `next/font` (the current site
ships no webfonts — it relies on the system stack — and that is preserved).

## Decisions

| Topic | Decision |
|---|---|
| Framework | Next.js latest stable, App Router, **TypeScript** |
| Rendering | Static export: `output: 'export'`, `trailingSlash: true`, `images.unoptimized: true`. Served at domain root — no `basePath` |
| Styling | Plain CSS. **No Tailwind.** `styles.css` ported ~verbatim to `app/globals.css`; the design-token system and the "case system" (presentational `text-transform` only) are preserved |
| LAB posts | **MDX** in `content/lab/` with frontmatter, rendered through a `lab/[slug]` route |
| Header | **Minimal text nav only.** Name (→ home) left; `LAB` · `RESEARCHER` right; mono, uppercase, `--muted`, static (not sticky); active route → `--text-strong` + underline. This *replaces* the per-page ad-hoc back-links — the header is the navigation |
| Widget | `assets/agent-widget.js` → `components/AgentWidget.tsx` (`'use client'`), `variant: 'compact' | 'dashboard'` |
| Tests | **Vitest** — `lib/posts` (frontmatter parse + sort) and `lib/agent-status` (`isStale`, `sparkline`, `fmtCountdown`) |
| Hosting | GitHub Pages **"GitHub Actions" build** (flipped from "legacy / deploy from `main`"). `.github/workflows/deploy.yml` runs `next build` and publishes `out/` |
| Old URLs | `/lab/…​.html` and `/researcher/agent.html` kept alive by `public/**.html` redirect stubs |

## Architecture

```
app/
  layout.tsx           root <html>/<body>; <SiteHeader/> + {children} + <SiteFooter/>
  page.tsx             home — wraps content in <div className="home">
  globals.css          ported design system
  lab/page.tsx         post list  (lib/posts)
  lab/[slug]/page.tsx  MDX post; generateStaticParams() from content/lab/
  researcher/page.tsx
  researcher/agent/page.tsx
components/
  SiteHeader.tsx       'use client' — usePathname() for the active link
  SiteFooter.tsx       server component
  AgentWidget.tsx      'use client' — fetch + render, both variants
lib/
  posts.ts             fs-read content/lab/*.mdx, gray-matter, sort by date desc
  agent-status.ts      pure helpers extracted from the old widget script
content/lab/
  cheap-models-strong-graphs.mdx
public/
  photo.jpg, assets/grid-texture.svg, .nojekyll,
  lab/cheap-models-strong-graphs.html, researcher/agent.html   (redirect stubs)
next.config.mjs  package.json  tsconfig.json  next-env.d.ts  vitest.config.ts
.github/workflows/deploy.yml
```

Runtime dependencies kept deliberately small: `next`, `react`, `react-dom`,
`next-mdx-remote`, `gray-matter`. Dev: `typescript`, `@types/*`, `vitest`,
`eslint`, `eslint-config-next`.

### Navigation

The root `app/layout.tsx` renders exactly one `<SiteHeader>` and one
`<SiteFooter>` around `{children}`. That single fact resolves the
inconsistency — every route gets the identical chrome. `<SiteHeader>` is a
client component using `usePathname()` to mark the active link. All internal
links are `next/link` → client-side transitions, no full reload. The
per-page `.back` links (`← LAB`, `← RESEARCHER`, `← Home`) are removed.

### CSS port

`styles.css` → `app/globals.css` verbatim except:

- `background-image: url("assets/grid-texture.svg")` → `url("/assets/grid-texture.svg")`;
  delete the `body.subpage` texture override (the `../` path hack is obsolete).
- `body.home …` selectors → `.home …` (class on the home page's wrapper div).
- `#lab.standalone` / `#researcher.standalone` — kept, as literal classNames.
- Add a `.site-header` block.
- Trim top padding now that a header sits above content: `#hero` `200px` →
  ~`120px`, `.standalone` `padding-top` `140px` → ~`80px` (tuned by visual diff).
- The agent-widget CSS section is kept. The old JS did
  `label.toUpperCase()` / `.toLowerCase()` on content strings — a prior
  review flagged this as violating "the transform is presentational only".
  The component renders lowercase markup and lets CSS `text-transform`
  handle it.

### AgentWidget

Direct port of `assets/agent-widget.js`:

- `useEffect` → `fetch(STATUS_URL, { cache: 'no-store' })`; `loading` state,
  then render, or `"agent status unavailable"` on any error (unchanged
  behaviour).
- `STATUS_URL` updated to the current repo name
  (`raw.githubusercontent.com/hpnssflw/hpnssflw.github.io/agent-data/agent/status.json` —
  the repo was renamed from `webpage`).
- Countdown via `setInterval` inside `useEffect`, cleared on unmount.
- `isStale` / `sparkline` / `fmtCountdown` move to `lib/agent-status.ts`
  (pure, unit-tested).
- JSX interpolation replaces all `innerHTML` string building; the hand-rolled
  `escapeHtml` is dropped (JSX escapes by default).
- `variant="compact"` — the homepage card (links to `/researcher/agent/`).
  `variant="dashboard"` — the funnel + ticker view on the agent page.

### LAB / MDX

- `content/lab/cheap-models-strong-graphs.mdx` — frontmatter: `title`,
  `date` (`"2026-08"`), `tag` (`"AI AGENTS"`), `excerpt`, `description`.
  Body is the current post prose as Markdown. Numbered `<h2>`s keep the
  existing explicit inline form
  (`## <span className="num">01</span>Small steps beat large context`); the
  final "What I'd tell myself in May" heading stays unnumbered — the
  numbering is manual, never automatic.
- `lib/posts.ts` — `getAllPosts()`, `getPostSlugs()`, `getPost(slug)`.
- `app/lab/[slug]/page.tsx` — `generateStaticParams` from `getPostSlugs()`;
  render via `next-mdx-remote/rsc` `compileMDX`, wrapped in
  `<article class="post"><div class="wrap"> … <div class="body">{mdx}</div></div></article>`
  so the existing `.post .body` rules style it. Per-post `generateMetadata`.

### URL preservation

| Now | After |
|---|---|
| `/`, `/lab/`, `/researcher/` | unchanged (`trailingSlash: true`) |
| `/lab/cheap-models-strong-graphs.html` | `/lab/cheap-models-strong-graphs/` |
| `/researcher/agent.html` | `/researcher/agent/` |

Each changed path gets a stub in `public/` — an HTML file with
`<meta http-equiv="refresh" content="0; url=/new/path/">` and
`<link rel="canonical">`. The export emits it at the old path next to the
real route's `index.html`; no collision.

### Deployment

`.github/workflows/deploy.yml` — `on: push (main), workflow_dispatch`;
`permissions: contents:read, pages:write, id-token:write`;
`concurrency: pages`. Build job: `checkout` → `setup-node@v4` (node 20, npm
cache) → `npm ci` → `npm run build` → `configure-pages@v5` →
`upload-pages-artifact@v3` (`out`). Deploy job: `needs: build` →
`deploy-pages@v4`, `environment: github-pages`.

Then flip the Pages source:
`gh api -X PUT repos/hpnssflw/hpnssflw.github.io/pages -f "build_type=workflow"`
(or the Settings → Pages UI).

`agent-run.yml` targets only `agent-data`, so the new workflow's
`branches: [main]` trigger never overlaps with it.

**Live-site safety.** Legacy Pages keeps serving the existing HTML for the
whole migration — it simply ignores `app/`, `package.json`, etc. A root
`.nojekyll` is added early so Jekyll never touches the tree. The cutover
(delete old HTML, flip Pages to `workflow`, first Actions deploy) is a
single late task. No feature branch.

## Verification

- **Dev, per route:** `npm run dev`; visit `/`, `/lab/`,
  `/lab/cheap-models-strong-graphs/`, `/researcher/`, `/researcher/agent/`;
  click every nav link — no full reload, correct active state, identical
  header/footer everywhere.
- **Static export:** `npm run build`; `out/` contains
  `index.html`, `lab/index.html`, `lab/cheap-models-strong-graphs/index.html`,
  `researcher/index.html`, `researcher/agent/index.html`, the two
  `*.html` redirect stubs, `_next/…`, `.nojekyll`.
- **Visual parity:** current site was snapshotted (5 pages curled to the
  scratchpad) before any deletion. After the port, `npx serve out` and
  compare — differences limited to the new header + trimmed top padding.
- **Tests:** `npm test` green.
- **Widget:** `/` and `/researcher/agent/` render live `status.json` with
  network on; show `"agent status unavailable"` with the request blocked.
- **Post-deploy:** `curl -I` the live domain for all 5 routes (200) and
  both old `.html` paths (200 + redirect). Confirm `agent-run.yml` still
  runs on schedule.
