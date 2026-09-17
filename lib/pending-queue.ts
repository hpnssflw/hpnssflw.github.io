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
