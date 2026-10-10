# Preset Select — Design

An amendment to the preset switcher (content engine sub-project D,
`docs/superpowers/specs/2026-10-06-preset-switcher-design.md`). D made the
demo section `/researcher/demo/<slug>/` unlisted: `noindex, nofollow`, no
link from any other page, Artem sending direct links. That is reversed
here.

## Problem

`/researcher/queue/` (Tony's control room) shows one preset and has no way
to reach the other two (`newsroom-demo`, `agro-demo`). The demo pages link
to each other and to Tony (`cr-demo-nav`), but nothing leads to them.

## Goal

Every visitor can switch between the three presets from either page, and
search engines can find and index the demo pages.

## Decisions (settled during brainstorming, 2026-10-10)

- **Visible to everyone**, not only in owner mode. The demo section stops
  being unlisted.
- **Picking a demo navigates to its existing page**
  (`/researcher/demo/<slug>/`). The demo stays its own section; nothing is
  rendered in place on `/researcher/queue/`, and no URL changes.
- **Indexable**: the demo pages lose `robots: {index: false, follow: false}`.
  No sitemap is added (the site has none).
- **A dropdown of real links** (`<details>` + `<a>`), not a native
  `<select>`: it works without JS and gives crawlers ordinary links.
- **The same component on both pages**; on the demo pages it replaces the
  row of links in `cr-demo-nav`.
- **Built from `origin/main`** on branch `worktree-preset-select`, apart
  from content engine C (unpushed on `worktree-stories`). It is a site-only
  change and goes live on its own; C's branch is rebased onto `main`
  before C's rollout.

## Data: `presetLinks()`

`lib/demo-presets.ts` gains a pure build-time function:

```ts
export interface PresetLink { slug: string; name: string; href: string; live: boolean }
export function presetLinks(root?: string): PresetLink[]
```

- First Tony: `{slug: "tony", name: "Tony Scraponi", href: "/researcher/queue/", live: true}`.
  The name is a constant, as in `ControlPulse`: the site no longer parses
  agent YAML (D, § 3), and Tony's `run-result.json` is fetched client-side.
- Then each of `DEMO_SLUGS` in order:
  `{slug, name: <run1.json's preset.name>, href: "/researcher/demo/<slug>/", live: false}`.
- `demoLinks()` and `DemoLink` are replaced by it (their only caller is the
  demo page).
- Like the rest of the file it is server-only (`node:fs`): the two pages
  call it at build time; client components import the `PresetLink` type
  alone.

## Component: `components/PresetSwitch.tsx`

Props: `presets: PresetLink[]`, `current: string` (a slug), `text:
{label: string; live: string}`.

- `<details className="cr-preset">`; `<summary>` shows the current
  preset's name and a caret; `aria-label` on the wrapping `<nav>` is
  `text.label`.
- The open list (`<ul>`) holds one `next/link` per preset; the current one
  carries `aria-current="page"`; Tony's entry adds a lime `text.live`
  tag. Names are shown as each preset wrote them, in its own language.
- Client JS only closes it: on Escape (focus returns to the summary) and on
  a pointer-down outside the element, both listening only while open.
  Without JS it opens and closes natively and the links work.
- Styling in `app/globals.css` with the existing tokens (`--muted`,
  `--text-strong`, the `cr-` pane surface). The list is positioned under
  the summary and must fit a 390px viewport.

## Wiring

- `/researcher/queue/`: `app/researcher/queue/page.tsx` passes
  `presetLinks()` to `ControlRoom`, which passes it to `ControlPulse`.
- `/researcher/demo/<slug>/`: `DemoRoom` takes `PresetLink[]` and renders
  `PresetSwitch` in place of `cr-demo-nav`'s links.
- Dictionary (`lib/control-room-text.ts`): `demo.switcher` and
  `demo.tonyLive` move to a top-level `presets: {label, live}` in both
  languages (en: "Presets", "live"; ru: "Пресеты", "live"), since the
  English control room now uses them too.
- **Placement in the header** is picked by Artem from rendered variants
  (1440 and 390 px) before it is final: (a) the preset name in the header
  becomes the switch ("Tony Scraponi ▾ control room"); (b) the switch sits
  at the header's right end. Both pages use the same placement.

## Indexing

`app/researcher/demo/[slug]/page.tsx`'s `generateMetadata` drops `robots`;
its "Unlisted" comment is rewritten. `/researcher/queue/`'s metadata is
unchanged.

## Testing

- Vitest (`lib/demo-presets.test.ts`): `presetLinks()` returns Tony first,
  then both demos in `DEMO_SLUGS` order, with the hrefs above, `live` only
  on Tony, and the demos' names from their goldens.
- `npm run build`: `out/researcher/queue/index.html` contains
  `href="/researcher/demo/newsroom-demo/"` and
  `href="/researcher/demo/agro-demo/"`; neither demo page's HTML contains
  `noindex`.
- Headless (`npm run serve`), both pages at 1440×900 and 390 px wide: the
  switch opens on click, closes on Escape and on a click outside, the
  current preset is marked, and each link lands on its page.

## Docs

- `CLAUDE.md`: the demo-section bullet — no longer unlisted; linked from
  the preset switch on `/researcher/queue/` and indexable.
- `PROGRESS.md` and `docs/tony-scraponi-roadmap.md` (D's line): the switch
  shipped; C's rollout step notes the rebase onto `main`.

## Out of scope

- Rendering a demo inside `/researcher/queue/`.
- A sitemap, an index page for `/researcher/demo/`.
- Live presets other than Tony (each would need its own `run-result.json`
  on `agent-data`).
