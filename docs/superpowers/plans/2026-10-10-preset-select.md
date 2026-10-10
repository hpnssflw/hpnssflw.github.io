# Preset Select Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A preset switch on `/researcher/queue/` and on both demo pages, so every visitor can move between Tony Scraponi, `newsroom-demo` and `agro-demo`; the demo pages become indexable.

**Architecture:** A build-time list of the three presets (`presetLinks()` in `lib/demo-presets.ts`) feeds one client component, `PresetSwitch` — a `<details>` dropdown of plain `next/link` links, with JS only closing it (Escape, a press outside, a link click). The control room's pulse and the demo header both render it; its exact place in the header is picked by Artem from rendered variants. The demo pages drop `robots`.

**Tech Stack:** Next.js 16 App Router (static export), React 19, TypeScript, Vitest, hand-written CSS in `app/globals.css`.

**Spec:** `docs/superpowers/specs/2026-10-10-preset-select-design.md`.

## Global Constraints

- Branch `worktree-preset-select` in `.claude/worktrees/preset-select`, from `origin/main`. Nothing from `worktree-stories` (content engine C) comes along. Push to `main` only on Artem's word.
- Site-only: don't touch `agent/` or `.github/workflows/agent-run.yml`.
- No new dependencies; no Tailwind, CSS-in-JS or component library — styles go in `app/globals.css` with the existing tokens.
- Static export: no server features (the pages already use `generateStaticParams` + `dynamicParams = false`).
- `lib/demo-presets.ts` is server-only (`node:fs`); client components import its types only (`import type`).
- Interface strings live in `lib/control-room-text.ts` (`TEXT.en` / `TEXT.ru`, same keys); topic and preset names are content and stay as written.
- Tony's preset name is the constant `"Tony Scraponi"` (the site parses no agent YAML).
- Never stage `.claude/settings.local.json` or `STATUS.html`.
- Verification: `npm test`, `npx tsc --noEmit`, `npm run build`, `npm run serve`; headless checks with `node --experimental-websocket .superpowers/tools/cdp.mjs <url> <out.png> <width> <height> <script.js>` (copy the runner from `../stories/.superpowers/tools/cdp.mjs`; `.superpowers/` is git-ignored). Don't run two headless checks at once; `serve` may pick a random port — read it from its output.

---

### Task 1: `presetLinks()` — the three presets, Tony first

**Files:**
- Modify: `lib/demo-presets.ts` (replace `DemoLink` / `demoLinks`)
- Test: `lib/demo-presets.test.ts`
- Modify: `app/researcher/demo/[slug]/page.tsx:4,30`
- Modify: `components/DemoRoom.tsx:12,43,107-118`

**Interfaces:**
- Produces: `export interface PresetLink { slug: string; name: string; href: string; live: boolean }` and `export function presetLinks(root?: string): PresetLink[]` in `lib/demo-presets.ts`. `DemoRoom`'s prop `presets` becomes `PresetLink[]`.

- [ ] **Step 1: Write the failing test**

In `lib/demo-presets.test.ts`, change the import line and replace the `"names them for the switcher"` test:

```ts
import { DEMO_SLUGS, loadDemo, presetLinks } from "./demo-presets";
```

```ts
  it("lists Tony first, then the demos, for the preset switch", () => {
    expect(presetLinks()).toEqual([
      { slug: "tony", name: "Tony Scraponi", href: "/researcher/queue/", live: true },
      { slug: "newsroom-demo", name: "Редакция (демо)", href: "/researcher/demo/newsroom-demo/", live: false },
      { slug: "agro-demo", name: "Агродистрибутор (демо)", href: "/researcher/demo/agro-demo/", live: false },
    ]);
  });
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run lib/demo-presets.test.ts`
Expected: FAIL — `presetLinks` is not exported (`presetLinks is not a function`).

- [ ] **Step 3: Implement**

In `lib/demo-presets.ts`, replace the `DemoLink` interface and `demoLinks` function with:

