import type { Text } from "./control-room-text";
import { type Decisions, itemStatus } from "./inbox";
import type { PendingItem } from "./pending-queue";
import { FEED_SCOPE, type RunResult, type ScopeCounts } from "./run-result";

/** "all", or one topic's slug. */
export type TopicFilter = "all" | (string & {});

/** The rail, in reading order. "review" is where moderation sits
 * logically; the agent applies decisions at the start of its next run.
 * run-result.json's `enrich` folds into rank, `format` into deliver. */
export const STAGE_KEYS = ["collect", "window", "dedupe", "cache", "rank", "cap", "queue", "review", "deliver"] as const;
export type StageKey = (typeof STAGE_KEYS)[number];

export interface StageNumbers {
  key: StageKey;
  /** The big number, or "—" when the data for it isn't there. */
  value: string;
  /** What the stage removed (or added), muted; "" when unknown. */
  line: string;
  /** Sources (or "run") that failed at this stage this run; null if none. */
  failed: string | null;
}

/** What the page knows live on top of the run: Tony's pending.json and
 * inbox, or the demo's sandbox decisions. */
export interface LiveOverlay {
  /** Items in the queue now (all topics); null: the run's own queue. */
  queue: PendingItem[] | null;
  /** Decisions counted on the review stage; null: the run's own count. */
  decisions: Decisions | null;
}

const DASH = "—";

/** Stages where a picked topic with nothing of its own shows the shared
 * feeds (`*`) instead: everything before items are sorted into topics. */
const BEFORE_SORTING = new Set(["collect", "window", "dedupe", "cache", "enrich", "rank"]);

/** run-result.json failure stages → the rail stage they show on. */
const RAIL_STAGE: Record<string, StageKey> = {
  collect: "collect",
  window: "window",
  dedupe: "dedupe",
  cache: "cache",
  enrich: "rank",
  rank: "rank",
  cap: "cap",
  queue: "queue",
  review: "review",
  format: "deliver",
  deliver: "deliver",
};

const COLLECT_DROPS = ["undated", "no_link", "below_min_points"] as const;

export function topicSlugs(topics: { slug: string }[], topic: TopicFilter): string[] {
  return topic === "all" ? topics.map((t) => t.slug) : [topic];
}

interface Summed {
  in: number;
  out: number;
  drops: Record<string, number>;
  notes: Record<string, number>;
  /** The numbers are the shared feeds', not the picked topic's own. */
  shared: boolean;
}

function add(into: Summed, scope: ScopeCounts | undefined): void {
  if (!scope) return;
  into.in += scope.in;
  into.out += scope.out;
  for (const [reason, n] of Object.entries(scope.drops)) into.drops[reason] = (into.drops[reason] ?? 0) + n;
  for (const [key, n] of Object.entries(scope.notes ?? {})) into.notes[key] = (into.notes[key] ?? 0) + n;
}

const isEmpty = (scope: ScopeCounts | undefined): boolean => !scope || (scope.in === 0 && scope.out === 0);

/** One stage's counts over the scopes in view. */
function sumStage(result: RunResult, stage: string, topic: TopicFilter): Summed {
  const scopes = result.stages.find((s) => s.stage === stage)?.scopes ?? {};
  const sum: Summed = { in: 0, out: 0, drops: {}, notes: {}, shared: false };
  if (topic === "all") {
    for (const scope of Object.values(scopes)) add(sum, scope);
    return sum;
  }
  const own = scopes[topic];
  const feeds = scopes[FEED_SCOPE];
  const sorted = feeds?.assigned?.[topic] ?? 0;
  if (BEFORE_SORTING.has(stage) && isEmpty(own) && !isEmpty(feeds)) {
    add(sum, feeds);
    sum.shared = true;
    if (stage === "rank") sum.out = sorted;
    return sum;
  }
  add(sum, own);
  if (stage === "rank") sum.out += sorted;
  return sum;
}

/**
 * Each rail stage's number and line for the topics in view, from a run's
 * `stages` (run-result.json), with the page's live queue and decisions on
 * top when it has them. See the rail table in
 * docs/superpowers/specs/2026-10-06-preset-switcher-design.md § 3.
 */
