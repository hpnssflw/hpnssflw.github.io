import type { AgentConfig } from "./agent-config";
import type { AgentStatus } from "./agent-status";
import { type Decisions, itemStatus } from "./inbox";
import type { PendingQueue } from "./pending-queue";

/** "all", or one topic's slug. */
export type TopicFilter = "all" | (string & {});

/** The control room's rail, in reading order. "review" is where your
 * moderation sits logically; the agent applies decisions at the start of
 * its next run. */
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

export interface LiveData {
  status: AgentStatus | null;
  queue: PendingQueue | null;
  decisions: Decisions | null;
}

const DASH = "—";

/** status.json failure stages → the rail stage they belong to. */
const FAILED_STAGE: Record<string, StageKey> = {
  collect: "collect",
  rank: "rank",
  inbox: "review",
  deliver: "deliver",
};

export function topicSlugs(config: AgentConfig, topic: TopicFilter): string[] {
  return topic === "all" ? config.topics.map((t) => t.slug) : [topic];
}

function thresholdLabel(config: AgentConfig, slugs: string[]): string {
  const values = new Set(config.topics.filter((t) => slugs.includes(t.slug)).map((t) => t.minRelevance));
  return values.size === 1 ? String([...values][0]) : "threshold";
}

/**
 * Each rail stage's number and line for the topics in view, from the last
 * run's status.json (funnel, and drops/failures once the agent writes
 * them), the pending queue and the inbox decisions. See the spec's rail
 * table (docs/superpowers/specs/2026-10-06-tony-control-room-design.md).
 */
export function buildStages(config: AgentConfig, live: LiveData, topic: TopicFilter): StageNumbers[] {
  const slugs = topicSlugs(config, topic);
  const { status, queue, decisions } = live;
  const drops = status?.drops;

  const funnel = (field: "collected" | "in_window" | "new" | "kept"): number | null =>
    status ? slugs.reduce((n, slug) => n + (status.funnel[slug]?.[field] ?? 0), 0) : null;
  const drop = (stage: string, reason: string): number =>
    slugs.reduce((n, slug) => n + (drops?.[slug]?.[stage]?.[reason] ?? 0), 0);
  const show = (n: number | null): string => (n === null ? DASH : String(n));

  const collected = funnel("collected");
  const inWindow = funnel("in_window");
  const fresh = funnel("new");
  const kept = funnel("kept");
  const seen = drop("dedupe", "seen");
  const dismissed = drop("dedupe", "dismissed");
  const below = drop("rank", "below_relevance");

  const collectDrops = [
    [drop("collect", "undated"), "undated"],
    [drop("collect", "below_min_points"), "below min points"],
  ] as const;
  const collectLine = !status
    ? ""
    : drops && collectDrops.some(([n]) => n > 0)
      ? collectDrops
          .filter(([n]) => n > 0)
          .map(([n, label]) => `−${n} ${label}`)
          .join(" · ")
      : "found";

  const inView = queue ? queue.items.filter((i) => slugs.includes(i.topic)) : null;
  const approved =
    inView && decisions ? inView.filter((i) => itemStatus(decisions, i.url) === "approved").length : null;

  const rows: Omit<StageNumbers, "failed">[] = [
    { key: "collect", value: show(collected), line: collectLine },
    { key: "window", value: show(inWindow), line: drops ? `−${drop("date_guard", "outside_window")} too old` : "" },
    {
      key: "dedupe",
      value: drops && inWindow !== null ? String(inWindow - seen - dismissed) : DASH,
      line: drops ? `−${seen} seen · −${dismissed} dismissed` : "",
    },
    { key: "cache", value: show(fresh), line: drops ? `−${drop("dedupe", "already_ranked")} cached below` : "" },
    {
      key: "rank",
      value: drops && fresh !== null ? String(fresh - below) : DASH,
      line: drops ? `−${below} below ${thresholdLabel(config, slugs)}` : "",
    },
    { key: "cap", value: show(kept), line: drops ? `−${drop("rank", "over_max_items")} over cap` : "" },
    { key: "queue", value: show(inView ? inView.length : null), line: kept !== null ? `+${kept} this run` : "" },
    {
      key: "review",
      value: show(approved),
      line: drops ? `−${drop("inbox", "rejected")} rejected · −${drop("inbox", "expired")} expired` : "",
    },
    {
      key: "deliver",
      value: status ? (status.last_sent_at ? status.last_sent_at.slice(5, 10) : "never") : DASH,
      line: "approved only",
    },
  ];

  const failures = status?.failures ?? [];
  return rows.map((row) => {
    const hits = failures.filter(
      (f) => FAILED_STAGE[f.stage] === row.key && (f.topic === null || slugs.includes(f.topic)),
    );
    const failed = hits.length ? [...new Set(hits.map((f) => f.source ?? "run"))].join(", ") : null;
    return { ...row, failed };
  });
}