```ts
/** One entry of the preset switch: Tony's live control room or a demo page. */
export interface PresetLink {
  slug: string;
  name: string;
  href: string;
  live: boolean;
}

/**
 * The preset switch's list (/researcher/queue/ and the demo pages): Tony
 * first — the live control room, named here because the site parses no
 * agent YAML — then each demo, named from its golden.
 */
export function presetLinks(root: string = process.cwd()): PresetLink[] {
  return [
    { slug: "tony", name: "Tony Scraponi", href: "/researcher/queue/", live: true },
    ...DEMO_SLUGS.map((slug) => ({
      slug,
      name: loadDemo(slug, root).run1.preset.name,
      href: `/researcher/demo/${slug}/`,
      live: false,
    })),
  ];
}
```

In `app/researcher/demo/[slug]/page.tsx`: import `presetLinks` instead of `demoLinks`, and render `<DemoRoom demo={loadDemo(slug)} presets={presetLinks()} />`.

In `components/DemoRoom.tsx`: import `type Demo, type PresetLink` (drop `DemoLink`), type the prop as `presets: PresetLink[]`, and replace the whole `<nav className="cr-demo-nav" …>…</nav>` with (Tony is in the list now, so the separate "Tony live ↗" link goes; Task 2 replaces this nav with the switch):

```tsx
          <nav className="cr-demo-nav" aria-label={text.demo.switcher}>
            {presets.map((preset) => (
              <Link
                key={preset.slug}
                href={preset.href}
                aria-current={preset.slug === demo.slug ? "page" : undefined}
              >
                {preset.live ? text.demo.tonyLive : preset.name}
              </Link>
            ))}
          </nav>
```

- [ ] **Step 4: Run the tests and the type check**

Run: `npm test` then `npx tsc --noEmit`
Expected: all Vitest files pass; `tsc` prints nothing (exit 0).

- [ ] **Step 5: Commit**

```bash
git add lib/demo-presets.ts lib/demo-presets.test.ts "app/researcher/demo/[slug]/page.tsx" components/DemoRoom.tsx
git commit -m "List Tony and the demos for a preset switch"
```

---

### Task 2: `PresetSwitch` on the control room and the demo pages

**Files:**
- Create: `components/PresetSwitch.tsx`
- Modify: `lib/control-room-text.ts` (en `demo` block ~line 164, ru `demo` block ~line 335)
- Modify: `app/globals.css` (`.cr-pulse` ~line 1811; new rules after `.cr-demo-nav a[aria-current="page"]` ~line 2447; the `@media (max-width: 899px)` block at the end of the demo section)
- Modify: `components/ControlPulse.tsx`, `components/ControlRoom.tsx`, `app/researcher/queue/page.tsx`, `components/DemoRoom.tsx`

**Interfaces:**
- Consumes: `PresetLink`, `presetLinks()` from Task 1.
- Produces: `export default function PresetSwitch({ presets, current, text }: { presets: PresetLink[]; current: string; text: { label: string; live: string } })`; `TEXT[lang].presets: { label: string; live: string }`; `ControlRoom` and `ControlPulse` take `presets: PresetLink[]`.

- [ ] **Step 1: Move the switch's strings to `presets`**

In `lib/control-room-text.ts`, delete `switcher` and `tonyLive` from both `demo` blocks, and add a top-level key after `demo` in each dictionary.

In `en` (after the `demo: {…},` block, before the closing `};`):

```ts
  presets: { label: "Presets", live: "live" },
```

In `ru`:

```ts
  presets: { label: "Пресеты", live: "live" },
```

- [ ] **Step 2: Write the component**

Create `components/PresetSwitch.tsx`:

