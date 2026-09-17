# Tony Scraponi MVP (Pending Queue Page) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render `agent/pending.json` — the curated delivery queue that's already public on the `agent-data` branch but unreadable until now — as a new `/researcher/queue/` page, grouped by topic, linked from both `/researcher/` and `/researcher/agent/`.

**Architecture:** Task 1 is a pure data layer — `lib/pending-queue.ts` mirrors `agent/pending.py`'s `PendingItem`/`PendingQueue` dataclasses as TypeScript types, with a runtime shape guard and a topic-grouping transform, covered by Vitest with no network and no React involved. Task 2 is the UI layer: a client component that fetches the same way `components/AgentWidget.tsx` already does, a new route wrapping it, and two small nav-link edits on existing pages.

**Tech Stack:** Next.js App Router + TypeScript (site, already in place), Vitest (`lib/**/*.test.ts`).

## Global Constraints

- No Tailwind, CSS-in-JS, or component library — the design is the hand-built token/case system in `app/globals.css`.
- **Zero new CSS.** The spec allowed for "a handful of new classes," but the existing `.feed`/`.title`/`.excerpt`/`.meta`/`.date`/`.sep`/`.tag` list pattern (used today by `/lab/`'s post listing, see `app/lab/page.tsx`) maps onto queue items exactly — date, a source/score meta line, title, one-line summary — and `.section-label` (the small mono uppercase heading used for page-level labels like "Researcher") doubles as the per-topic group heading. `.agent-muted` and `.agent-unavailable` (from the agent widget's CSS) cover the header/empty/failure text. Do not add any new class to `app/globals.css` for this plan — every piece of new markup below reuses one of these verbatim.
- `lib/pending-queue.ts`'s field names mirror `agent/pending.py`'s `PendingItem`/`PendingQueue` dataclasses exactly, on the wire and in the TypeScript types: `PendingItem { url, title, source, topic, topic_name, summary, score, pending_since }`, `PendingQueue { last_email_at, items }`. Do not rename any field.
- `PENDING_URL` is exactly `https://raw.githubusercontent.com/hpnssflw/hpnssflw.github.io/agent-data/agent/pending.json` — same host/branch pattern as `STATUS_URL` in `lib/agent-status.ts`, different filename.
- Fetching is client-side only (`fetch(PENDING_URL, { cache: "no-store" })` inside a `useEffect`, with a cancelled-effect guard), never a build-time fetch — `pending.json` updates every 4 hours via GitHub Actions but the site only rebuilds on a push to `main`, so a build-time fetch would show a stale queue between deploys.
- Commit in small, focused commits; never stage `.claude/settings.local.json`.
- Verify with `npm run build && npm run serve` and `npm test`, per `CLAUDE.md`.

---

### Task 1: `lib/pending-queue.ts` — types, shape guard, grouping

**Files:**
- Create: `lib/pending-queue.ts`
- Create: `lib/pending-queue.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (used by Task 2): `PENDING_URL: string`; `interface PendingItem { url: string; title: string; source: string; topic: string; topic_name: string; summary: string; score: number; pending_since: string }`; `interface PendingQueue { last_email_at: string | null; items: PendingItem[] }`; `function isPendingQueue(value: unknown): value is PendingQueue`; `function groupByTopic(queue: PendingQueue): Record<string, PendingItem[]>` (keys in first-appearance order from `queue.items`, each group's items sorted by `score` descending).

- [ ] **Step 1: Write the failing tests**

Create `lib/pending-queue.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import {
  type PendingItem,
  type PendingQueue,
  groupByTopic,
  isPendingQueue,
} from "./pending-queue";

function makeItem(overrides: Partial<PendingItem> = {}): PendingItem {
  return {
    url: "https://example.com/a",
    title: "A title",
    source: "hacker_news",
    topic: "ai-engineering",
    topic_name: "AI Engineering",
    summary: "A one-line summary.",
    score: 7,
    pending_since: "2026-09-17T08:00:00+00:00",
    ...overrides,
  };
}

function makeQueue(overrides: Partial<PendingQueue> = {}): PendingQueue {
  return {
    last_email_at: null,
    items: [],
    ...overrides,
  };
}