export function buildStages(
  result: RunResult | null,
  live: LiveOverlay,
  topic: TopicFilter,
  text: Text["rail"],
): StageNumbers[] {
  const inView = (items: PendingItem[]) => items.filter((i) => topic === "all" || i.topic === topic);
  const liveQueue = live.queue ? inView(live.queue) : null;
  const pool = liveQueue ?? (result ? inView(result.queue.items) : null);
  const approved =
    live.decisions && pool ? pool.filter((i) => itemStatus(live.decisions, i.url) === "approved").length : null;

  if (!result) {
    return STAGE_KEYS.map((key) => ({
      key,
      value:
        key === "queue" && liveQueue ? String(liveQueue.length) : key === "review" && approved !== null ? String(approved) : DASH,
      line: "",
      failed: null,
    }));
  }

  const s = (stage: string) => sumStage(result, stage, topic);
  const minus = (n: number | undefined, label: string) => `−${n ?? 0} ${label}`;
  const mark = (sum: Summed, line: string) => (sum.shared ? `${line} · ${text.shared}` : line);

  const collect = s("collect");
  const window = s("window");
  const dedupe = s("dedupe");
  const cache = s("cache");
  const enrich = s("enrich");
  const rank = s("rank");
  const cap = s("cap");
  const queue = s("queue");
  const review = s("review");

  const slugs = topicSlugs(result.config.topics, topic);
  const thresholds = new Set(result.config.topics.filter((t) => slugs.includes(t.slug)).map((t) => t.min_relevance));
  const threshold = thresholds.size === 1 ? String([...thresholds][0]) : text.threshold;

  const collectDrops = COLLECT_DROPS.filter((reason) => (collect.drops[reason] ?? 0) > 0).map((reason) =>
    minus(collect.drops[reason], text.drops[reason]),
  );
  const rankLine = [minus(rank.drops.below_relevance, text.below(threshold))];
  if (rank.drops.off_topic) rankLine.push(minus(rank.drops.off_topic, text.drops.off_topic));
  if (enrich.notes.full_text) rankLine.push(text.fullText(enrich.notes.full_text));
  const { delivery } = result;

  const rows: Omit<StageNumbers, "failed">[] = [
    { key: "collect", value: String(collect.out), line: mark(collect, collectDrops.length ? collectDrops.join(" · ") : text.found) },
    { key: "window", value: String(window.out), line: mark(window, minus(window.drops.outside_window, text.drops.outside_window)) },
    {
      key: "dedupe",
      value: String(dedupe.out),
      line: mark(dedupe, `${minus(dedupe.drops.seen, text.drops.seen)} · ${minus(dedupe.drops.dismissed, text.drops.dismissed)}`),
    },
    { key: "cache", value: String(cache.out), line: mark(cache, minus(cache.drops.already_ranked, text.drops.already_ranked)) },
    { key: "rank", value: String(rank.out), line: mark(rank, rankLine.join(" · ")) },
    { key: "cap", value: String(cap.out), line: minus(cap.drops.over_max_items, text.drops.over_max_items) },
    { key: "queue", value: String(liveQueue ? liveQueue.length : queue.out), line: text.thisRun(queue.in) },
    {
      key: "review",
      value: String(approved ?? review.notes.approved ?? 0),
      line: `${minus(review.drops.rejected, text.drops.rejected)} · ${minus(review.drops.expired, text.drops.expired)}`,
    },
    {
      key: "deliver",
      value: delivery.last_sent_at ? delivery.last_sent_at.slice(5, 10) : text.never,
      line: delivery.sent_items > 0 ? text.sent(delivery.sent_items, delivery.messages) : text.approvedOnly,
    },
  ];

  return rows.map((row) => {
    const hits = result.failures.filter(
      (f) => RAIL_STAGE[f.stage] === row.key && (topic === "all" || f.scope === topic || f.scope === FEED_SCOPE),
    );
    const failed = hits.length ? [...new Set(hits.map((f) => f.source ?? "run"))].join(", ") : null;
    return { ...row, failed };
  });
}