```tsx
"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { PresetLink } from "@/lib/demo-presets";

/**
 * The preset switch on the control room and the demo pages: a <details>
 * dropdown of plain links, so it works without JS and crawlers follow the
 * links. JS only closes it — on Escape (focus back on the summary), on a
 * press outside it, and on a link click (a client-side move between demo
 * pages keeps this component mounted).
 */
export default function PresetSwitch({
  presets,
  current,
  text,
}: {
  presets: PresetLink[];
  current: string;
  text: { label: string; live: string };
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const details = ref.current;
    if (!open || !details) return;
    function onPointerDown(event: PointerEvent) {
      if (details && !details.contains(event.target as Node)) details.open = false;
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape" || !details) return;
      details.open = false;
      details.querySelector("summary")?.focus();
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const name = presets.find((preset) => preset.slug === current)?.name ?? current;

  return (
    <nav className="cr-preset" aria-label={text.label}>
      <details ref={ref} onToggle={(event) => setOpen(event.currentTarget.open)}>
        <summary>
          <span className="tony-name">{name}</span>
        </summary>
        <ul>
          {presets.map((preset) => (
            <li key={preset.slug}>
              <Link
                href={preset.href}
                aria-current={preset.slug === current ? "page" : undefined}
                onClick={() => {
                  if (ref.current) ref.current.open = false;
                }}
              >
                {preset.name}
                {preset.live && <span className="cr-preset-live"> · {text.live}</span>}
              </Link>
            </li>
          ))}
        </ul>
      </details>
    </nav>
  );
}
```

- [ ] **Step 3: Style it**

In `app/globals.css`, add `z-index: 1;` to the `.cr-pulse` rule (after `position: relative;`). The pulse and the demo header both carry `.cr-pulse`; their `backdrop-filter` makes each a stacking context, so without it the rail below paints over the open list:

```css
.cr-pulse {
  position: relative;
  z-index: 1; /* the preset switch's open list floats over the rail */
```

After the `.cr-demo-nav a:hover, .cr-demo-nav a[aria-current="page"]` rule, add:

```css
/* Preset switch (control room and demo pages): a <details> dropdown of
   plain links; the summary reads as the preset's name with a caret. */
.cr-preset {
  position: relative;
}

.cr-preset summary {
  list-style: none;
  cursor: pointer;
}

.cr-preset summary::-webkit-details-marker {
  display: none;
}

.cr-preset summary::after {
  content: "▾";
  margin-left: 6px;
  font-family: var(--font-mono);
  font-size: var(--fs-2xs);
  color: var(--muted);
}

.cr-preset summary:hover::after,
.cr-preset details[open] summary::after {
  color: var(--text-strong);
}

.cr-preset summary:focus-visible {
  outline: 1px solid var(--muted);
  outline-offset: 4px;
}

.cr-preset ul {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  z-index: 10;
  min-width: max-content;
  margin: 0;
  padding: 6px 0;
  list-style: none;
  background: var(--agent-bg);
  border: 1px solid var(--agent-border);
  font-family: var(--font-mono);
  font-size: var(--fs-2xs);
  line-height: 1.7;
  text-transform: lowercase;
}

.cr-preset a {
  display: block;
  padding: 2px 12px;
  color: var(--muted);
}

.cr-preset a:hover,
.cr-preset a:focus-visible,
.cr-preset a[aria-current="page"] {
  color: var(--text-strong);
}

.cr-preset-live {
  color: var(--agent-lime);
}
```

