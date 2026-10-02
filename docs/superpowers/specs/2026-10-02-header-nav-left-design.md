# Header Nav on the Left — Design

The home redesign (`bb39ce0`, `PROGRESS.md` → "Site") put every route on
one 1040px container with content flush left and long prose on the 592px
reading column. The shared header on inner routes
(`components/SiteHeader.tsx`) still spreads across that container: the
name sits on the content's left edge, the nav at the container's right
edge (`justify-content: space-between`). On `/lab/`, `/researcher/`,
`/now/` and posts the content fills only the left ~600px, so the nav
floats over empty space about 600px from the nearest text, and the
underlined active item sits on the far side of the screen from the page's
own label.

Decision (picked by Artem from rendered variants): the header becomes one
left-aligned group, name and nav separated by a dim slash —
`ARTEM POLOZOV / LAB RESEARCHER NOW`. The slash reads as a path (on
`/lab/` and posts it literally is one) and keeps the two apart at any
width, where a plain gap shrinks on mobile and a brighter name would
compete with the active item.

## Scope

In scope: the header's layout and the separator, on every route that
renders `SiteHeader` (everything but `/`).

Out of scope: the home page (`SiteHeader` returns `null` on `/`, the hero
takes its place); nav items, the active-item underline, colors of the
name and links, font, header height and border; a sticky header.

## Markup — `components/SiteHeader.tsx`

Between `<Link className="brand">` and `<nav>`:

```tsx
<span className="site-header-sep" aria-hidden="true">/</span>
```

A real element, not `.brand::after`: a pseudo-element inside the link
would join the home link's click target and its accessible name ("Artem
Polozov slash"). `aria-hidden` keeps screen readers from announcing it.

## Styles — `.site-header` block in `app/globals.css`

- `.site-header-inner`: `justify-content: space-between` →
  `flex-start`; `gap: 20px` → `18px` (spacing on both sides of the
  slash); add `flex-wrap: wrap`.
- New `.site-header-sep`: `color: color-mix(in srgb, var(--muted) 50%,
  transparent)` — dimmer than the nav links. `color-mix` is already used
  for `--card-bg`.
- Mobile (`max-width: 640px`): `.site-header-inner` `gap: 14px` →
  `12px`. The nav's own `gap: 16px` stays.
- The comment above the block gains a line: the header is one left group,
  "name / nav", on the content's left edge.

## Narrow screens

Measured in headless Chrome on `/lab/` with this layout: at 320px the
header fits on one line with the nav ending at x=296 of 300 available
(4px spare); at 360 and 375px there is more room. `flex-wrap: wrap` is
the safety net below that, or if a font change widens it: the nav drops
to a second line (the slash stays at the end of the first) instead of
overflowing sideways.

## Verification

- No logic changes, so no new tests; `npm test` stays green.
- Headless-Chrome screenshots against `npm run dev`: `/lab/`, one post,
  `/researcher/`, `/researcher/agent/`, `/now/` at 1440px, plus `/lab/`
  at 375 and 320px — one line, slash between name and nav, active item
  underlined, no horizontal scroll.
- `npm run build` + `npm run serve` only after stopping `next dev` (a
  build next to a running dev server breaks its `/lab/[slug]/` pages);
  the served export shows the same header.

## Docs

`PROGRESS.md` → "Site": replace "Header nav on inner routes is still
right-aligned — Artem hasn't decided whether to move it left." with the
decision and this spec's path.