describe("isPendingQueue", () => {
  const good = makeQueue({ items: [makeItem()] });

  it("accepts a well-formed payload", () => {
    expect(isPendingQueue(good)).toBe(true);
  });

  it("accepts a non-null last_email_at", () => {
    expect(
      isPendingQueue({ ...good, last_email_at: "2026-09-17T00:00:00+00:00" }),
    ).toBe(true);
  });

  it("rejects non-objects and nulls", () => {
    expect(isPendingQueue(null)).toBe(false);
    expect(isPendingQueue("nope")).toBe(false);
    expect(isPendingQueue(undefined)).toBe(false);
  });

  it("rejects a wrong-typed last_email_at", () => {
    expect(isPendingQueue({ ...good, last_email_at: 12345 })).toBe(false);
  });

  it("rejects a non-array items field", () => {
    expect(isPendingQueue({ ...good, items: {} })).toBe(false);
  });

  it("rejects an item missing a required field", () => {
    expect(
      isPendingQueue({ ...good, items: [{ ...makeItem(), score: undefined }] }),
    ).toBe(false);
  });

  it("rejects an item with a wrong-typed field", () => {
    expect(
      isPendingQueue({
        ...good,
        items: [{ ...makeItem(), score: "high" as unknown as number }],
      }),
    ).toBe(false);
  });
});

