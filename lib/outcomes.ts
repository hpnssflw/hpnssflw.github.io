export const STATE_URL =
  "https://raw.githubusercontent.com/hpnssflw/hpnssflw.github.io/agent-data/agent/state.json";

/** One topic's cached verdict on an item (agent/dedupe.py's RankRecord, the fields the page uses). */
export interface Verdict {
  relevance: number;
  rubric: string;
  ranked_at: string;
  queued_at: string | null;
}

export interface StateEntry {
  times_sent: number;
  dismissed: string | null;
  ranks: Record<string, Verdict>;
}

/** state.json: URL hash → entry. */
export type AgentState = Record<string, StateEntry>;

export interface Outcomes {
  queued: number;
  sent: number;
  rejected: number;
  expired: number;
  pending: number;
  /** Verdicts by relevance; index 0 is relevance 1. */
  histogram: number[];
  /** Items sent to DeepSeek per UTC day — the last `days` days through today, oldest first. */
  scoredPerDay: { day: string; count: number }[];
}

const DAY_MS = 86_400_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Validates and normalizes a fetched state.json. Like agent/dedupe.py's
 * load_state, entries without `ranks` (before #6) or `dismissed` (before
 * #5) load with an empty value; any malformed part fails the whole file.
 */
export function parseAgentState(value: unknown): AgentState | null {
  if (!isRecord(value)) return null;
  const state: AgentState = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!isRecord(raw) || typeof raw.times_sent !== "number") return null;
    const dismissed = raw.dismissed ?? null;
    if (dismissed !== null && typeof dismissed !== "string") return null;
    const rawRanks = raw.ranks ?? {};
    if (!isRecord(rawRanks)) return null;
    const ranks: Record<string, Verdict> = {};
    for (const [slug, r] of Object.entries(rawRanks)) {
      if (!isRecord(r) || typeof r.relevance !== "number" || typeof r.rubric !== "string" || typeof r.ranked_at !== "string") {
        return null;
      }
      const queuedAt = r.queued_at ?? null;
      if (queuedAt !== null && typeof queuedAt !== "string") return null;
      ranks[slug] = { relevance: r.relevance, rubric: r.rubric, ranked_at: r.ranked_at, queued_at: queuedAt };
    }
    state[key] = { times_sent: raw.times_sent, dismissed, ranks };
  }
  return state;
}

/**
 * agent/report.py's build_report over the given topics: what happened to
 * items queued in the last `days` days, the relevance histogram, and how
 * many items were scored (sent to DeepSeek) per day. An item queued under
 * two topics counts once per topic, as in the report.
 */
export function buildOutcomes(state: AgentState, slugs: string[], now: Date, days = 14): Outcomes {
  const since = now.getTime() - days * DAY_MS;
  const out: Outcomes = { queued: 0, sent: 0, rejected: 0, expired: 0, pending: 0, histogram: Array(10).fill(0), scoredPerDay: [] };
  const perDay = new Map<string, number>();
  for (let i = days - 1; i >= 0; i--) perDay.set(new Date(now.getTime() - i * DAY_MS).toISOString().slice(0, 10), 0);

  for (const entry of Object.values(state)) {
    for (const slug of slugs) {
      const verdict = entry.ranks[slug];
      if (!verdict) continue;
      const rankedAt = Date.parse(verdict.ranked_at);
      if (rankedAt >= since) {
        if (Number.isInteger(verdict.relevance) && verdict.relevance >= 1 && verdict.relevance <= 10) {
          out.histogram[verdict.relevance - 1] += 1;
        }
        const day = new Date(rankedAt).toISOString().slice(0, 10);
        const count = perDay.get(day);
        if (count !== undefined) perDay.set(day, count + 1);
      }
      if (verdict.queued_at !== null && Date.parse(verdict.queued_at) >= since) {
        out.queued += 1;
        if (entry.times_sent > 0) out.sent += 1;
        else if (entry.dismissed === "rejected") out.rejected += 1;
        else if (entry.dismissed === "expired") out.expired += 1;
        else if (entry.dismissed === null) out.pending += 1;
      }
    }
  }
  out.scoredPerDay = [...perDay].map(([day, count]) => ({ day, count }));
  return out;
}

/** How many cached verdicts the topics hold, and the rubric of the newest — the cache stage's numbers. */
export function topicVerdicts(state: AgentState, slugs: string[]): { count: number; rubric: string | null } {
  let count = 0;
  let newest = -Infinity;
  let rubric: string | null = null;
  for (const entry of Object.values(state)) {
    for (const slug of slugs) {
      const verdict = entry.ranks[slug];
      if (!verdict) continue;
      count += 1;
      const at = Date.parse(verdict.ranked_at);
      if (at > newest) {
        newest = at;
        rubric = verdict.rubric;
      }
    }
  }
  return { count, rubric };
}
