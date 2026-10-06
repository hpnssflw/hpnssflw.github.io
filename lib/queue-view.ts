import { type Decisions, itemStatus } from "./inbox";
import type { PendingItem } from "./pending-queue";
import type { TopicFilter } from "./pipeline-stages";

export const STATUS_FILTERS = ["waiting", "approved", "rejected", "all"] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number];

function inTopic(item: PendingItem, topic: TopicFilter): boolean {
  return topic === "all" || item.topic === topic;
}

/** Score descending, then the most recently queued first. */
function byScoreThenNewest(a: PendingItem, b: PendingItem): number {
  return b.score - a.score || b.pending_since.localeCompare(a.pending_since);
}

/** The queue pane's rows. Without decisions every item counts as waiting. */
export function visibleItems(
  items: PendingItem[],
  decisions: Decisions | null,
  topic: TopicFilter,
  status: StatusFilter,
): PendingItem[] {
  return items
    .filter((i) => inTopic(i, topic) && (status === "all" || itemStatus(decisions, i.url) === status))
    .sort(byScoreThenNewest);
}

/** Pending items per topic slug, plus "all" (which also counts items of retired topics). */
export function topicCounts(items: PendingItem[], slugs: string[]): Record<string, number> {
  const counts: Record<string, number> = { all: items.length };
  for (const slug of slugs) counts[slug] = 0;
  for (const item of items) if (item.topic in counts && item.topic !== "all") counts[item.topic] += 1;
  return counts;
}

export function statusCounts(
  items: PendingItem[],
  decisions: Decisions | null,
  topic: TopicFilter,
): Record<StatusFilter, number> {
  const pool = items.filter((i) => inTopic(i, topic));
  const counts: Record<StatusFilter, number> = { waiting: 0, approved: 0, rejected: 0, all: pool.length };
  for (const item of pool) counts[itemStatus(decisions, item.url)] += 1;
  return counts;
}

/** After deciding `url`: the row below it in `rows` (the list before the decision), else the one above. */
export function nextSelection(rows: PendingItem[], url: string): string | null {
  const i = rows.findIndex((r) => r.url === url);
  if (i === -1) return rows[0]?.url ?? null;
  return rows[i + 1]?.url ?? rows[i - 1]?.url ?? null;
}

/** The selected row: `url` while it's visible, else the first row. */
export function resolveSelection(rows: PendingItem[], url: string | null): PendingItem | null {
  return rows.find((r) => r.url === url) ?? rows[0] ?? null;
}

/** j/k: `delta` rows from the selection (the first row when none), clamped. */
export function moveSelection(rows: PendingItem[], url: string | null, delta: number): string | null {
  if (rows.length === 0) return null;
  const i = Math.max(0, rows.findIndex((r) => r.url === url));
  return rows[Math.min(rows.length - 1, Math.max(0, i + delta))].url;
}