describe("groupByTopic", () => {
  it("groups items under their topic_name, keyed in first-appearance order", () => {
    const queue = makeQueue({
      items: [
        makeItem({ url: "a", topic_name: "AI Engineering" }),
        makeItem({ url: "b", topic_name: "Tooling" }),
        makeItem({ url: "c", topic_name: "AI Engineering" }),
      ],
    });
    const grouped = groupByTopic(queue);
    expect(Object.keys(grouped)).toEqual(["AI Engineering", "Tooling"]);
    expect(grouped["AI Engineering"]).toHaveLength(2);
    expect(grouped["Tooling"]).toHaveLength(1);
  });

  it("sorts each group by score descending", () => {
    const queue = makeQueue({
      items: [
        makeItem({ url: "a", score: 3 }),
        makeItem({ url: "b", score: 9 }),
        makeItem({ url: "c", score: 5 }),
      ],
    });
    const grouped = groupByTopic(queue);
    expect(grouped["AI Engineering"].map((i) => i.url)).toEqual([
      "b",
      "c",
      "a",
    ]);
  });

  it("returns an empty object for an empty queue", () => {
    expect(groupByTopic(makeQueue())).toEqual({});
  });

  it("does not throw on a score tie", () => {
    const queue = makeQueue({
      items: [
        makeItem({ url: "a", score: 5 }),
        makeItem({ url: "b", score: 5 }),
      ],
    });
    expect(() => groupByTopic(queue)).not.toThrow();
    expect(groupByTopic(queue)["AI Engineering"]).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module './pending-queue'` (or equivalent), since `lib/pending-queue.ts` doesn't exist yet.

- [ ] **Step 3: Create the data module**

Create `lib/pending-queue.ts`:

```typescript
export const PENDING_URL =
  "https://raw.githubusercontent.com/hpnssflw/hpnssflw.github.io/agent-data/agent/pending.json";

export interface PendingItem {
  url: string;
  title: string;
  source: string;
  topic: string;
  topic_name: string;
  summary: string;
  score: number;
  pending_since: string;
}

export interface PendingQueue {
  last_email_at: string | null;
  items: PendingItem[];
}

function isPendingItem(value: unknown): value is PendingItem {
  if (typeof value !== "object" || value === null) return false;
  const i = value as Record<string, unknown>;
  return (
    typeof i.url === "string" &&
    typeof i.title === "string" &&
    typeof i.source === "string" &&
    typeof i.topic === "string" &&
    typeof i.topic_name === "string" &&
    typeof i.summary === "string" &&
    typeof i.score === "number" &&
    typeof i.pending_since === "string"
  );
}

/**
 * Structural guard for a fetched `pending.json`. Mirrors
 * `lib/agent-status.ts`'s `isAgentStatus`: fields get read during React
 * render, not inside a fetch `.then()`, so a shape drift must fail closed
 * to an "unavailable" state rather than crash the route.
 */
export function isPendingQueue(value: unknown): value is PendingQueue {
  if (typeof value !== "object" || value === null) return false;
  const q = value as Record<string, unknown>;
  if (q.last_email_at !== null && typeof q.last_email_at !== "string") {
    return false;
  }
  return Array.isArray(q.items) && q.items.every(isPendingItem);
}

/**
 * Groups items by topic_name, each group sorted by score descending — the
 * TS mirror of agent/pending.py's own group_by_topic. Key order follows
 * first appearance in queue.items.
 */
export function groupByTopic(
  queue: PendingQueue,
): Record<string, PendingItem[]> {
  const grouped: Record<string, PendingItem[]> = {};
  for (const item of queue.items) {
    if (!grouped[item.topic_name]) grouped[item.topic_name] = [];
    grouped[item.topic_name].push(item);
  }
  for (const items of Object.values(grouped)) {
    items.sort((a, b) => b.score - a.score);
  }
  return grouped;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS, all suites green (`lib/posts.test.ts`, `lib/agent-status.test.ts`, `lib/topics.test.ts`, `lib/pending-queue.test.ts`).

- [ ] **Step 5: Commit**

```bash
git add lib/pending-queue.ts lib/pending-queue.test.ts
git commit -m "$(cat <<'EOF'
Add lib/pending-queue.ts for the pending delivery queue

Types, a runtime shape guard, and a topic-grouping transform for
agent/pending.json, mirroring agent/pending.py's PendingItem/
PendingQueue dataclasses field-for-field. Pure data layer, no UI yet —
part of the Tony Scraponi MVP (sub-project #4).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Queue page, component, and nav links

**Files:**
- Create: `components/PendingQueue.tsx`
- Create: `app/researcher/queue/page.tsx`
- Modify: `app/researcher/page.tsx`
- Modify: `app/researcher/agent/page.tsx`

**Interfaces:**
- Consumes: `lib/pending-queue.ts`'s `PENDING_URL`, `PendingItem`, `PendingQueue`, `isPendingQueue`, `groupByTopic` (Task 1, exact signatures above).
- Produces: `components/PendingQueue.tsx` exports a default component `PendingQueue()` taking no props, mounted at `#pending-queue`. Nothing later depends on this — final task in the plan.

- [ ] **Step 1: Create the component**

Create `components/PendingQueue.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import {
  type PendingQueue as PendingQueueData,
  PENDING_URL,
  groupByTopic,
  isPendingQueue,
} from "@/lib/pending-queue";

function Unavailable() {
  return <p className="agent-unavailable mono">queue unavailable</p>;
}

export default function PendingQueue() {
  const [queue, setQueue] = useState<PendingQueueData | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(PENDING_URL, { cache: "no-store" })
      .then((res) => {
        if (!res.ok) throw new Error(`pending fetch failed: ${res.status}`);
        return res.json();
      })
      .then((data: unknown) => {
        if (cancelled) return;
        if (isPendingQueue(data)) setQueue(data);
        else setFailed(true);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (failed) return <Unavailable />;
  if (!queue) return null;

  const lastSent = queue.last_email_at
    ? new Date(queue.last_email_at).toLocaleDateString()
    : "never";
  const grouped = groupByTopic(queue);

  return (
    <div id="pending-queue">
      <p className="agent-muted mono">
        {queue.items.length} queued · last sent {lastSent}
      </p>
      {queue.items.length === 0 ? (
        <p className="agent-muted">nothing queued right now</p>
      ) : (
        Object.entries(grouped).map(([topicName, items]) => (
          <div key={topicName}>
            <h2 className="section-label">{topicName}</h2>
            <ul className="feed">
              {items.map((item) => (
                <li key={item.url}>
                  <a href={item.url} target="_blank" rel="noreferrer">
                    <span className="meta">
                      <span className="mono date">
                        {new Date(item.pending_since).toLocaleDateString()}
                      </span>
                      <span className="mono sep">·</span>
                      <span className="mono tag">{item.source}</span>
                      <span className="mono sep">·</span>
                      <span className="mono tag">score {item.score}</span>
                    </span>
                    <span className="title">{item.title}</span>
                    <span className="excerpt">{item.summary}</span>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
    </div>
  );
}
```

Note: this deliberately reuses `.feed`/`.meta`/`.date`/`.sep`/`.tag`/`.title`/`.excerpt` (from `/lab/`'s post listing), `.section-label` (page-level heading style), and `.agent-muted`/`.agent-unavailable` (from the agent widget) — see Global Constraints above. No new class is introduced.

- [ ] **Step 2: Create the route**

Create `app/researcher/queue/page.tsx`:

```tsx
import type { Metadata } from "next";
import PendingQueue from "@/components/PendingQueue";

export const metadata: Metadata = {
  title: "Research Queue",
  description:
    "What the research agent has ranked and is holding for the next Telegram digest.",
  openGraph: {
    title: "Research Queue",
    description:
      "What the research agent has ranked and is holding for the next Telegram digest.",
    type: "article",
  },
};

export default function QueuePage() {
  return (
    <article className="post">
      <div className="wrap">
        <h1>Research Queue</h1>
        <p className="subtitle">
          Everything the agent has ranked above threshold, grouped by topic,
          waiting for the next Telegram digest to go out.
        </p>
        <PendingQueue />
      </div>
    </article>
  );
}
```

- [ ] **Step 3: Link from `/researcher/`**

In `app/researcher/page.tsx`, add a second `plan-link` under the existing one:

```diff
         <Link className="topic-name plan-link" href="/researcher/agent/">
           A Research Agent
         </Link>
+
+        <Link className="topic-name plan-link" href="/researcher/queue/">
+          Research Queue
+        </Link>
```

(`Link` is already imported in this file — no new import needed. `.topic-name` and `.plan-link` are both existing classes; the combinator rule `#researcher.standalone .topics, #researcher.standalone .plan-link { margin-bottom: 48px; }` in `app/globals.css` already applies to every `.plan-link` under `#researcher.standalone`, so this new link gets the same spacing as the first one with no CSS change.)

- [ ] **Step 4: Link from `/researcher/agent/`**

In `app/researcher/agent/page.tsx`, add the import:

```diff
 import type { Metadata } from "next";
+import Link from "next/link";
 import AgentWidget from "@/components/AgentWidget";
```

Add a link as the first paragraph inside the existing `.body` div, before the "Goal" heading, so it inherits `.post .body p`'s existing margin styling with no CSS change:

```diff
         <div className="body">
+          <p>
+            <Link href="/researcher/queue/">See the full pending queue →</Link>
+          </p>
+
           <h2 id="goal">
             <span className="num">01</span>Goal
           </h2>
```

- [ ] **Step 5: Build and serve the static export**

Run: `npm run build && npm run serve`
Expected: build succeeds with no type errors; `npm run serve` serves `out/` on `http://localhost:3000`.

- [ ] **Step 6: Verify the new page against live data**

With the server running, open `http://localhost:3000/researcher/queue/` (or `curl` it and check the HTML shell, then check the browser console/network tab for the client fetch). Confirm:
- The page fetches from `https://raw.githubusercontent.com/hpnssflw/hpnssflw.github.io/agent-data/agent/pending.json` and renders real items grouped by topic, each sorted by score descending within its group.
- The header line shows the correct total count and a sensible "last sent" value (a date, or "never").
- If the live queue happens to be empty, confirm the "nothing queued right now" message renders instead of a blank section.

- [ ] **Step 7: Verify the failure state**

Temporarily edit `lib/pending-queue.ts`'s `PENDING_URL` to a URL that 404s (e.g. append `.does-not-exist` to the path), reload `/researcher/queue/`, and confirm the "queue unavailable" message renders instead of a crash or blank page. Revert the edit afterward — confirm with `git diff lib/pending-queue.ts` that it's back to the committed value before continuing.

- [ ] **Step 8: Visually confirm both nav links**

Open `http://localhost:3000/researcher/` and confirm "Research Queue" renders below "A Research Agent" with matching styling, and that clicking it navigates to `/researcher/queue/`. Open `http://localhost:3000/researcher/agent/` and confirm the new "See the full pending queue →" link renders above the "Goal" section and navigates correctly.

- [ ] **Step 9: Run the full test suite once more**

Run: `npm test`
Expected: PASS, all suites green.

- [ ] **Step 10: Commit**

```bash
git add components/PendingQueue.tsx app/researcher/queue/page.tsx app/researcher/page.tsx app/researcher/agent/page.tsx
git commit -m "$(cat <<'EOF'
Add /researcher/queue/ — the Tony Scraponi MVP pending queue page

Renders agent/pending.json (already public on agent-data, previously
unreadable except as raw JSON) grouped by topic, reusing the existing
.feed/.section-label/.agent-muted CSS verbatim — no new classes.
Linked from /researcher/ and /researcher/agent/. Sub-project #4 of the
Content Direction & Tony Scraponi initiative — MVP scope only (source/
topic visibility), no editing/triggering controls.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```
