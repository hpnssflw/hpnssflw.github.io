export const STATUS_URL =
  "https://raw.githubusercontent.com/hpnssflw/hpnssflw.github.io/agent-data/agent/status.json";

export interface RunHistoryEntry {
  kept: number;
  ts: string;
}

export interface TopicStatus {
  slug: string;
  name: string;
  collected: number;
  kept: number;
}

export interface FunnelCounts {
  collected: number;
  in_window: number;
  new: number;
  kept: number;
}

export interface RecentEvent {
  ts: string;
  verdict: "kept" | "drop";
  topic: string;
  title: string;
  reason?: string;
  score?: number;
}

/**
 * Drop counts by topic slug → stage → reason, from the run's drop events
 * (agent/status_export.py, 2026-10). Stages: collect, date_guard, dedupe,
 * rank, inbox. Absent from status.json written before that change.
 */
export type DropCounts = Record<string, Record<string, Record<string, number>>>;

/** A stage that failed in this run — which one, never why. */
export interface RunFailure {
  stage: string;
  topic: string | null;
  source: string | null;
}

export interface AgentStatus {
  cadence_hours: number;
  delivery_cadence_hours: number;
  streak: number;
  pending_count: number;
  updated_at: string;
  last_sent_at: string | null;
  topics: TopicStatus[];
  funnel: Record<string, FunnelCounts>;
  recent_events: RecentEvent[];
  run_history: RunHistoryEntry[];
  drops?: DropCounts;
  failures?: RunFailure[];
}

const SPARK_GLYPHS = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDropCounts(value: unknown): value is DropCounts {
  return (
    isRecord(value) &&
    Object.values(value).every(
      (stages) =>
        isRecord(stages) &&
        Object.values(stages).every(
          (reasons) => isRecord(reasons) && Object.values(reasons).every((n) => typeof n === "number"),
        ),
    )
  );
}

function isRunFailure(value: unknown): value is RunFailure {
  return (
    isRecord(value) &&
    typeof value.stage === "string" &&
    (value.topic === null || typeof value.topic === "string") &&
    (value.source === null || typeof value.source === "string")
  );
}

function isDate(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function isRunHistoryEntry(value: unknown): value is RunHistoryEntry {
  return isRecord(value) && typeof value.kept === "number" && isDate(value.ts);
}

function isRecentEvent(value: unknown): value is RecentEvent {
  return (
    isRecord(value) &&
    isDate(value.ts) &&
    (value.verdict === "kept" || value.verdict === "drop") &&
    typeof value.topic === "string" &&
    typeof value.title === "string" &&
    (value.reason === undefined || typeof value.reason === "string") &&
    (value.score === undefined || typeof value.score === "number")
  );
}

/**
 * Validates a fetched `status.json` and returns a cleaned copy, or null.
 * Components read its fields during render, so a bad shape must stop
 * here. The core — the numbers, `updated_at`, topics with their funnel
 * entries, the two lists — rejects the whole status when malformed
 * ("agent status unavailable"). Everything else costs only itself (#8's
 * M2): malformed `drops`/`failures` are left out, an unparseable
 * `last_sent_at` becomes null, and list entries with a bad shape or date
 * are skipped. A date that doesn't parse never reaches toISOString() (M1).
 */
export function parseAgentStatus(value: unknown): AgentStatus | null {
  if (!isRecord(value)) return null;
  const { funnel, topics, run_history, recent_events } = value;
  if (
    typeof value.cadence_hours !== "number" ||
    typeof value.streak !== "number" ||
    typeof value.pending_count !== "number" ||
    !isDate(value.updated_at) ||
    !Array.isArray(topics) ||
    !Array.isArray(run_history) ||
    !Array.isArray(recent_events) ||
    !isRecord(funnel) ||
    !topics.every((t) => isRecord(t) && typeof t.slug === "string" && isRecord(funnel[t.slug]))
  ) {
    return null;
  }
  const status: AgentStatus = {
    ...(value as unknown as AgentStatus),
    last_sent_at: isDate(value.last_sent_at) ? value.last_sent_at : null,
    run_history: run_history.filter(isRunHistoryEntry),
    recent_events: recent_events.filter(isRecentEvent),
  };
  if (!isDropCounts(value.drops)) delete status.drops;
  if (!(Array.isArray(value.failures) && value.failures.every(isRunFailure))) delete status.failures;
  return status;
}

/** Stale once the last run is older than two cadence windows. */
export function isStale(status: AgentStatus, now: number = Date.now()): boolean {
  const updated = new Date(status.updated_at).getTime();
  const staleAfterMs = status.cadence_hours * 2 * 3600 * 1000;
  return now - updated > staleAfterMs;
}

export interface SparkCell {
  glyph: string;
  /** kept === 0 — rendered in the red "zero" colour. */
  zero: boolean;
}

export function sparklineCells(history: RunHistoryEntry[]): SparkCell[] {
  if (!history.length) return [];
  const max = Math.max(1, ...history.map((h) => h.kept));
  return history.map((run) => {
    if (run.kept === 0) return { glyph: "▁", zero: true };
    const level = Math.min(
      SPARK_GLYPHS.length - 1,
      Math.round((run.kept / max) * (SPARK_GLYPHS.length - 1)),
    );
    return { glyph: SPARK_GLYPHS[level], zero: false };
  });
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function fmtCountdown(seconds: number): string {
  if (seconds <= 0) return "due now";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

/** Epoch ms of the next expected run. */
export function nextRunAt(status: AgentStatus): number {
  return (
    new Date(status.updated_at).getTime() +
    status.cadence_hours * 3600 * 1000
  );
}