Then delete the `.cr-demo-nav` rules (the base rule, `.cr-demo-nav a`, the hover/current rule, and `.cr-demo-nav { justify-content: flex-start; }` inside the demo section's `@media (max-width: 899px)`); Step 4 removes the last `cr-demo-nav` element.

- [ ] **Step 4: Wire placement (a) — the preset's name becomes the switch**

`app/researcher/queue/page.tsx`: import `presetLinks` from `@/lib/demo-presets` and render `<ControlRoom schedule={loadSchedule()} presets={presetLinks()} />`; extend the comment: "the cron line and the preset switch's list, read at build time (static export: once)".

`components/ControlRoom.tsx`: `import type { PresetLink } from "@/lib/demo-presets";`; signature `ControlRoom({ schedule, presets }: { schedule: CronSchedule; presets: PresetLink[] })`; pass `presets={presets}` to `<ControlPulse …>`.

`components/ControlPulse.tsx`: import `PresetSwitch` and `type PresetLink`; import `TEXT` from `@/lib/control-room-text`; add `presets` to the props (`presets: PresetLink[]`); replace

```tsx
      <p className="cr-pulse-id">
        <span className="tony-name">Tony Scraponi</span>
        <span className="agent-muted">control room</span>
      </p>
```

with (a `<details>` can't sit in a `<p>`):

```tsx
      <div className="cr-pulse-id">
        <PresetSwitch presets={presets} current="tony" text={TEXT.en.presets} />
        <span className="agent-muted">control room</span>
      </div>
```

`components/DemoRoom.tsx`: import `PresetSwitch`; drop the `Link` import if nothing else uses it; replace

```tsx
          <p className="cr-pulse-id">
            <span className="tony-name">{run1.preset.name}</span>
            <span className="agent-muted">{text.demo.tag(run1.run.at.slice(0, 10))}</span>
          </p>
```

with

```tsx
          <div className="cr-pulse-id">
            <PresetSwitch presets={presets} current={demo.slug} text={text.presets} />
            <span className="agent-muted">{text.demo.tag(run1.run.at.slice(0, 10))}</span>
          </div>
```

and delete the `<nav className="cr-demo-nav" …>…</nav>` from Task 1. In `app/globals.css`, `.cr-demo-head`'s columns become `grid-template-columns: auto minmax(0, 1fr);` (two children now: name block, run toggle); its narrow override stays `minmax(0, 1fr)`.

- [ ] **Step 5: Check**

Run: `npx tsc --noEmit`, `npm test`, then `npm run build`
Expected: no type errors; all tests pass (`lib/control-room-text.test.ts`'s key-parity test covers `presets`); the build lists `/researcher/queue` and both `/researcher/demo/…` pages.

- [ ] **Step 6: Render both placements; Artem picks**

Copy the runner: `cp ../stories/.superpowers/tools/cdp.mjs .superpowers/tools/cdp.mjs` (create `.superpowers/tools/` first). `npm run serve` in the background; note its port `<P>`.

Save as `<scratchpad>/open-switch.js`:

```js
(async () => {
  document.querySelector(".cr-preset summary").click();
  await new Promise((r) => setTimeout(r, 300));
  return document.querySelector(".cr-preset details").open;
})()
```

Placement (a), four shots (each prints `true`):

```
node --experimental-websocket .superpowers/tools/cdp.mjs http://localhost:<P>/researcher/queue/ <scratchpad>/a-queue-1440.png 1440 900 <scratchpad>/open-switch.js
node --experimental-websocket .superpowers/tools/cdp.mjs http://localhost:<P>/researcher/queue/ <scratchpad>/a-queue-390.png 390 844 <scratchpad>/open-switch.js
node --experimental-websocket .superpowers/tools/cdp.mjs http://localhost:<P>/researcher/demo/newsroom-demo/ <scratchpad>/a-demo-1440.png 1440 900 <scratchpad>/open-switch.js
node --experimental-websocket .superpowers/tools/cdp.mjs http://localhost:<P>/researcher/demo/newsroom-demo/ <scratchpad>/a-demo-390.png 390 844 <scratchpad>/open-switch.js
```

Commit (a) as a WIP so (b) can be thrown away cleanly (never `git stash` here — the stash is shared with other worktrees):

```bash
git add components/PresetSwitch.tsx lib/control-room-text.ts app/globals.css components/ControlPulse.tsx components/ControlRoom.tsx app/researcher/queue/page.tsx components/DemoRoom.tsx
git commit -m "WIP preset switch (a)"
```

Then switch the working tree to placement (b) — the name stays plain text, the switch sits at the header's right end:

- `ControlPulse.tsx`: restore `<p className="cr-pulse-id"><span className="tony-name">Tony Scraponi</span><span className="agent-muted">control room</span></p>`, and render `<PresetSwitch presets={presets} current="tony" text={TEXT.en.presets} />` just before `<OwnerSlot {...owner} />`.
- `DemoRoom.tsx`: restore `<p className="cr-pulse-id"><span className="tony-name">{run1.preset.name}</span><span className="agent-muted">{text.demo.tag(…)}</span></p>`, and render `<PresetSwitch presets={presets} current={demo.slug} text={text.presets} />` as the header's last child (where `cr-demo-nav` was).
- `app/globals.css`: `.cr-pulse` columns `auto auto minmax(0, 1fr) auto auto` (mark, id, line, switch, owner), and in its `@media (max-width: 899px)` override `auto minmax(0, 1fr) auto auto`; `.cr-demo-head` back to `auto minmax(0, 1fr) auto`; add
  ```css
  .cr-pulse > .cr-preset ul,
  .cr-demo-head > .cr-preset ul {
    left: auto;
    right: 0;
  }
  ```

`npm run build`, restart `serve`, take the same four shots as `b-*.png`. Look at all eight yourself first (the open list sits above the rail, fits 390 px, doesn't cover the owner slot), then give Artem the eight PNG paths and let him pick:

- (a): `git checkout -- components/ControlPulse.tsx components/DemoRoom.tsx app/globals.css` (back to the WIP commit).
- (b): leave the (b) edits in the tree.

Step 7 amends the WIP commit either way.

- [ ] **Step 7: Commit**

Re-run `npx tsc --noEmit`, `npm test`, `npm run build` on the picked placement, then:

```bash
git add components/PresetSwitch.tsx lib/control-room-text.ts app/globals.css components/ControlPulse.tsx components/ControlRoom.tsx app/researcher/queue/page.tsx components/DemoRoom.tsx
git commit --amend -m "Switch presets from the control room and the demo pages"
```

---

### Task 3: Index the demo pages, release checks, docs

**Files:**
- Modify: `app/researcher/demo/[slug]/page.tsx:15-23`
- Modify: `CLAUDE.md:86-91` (demo-section bullet)
- Modify: `PROGRESS.md` (status line ~381; new bullet after the D bullet ~736; resume item 2 ~1014)
- Modify: `docs/tony-scraponi-roadmap.md:115-120` (D's line)

**Interfaces:**
- Consumes: the switch from Task 2 (`.cr-preset`), `presetLinks()` from Task 1.

- [ ] **Step 1: Drop `robots` from the demo pages**

In `app/researcher/demo/[slug]/page.tsx`'s `generateMetadata`, replace the comment

```ts
  // Unlisted: Artem sends the link to prospective clients; nothing links
  // here and search engines are asked to stay out.
```

with

```ts
  // Reached from the preset switch on /researcher/queue/ and on each demo
  // page, and indexable (unlisted until 2026-10-10).
```

and delete the line `robots: { index: false, follow: false },`.

- [ ] **Step 2: Build and check the export**

Run: `npm run build`, then

```
grep -c 'href="/researcher/demo/newsroom-demo/"' out/researcher/queue/index.html
grep -c 'href="/researcher/demo/agro-demo/"' out/researcher/queue/index.html
grep -c 'href="/researcher/queue/"' out/researcher/demo/newsroom-demo/index.html
grep -l noindex out/researcher/demo/newsroom-demo/index.html out/researcher/demo/agro-demo/index.html || echo "no noindex"
```

Expected: the first three print a count ≥ 1; the last prints `no noindex`.

- [ ] **Step 3: Headless behaviour checks**

`npm run serve` (background), port `<P>`. Save as `<scratchpad>/switch-check.js`:

```js
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const details = document.querySelector(".cr-preset details");
  const summary = details.querySelector("summary");
  const out = {};
  summary.click();
  await sleep(200);
  out.opensOnClick = details.open;
  out.links = [...details.querySelectorAll("a")].map((a) => [a.getAttribute("href"), a.textContent, a.getAttribute("aria-current")]);
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await sleep(200);
  out.closesOnEscape = !details.open;
  out.focusBackOnSummary = document.activeElement === summary;
  summary.click();
  await sleep(200);
  document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
  await sleep(200);
  out.closesOnOutsidePress = !details.open;
  summary.click();
  await sleep(200);
  const box = details.querySelector("ul").getBoundingClientRect();
  out.listFitsViewport = box.left >= 0 && box.right <= innerWidth;
  const topAtList = document.elementFromPoint(box.left + 4, box.bottom - 4);
  out.listOnTop = details.contains(topAtList);
  return out;
})()
```

Save as `<scratchpad>/switch-go.js` (follows the agro link):

```js
(async () => {
  document.querySelector(".cr-preset summary").click();
  await new Promise((r) => setTimeout(r, 200));
  document.querySelector('.cr-preset a[href="/researcher/demo/agro-demo/"]').click();
  await new Promise((r) => setTimeout(r, 3000));
  return { path: location.pathname, open: document.querySelector(".cr-preset details").open };
})()
```

Run `switch-check.js` on `/researcher/queue/` and `/researcher/demo/newsroom-demo/` at 1440×900 and at 390×844 (four runs, one at a time), then `switch-go.js` once on `/researcher/queue/` at 1440×900.

Expected, every `switch-check` run: `opensOnClick`, `closesOnEscape`, `focusBackOnSummary`, `closesOnOutsidePress`, `listFitsViewport`, `listOnTop` all `true`; `links` is the three hrefs in order `/researcher/queue/`, `/researcher/demo/newsroom-demo/`, `/researcher/demo/agro-demo/`, with `aria-current` `"page"` only on the page's own preset. `switch-go`: `{ path: "/researcher/demo/agro-demo/", open: false }`. Look at each screenshot.

- [ ] **Step 4: Docs**

`CLAUDE.md`, the demo-section bullet: change its opening `**The unlisted demo section `/researcher/demo/<slug>/`**` to `**The demo section `/researcher/demo/<slug>/`**`, and replace the sentence "It is `noindex, nofollow`, has no index page, and nothing links to it." with:

```
It has no index page; the preset switch (`components/PresetSwitch.tsx`,
fed by `lib/demo-presets.ts`'s `presetLinks`) on `/researcher/queue/` and
on each demo page links Tony and both demos, and the demo pages are
indexable (unlisted until 2026-10-10).
```

`docs/tony-scraponi-roadmap.md`, D's entry: after "Shipped (push 1: Tony on `run-result.json`; push 2: the demo section)." add " Since 2026-10-10 a preset switch on the control room and the demo pages links all three presets, and the demos are indexable (`docs/superpowers/specs/2026-10-10-preset-select-design.md`)."

`PROGRESS.md`:
- Status line (~381): before the closing `**`, add "; the preset select on the control room shipped 2026-10-10".
- After the D bullet (the one starting `- **Content engine, sub-project D (preset switcher): both pushes shipped.**`, ending before the next `- **` bullet), add:

  ```
  - **Preset select (amends D): shipped 2026-10-10.** Spec:
    `docs/superpowers/specs/2026-10-10-preset-select-design.md`. Plan:
    `docs/superpowers/plans/2026-10-10-preset-select.md`. A `<details>`
    dropdown of plain links (`components/PresetSwitch.tsx`, list from
    `lib/demo-presets.ts`'s `presetLinks`: Tony, then both demos) in the
    header of `/researcher/queue/` and of both demo pages; JS only closes it
    (Escape, a press outside, a link click). The demo pages lost
    `noindex, nofollow` and are no longer unlisted.
  ```
- Resume item 2 (`2. **Sub-project C** — …`): append "C is built on branch `worktree-stories`, unpushed; rebase it onto `main` before its rollout — `main` gained the preset select (2026-10-10) after it branched (expect conflicts in `PROGRESS.md`, `components/ControlRoom.tsx`, `lib/control-room-text.ts`)."

- [ ] **Step 5: Final check and commit**

Run: `npm test`, `npx tsc --noEmit`, `npm run build` — all clean.

```bash
git add "app/researcher/demo/[slug]/page.tsx" CLAUDE.md PROGRESS.md docs/tony-scraponi-roadmap.md
git commit -m "Index the demo pages and document the preset select"
```

- [ ] **Step 6: Push on Artem's word**

Ask Artem. On his go: `git push origin worktree-preset-select:main`; watch the Pages deploy (`gh run list --workflow deploy.yml --limit 1`, then `gh run watch <id>`), check Pages' `build_type` is still `workflow`, and open `https://hpnssflw.github.io/researcher/queue/` — the switch is there and leads to both demos.
