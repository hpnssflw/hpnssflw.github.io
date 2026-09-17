# Blog Content & Direction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Separate LAB (Artem's own writing) from RESEARCHER (the agent's curated beat) by giving LAB a stated scope and tagging convention, retagging its one existing post to match, and de-duplicating the RESEARCHER topic list that's currently hand-copied on two pages.

**Architecture:** Task 1 is content/docs-only: a new `docs/lab-direction.md`, a frontmatter edit to the existing LAB post, a matching test-fixture update, and a `CLAUDE.md` pointer. Task 2 factors the RESEARCHER topic list into one `lib/topics.ts` data module (parallel to the existing `lib/posts.ts` pattern) rendered by one new `components/ResearcherTopics.tsx`, used by both `app/page.tsx` and `app/researcher/page.tsx`.

**Tech Stack:** Next.js App Router + TypeScript (site, already in place), Markdown/MDX (LAB posts and docs), Vitest (`lib/**/*.test.ts` only — no component test harness exists in this repo).

## Global Constraints

- No Tailwind, CSS-in-JS, or component library — the design is the hand-built token/case system in `app/globals.css`; neither task needs any CSS changes (Task 2 reuses the existing `.topics`/`.topic-name`/`.topic-gloss` classes verbatim).
- Commit in small, focused commits; never stage `.claude/settings.local.json`.
- LAB's tagging convention is freeform (one short, specific tag per post) — do not introduce a fixed enum or a code-enforced tag list anywhere.
- The retagged value for the existing LAB post is exactly `AGENT ARCHITECTURE` (not `AI AGENTS`, not `AI ENGINEERING` — distinct from RESEARCHER's theme name).
- `lib/topics.ts`'s three entries, in this exact order and wording (`name`/`gloss` copied verbatim from the current JSX in `app/page.tsx` and `app/researcher/page.tsx`):
  1. `{ name: "Web Products", gloss: "product and web trends, market data, data visualization, browser performance, web architecture, SEO." }`
  2. `{ name: "Tooling", gloss: "trending GitHub repos, web development tools." }`
  3. `{ name: "AI Engineering", gloss: "agent and automated pipelines, LLM assistants, self-hosted AI platforms, inference optimization.", href: "/researcher/agent/" }`
- Verify site changes with `npm run build && npm run serve` and `npm test`, per `CLAUDE.md`.

---

### Task 1: LAB direction doc, retag, and CLAUDE.md pointer

**Files:**
- Create: `docs/lab-direction.md`
- Modify: `content/lab/cheap-models-strong-graphs.mdx` (frontmatter `tag:` field only)
- Modify: `lib/posts.test.ts:18` (expected `tag` value)
- Modify: `CLAUDE.md:13-18` (session-start protocol, step 3)

**Interfaces:**
- Consumes: `lib/posts.ts`'s existing `PostMeta.tag: string` field (unchanged) and `getPost(slug)` (unchanged) — this task only changes the *value* of one post's `tag` frontmatter, not any code.
- Produces: nothing later tasks depend on — Task 2 is independent of this task's files.

- [ ] **Step 1: Write the LAB direction doc**

Create `docs/lab-direction.md`:

```markdown
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
```

- [ ] **Step 2: Retag the existing LAB post**

In `content/lab/cheap-models-strong-graphs.mdx`, change the frontmatter:

```diff
-tag: AI AGENTS
+tag: AGENT ARCHITECTURE
```

- [ ] **Step 3: Run the test suite to see the now-stale assertion fail**

Run: `npm test`
Expected: FAIL — `lib/posts.test.ts` > "posts index" > "exposes the seed post with parsed frontmatter", because `post.tag` is now `"AGENT ARCHITECTURE"` but the test still expects `"AI AGENTS"`.

- [ ] **Step 4: Update the test fixture**

In `lib/posts.test.ts`, line 18:

```diff
-      tag: "AI AGENTS",
+      tag: "AGENT ARCHITECTURE",
```

- [ ] **Step 5: Run the test suite to confirm it passes**

Run: `npm test`
Expected: PASS, all suites green.

- [ ] **Step 6: Add the CLAUDE.md pointer**

In `CLAUDE.md`, step 3 of the session start protocol currently reads:

```markdown
3. If the work is on the Content Direction & Tony Scraponi initiative,
   also read `docs/tony-scraponi-roadmap.md` — it lists that
   initiative's sub-projects in order. Confirm with the user that the
   sub-project `PROGRESS.md` names as active is still the right one,
   then run it through brainstorming → writing-plans → implementation
   (superpowers skills) before writing any of its code.
```

Append a sentence to it:

```diff
 3. If the work is on the Content Direction & Tony Scraponi initiative,
    also read `docs/tony-scraponi-roadmap.md` — it lists that
    initiative's sub-projects in order. Confirm with the user that the
    sub-project `PROGRESS.md` names as active is still the right one,
    then run it through brainstorming → writing-plans → implementation
-   (superpowers skills) before writing any of its code.
+   (superpowers skills) before writing any of its code. If that
+   sub-project is Blog content & direction, also read
+   `docs/lab-direction.md` before writing or editing any LAB post.
```

- [ ] **Step 7: Verify the site still builds**

Run: `npm run build`
Expected: build succeeds (the MDX frontmatter change and doc/CLAUDE.md edits touch no component code).

- [ ] **Step 8: Commit**

```bash
git add docs/lab-direction.md content/lab/cheap-models-strong-graphs.mdx lib/posts.test.ts CLAUDE.md
git commit -m "$(cat <<'EOF'
Add LAB direction doc and retag the seed post

LAB is Artem's own writing (personal essays/lessons-learned), distinct
from RESEARCHER's agent-curated beat. Retags the one existing post from
the stale AI AGENTS (a pre-themes-rework name) to AGENT ARCHITECTURE,
matching the new freeform tagging convention.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: De-duplicate the RESEARCHER topic list

**Files:**
- Create: `lib/topics.ts`
- Create: `lib/topics.test.ts`
- Create: `components/ResearcherTopics.tsx`
- Modify: `app/page.tsx` (replace the inline `<ul className="topics">` block)
- Modify: `app/researcher/page.tsx` (replace the inline `<ul className="topics">` block)

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `lib/topics.ts` exports `type Topic = { name: string; gloss: string; href?: string }` and `export const topics: Topic[]` (three entries, exact values in Global Constraints above). `components/ResearcherTopics.tsx` exports a default component `ResearcherTopics()` taking no props, rendering `<ul className="topics">…</ul>` from `topics`.

- [ ] **Step 1: Write the failing test for the topics data**

Create `lib/topics.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { topics } from "./topics";

describe("topics", () => {
  it("has exactly the three RESEARCHER themes, in order", () => {
    expect(topics.map((t) => t.name)).toEqual([
      "Web Products",
      "Tooling",
      "AI Engineering",
    ]);
  });

  it("only AI Engineering links to the agent page", () => {
    const linked = topics.filter((t) => t.href);
    expect(linked).toHaveLength(1);
    expect(linked[0]).toMatchObject({
      name: "AI Engineering",
      href: "/researcher/agent/",
    });
  });

  it("every topic has a non-empty gloss", () => {
    for (const t of topics) {
      expect(t.gloss.length).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module './topics'` (or equivalent), since `lib/topics.ts` doesn't exist yet.

- [ ] **Step 3: Create the topics data module**

Create `lib/topics.ts`:

```typescript
export type Topic = {
  name: string;
  gloss: string;
  href?: string;
};

export const topics: Topic[] = [
  {
    name: "Web Products",
    gloss:
      "product and web trends, market data, data visualization, browser performance, web architecture, SEO.",
  },
  {
    name: "Tooling",
    gloss: "trending GitHub repos, web development tools.",
  },
  {
    name: "AI Engineering",
    gloss:
      "agent and automated pipelines, LLM assistants, self-hosted AI platforms, inference optimization.",
    href: "/researcher/agent/",
  },
];
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS, all suites green (`lib/posts.test.ts`, `lib/agent-status.test.ts`, `lib/topics.test.ts`).

- [ ] **Step 5: Create the shared component**

Create `components/ResearcherTopics.tsx`:

```tsx
import Link from "next/link";
import { topics } from "@/lib/topics";

export default function ResearcherTopics() {
  return (
    <ul className="topics">
      {topics.map((topic) => (
        <li key={topic.name}>
          {topic.href ? (
            <Link className="topic-name" href={topic.href}>
              {topic.name}
            </Link>
          ) : (
            <span className="topic-name">{topic.name}</span>
          )}
          <span className="topic-gloss">{topic.gloss}</span>
        </li>
      ))}
    </ul>
  );
}
```

Note: this makes "AI Engineering" a link on the homepage too (previously
only `/researcher/`'s copy linked it — a pre-existing inconsistency
between the two hand-copied lists, resolved here by linking it in both
places, matching `docs/superpowers/specs/2026-09-17-blog-content-
direction-design.md`'s data model).

- [ ] **Step 6: Use the shared component in `app/page.tsx`**

In `app/page.tsx`, add the import:

```diff
 import Link from "next/link";
 import { getAllPosts } from "@/lib/posts";
 import AgentWidget from "@/components/AgentWidget";
+import ResearcherTopics from "@/components/ResearcherTopics";
```

Replace the inline topic list:

```diff
-          <ul className="topics">
-            <li>
-              <span className="topic-name">Web Products</span>
-              <span className="topic-gloss">
-                product and web trends, market data, data visualization,
-                browser performance, web architecture, SEO.
-              </span>
-            </li>
-            <li>
-              <span className="topic-name">Tooling</span>
-              <span className="topic-gloss">
-                trending GitHub repos, web development tools.
-              </span>
-            </li>
-            <li>
-              <span className="topic-name">AI Engineering</span>
-              <span className="topic-gloss">
-                agent and automated pipelines, LLM assistants, self-hosted
-                AI platforms, inference optimization.
-              </span>
-            </li>
-          </ul>
+          <ResearcherTopics />
           <AgentWidget variant="compact" />
```

- [ ] **Step 7: Use the shared component in `app/researcher/page.tsx`**

In `app/researcher/page.tsx`, add the import:

```diff
 import Link from "next/link";
 import type { Metadata } from "next";
+import ResearcherTopics from "@/components/ResearcherTopics";
```

Replace the inline topic list (the `<Link className="topic-name plan-link" href="/researcher/agent/">A Research Agent</Link>` line below the list is untouched — it's a separate element, not part of the topics list):

```diff
-        <ul className="topics">
-          <li>
-            <span className="topic-name">Web Products</span>
-            <span className="topic-gloss">
-              product and web trends, market data, data visualization,
-              browser performance, web architecture, SEO.
-            </span>
-          </li>
-          <li>
-            <span className="topic-name">Tooling</span>
-            <span className="topic-gloss">
-              trending GitHub repos, web development tools.
-            </span>
-          </li>
-          <li>
-            <Link className="topic-name" href="/researcher/agent/">
-              AI Engineering
-            </Link>
-            <span className="topic-gloss">
-              agent and automated pipelines, LLM assistants, self-hosted AI
-              platforms, inference optimization.
-            </span>
-          </li>
-        </ul>
+        <ResearcherTopics />

         <Link className="topic-name plan-link" href="/researcher/agent/">
           A Research Agent
         </Link>
```

- [ ] **Step 8: Build and serve the static export**

Run: `npm run build && npm run serve`
Expected: build succeeds with no type errors; `npm run serve` serves `out/` on `http://localhost:3000`.

- [ ] **Step 9: Visually confirm both pages**

Open `http://localhost:3000/` and `http://localhost:3000/researcher/` in a
browser (or `curl` both and check the HTML). Confirm both show the same
three topics in the same order, with "AI Engineering" rendered as a link
to `/researcher/agent/` on both pages, and that `/researcher/`'s separate
"A Research Agent" link below the list is still present and unchanged.

- [ ] **Step 10: Run the full test suite once more**

Run: `npm test`
Expected: PASS, all suites green.

- [ ] **Step 11: Commit**

```bash
git add lib/topics.ts lib/topics.test.ts components/ResearcherTopics.tsx app/page.tsx app/researcher/page.tsx
git commit -m "$(cat <<'EOF'
De-duplicate the RESEARCHER topic list into lib/topics.ts

app/page.tsx and app/researcher/page.tsx hand-copied the same three
topics, and had already drifted (AI Engineering linked to the agent
page on one but not the other). One data module + one shared component
now backs both, with AI Engineering consistently linked.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```
