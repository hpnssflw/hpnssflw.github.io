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
}

const SPARK_GLYPHS = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];

/**
 * Structural guard for a fetched `status.json`. The old widget rendered
 * everything inside the fetch `.then()`, so any shape drift landed in
 * `.catch()` → "agent status unavailable". The component renders fields
 * during React render now, so the shape has to be checked before it is
 * accepted, or a bad payload would white-screen the route instead.
 */
export function isAgentStatus(value: unknown): value is AgentStatus {
  if (typeof value !== "object" || value === null) return false;
  const s = value as Record<string, unknown>;
  return (
    typeof s.cadence_hours === "number" &&
    typeof s.streak === "number" &&
    typeof s.pending_count === "number" &&
    typeof s.updated_at === "string" &&
    Array.isArray(s.topics) &&
    Array.isArray(s.run_history) &&
    Array.isArray(s.recent_events) &&
    typeof s.funnel === "object" &&
    s.funnel !== null &&
    (s.topics as TopicStatus[]).every(
      (t) => t && typeof t.slug === "string" && s.funnel != null &&
        typeof (s.funnel as Record<string, unknown>)[t.slug] === "object",
    )
  );
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
