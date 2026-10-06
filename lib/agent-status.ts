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

const isNumber = (value: unknown): value is number => typeof value === "number";
const isString = (value: unknown): value is string => typeof value === "string";

function isTopicStatus(value: unknown): value is TopicStatus {
  return isRecord(value) && isString(value.slug) && isString(value.name) && isNumber(value.collected) && isNumber(value.kept);
}

function isFunnelCounts(value: unknown): value is FunnelCounts {
  return (
    isRecord(value) &&
    isNumber(value.collected) &&
    isNumber(value.in_window) &&
    isNumber(value.new) &&
    isNumber(value.kept)
  );
}

function isRunHistoryEntry(value: unknown): value is RunHistoryEntry {
  return isRecord(value) && isNumber(value.kept) && isDate(value.ts);
}

function isRecentEvent(value: unknown): value is RecentEvent {
  return (
    isRecord(value) &&
    isDate(value.ts) &&
    (value.verdict === "kept" || value.verdict === "drop") &&
    isString(value.topic) &&
    isString(value.title) &&
    (value.reason === undefined || isString(value.reason)) &&
    (value.score === undefined || isNumber(value.score))
  );
}

function hasRequiredFields(
  s: Record<string, unknown>,
): s is Record<string, unknown> & Omit<AgentStatus, "drops" | "failures"> {
  const { topics, funnel } = s;
  return (
    isNumber(s.cadence_hours) &&
    isNumber(s.delivery_cadence_hours) &&
    isNumber(s.streak) &&
    isNumber(s.pending_count) &&
    isDate(s.updated_at) &&
    (s.last_sent_at === null || isDate(s.last_sent_at)) &&
    Array.isArray(topics) &&
    topics.every(isTopicStatus) &&
    isRecord(funnel) &&
    Object.values(funnel).every(isFunnelCounts) &&
    topics.every((t) => isFunnelCounts(funnel[t.slug])) &&
    Array.isArray(s.run_history) &&
    s.run_history.every(isRunHistoryEntry) &&
    Array.isArray(s.recent_events) &&
    s.recent_events.every(isRecentEvent)
  );
}

/**
 * Validates a fetched `status.json` against `AgentStatus`. Its fields are
 * read during React render, so a payload that doesn't match the type has
 * to be caught here or it crashes the route. Every required field is
 * checked, entries included, and dates must parse: any failure returns
 * null, which the pages show as "unavailable". The optional `drops` and
 * `failures` (only the control room's rail reads them) fail soft — a
 * malformed one is left out, so it can't blank the home widgets. Returns
 * a copy; unknown keys pass through.
 */
export function parseAgentStatus(value: unknown): AgentStatus | null {
  if (!isRecord(value)) return null;
  const { drops, failures, ...rest } = value;
  if (!hasRequiredFields(rest)) return null;
  const status: AgentStatus = { ...rest };
  if (isDropCounts(drops)) status.drops = drops;
  if (Array.isArray(failures) && failures.every(isRunFailure)) status.failures = failures;
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
