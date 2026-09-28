import { PRESENCE_STALE_MS } from "./now-config";
import { formatAgo, formatDuration } from "./now-format";

export type PresenceState = "working" | "waiting" | "offline";
export type ModelFamily = "opus" | "sonnet" | "haiku" | "fable";

/** presence.json v1 — written by scripts/presence/run.mjs. */
export interface Presence {
  v: 1;
  state: PresenceState;
  since: string | null;
  lastActive: string | null;
  todayMinutes: number;
  sessionsToday: number;
  model: ModelFamily | null;
  day: string;
  tz: string;
  updatedAt: string;
}

const STATES: readonly string[] = ["working", "waiting", "offline"];
const MODELS: readonly string[] = ["opus", "sonnet", "haiku", "fable"];

function isIso(value: unknown): boolean {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function isCount(value: unknown): boolean {
  return Number.isInteger(value) && (value as number) >= 0;
}

/**
 * Structural guard for a fetched presence.json. Rebuilds the object from
 * the known keys only, so anything extra in the file never reaches render.
 */
export function parsePresence(json: unknown): Presence | null {
  if (typeof json !== "object" || json === null) return null;
  const p = json as Record<string, unknown>;
  if (p.v !== 1) return null;
  if (typeof p.state !== "string" || !STATES.includes(p.state)) return null;
  if (p.since !== null && !isIso(p.since)) return null;
  if (p.lastActive !== null && !isIso(p.lastActive)) return null;
  if (!isCount(p.todayMinutes) || !isCount(p.sessionsToday)) return null;
  if (p.model !== null && !(typeof p.model === "string" && MODELS.includes(p.model))) {
    return null;
  }
  if (typeof p.day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(p.day)) return null;
  if (typeof p.tz !== "string" || p.tz === "") return null;
  if (!isIso(p.updatedAt)) return null;
  return {
    v: 1,
    state: p.state as PresenceState,
    since: p.since as string | null,
    lastActive: p.lastActive as string | null,
    todayMinutes: p.todayMinutes as number,
    sessionsToday: p.sessionsToday as number,
    model: p.model as ModelFamily | null,
    day: p.day,
    tz: p.tz,
    updatedAt: p.updatedAt as string,
  };
}

/** Stale data never shows as live: past the threshold it's offline. */
export function effectiveState(p: Presence, nowMs: number): PresenceState {
  return nowMs - Date.parse(p.updatedAt) > PRESENCE_STALE_MS ? "offline" : p.state;
}

/** True iff it is still `day` for the owner, in the owner's time zone. */
export function isOwnerToday(day: string, tz: string, nowMs: number): boolean {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(nowMs);
    const part = (type: string) => parts.find((x) => x.type === type)?.value;
    return `${part("year")}-${part("month")}-${part("day")}` === day;
  } catch {
    return false;
  }
}

export interface PresenceView {
  state: PresenceState;
  headline: string;
  today: string | null;
  footer: string;
}

/**
 * The widget's three lines. The stretch is a duration ("for 1h 20m"),
 * not a clock time, so viewers in other zones aren't misled.
 */
export function presenceView(p: Presence, nowMs: number): PresenceView {
  const state = effectiveState(p, nowMs);

  let headline: string = state;
  if (state === "offline") {
    if (p.lastActive) {
      headline = `offline · last active ${formatAgo(nowMs - Date.parse(p.lastActive))}`;
    }
  } else if (p.since) {
    headline = `${state} · for ${formatDuration(nowMs - Date.parse(p.since))}`;
  }

  const sessions = `${p.sessionsToday} ${p.sessionsToday === 1 ? "session" : "sessions"}`;
  const today =
    p.sessionsToday > 0 && isOwnerToday(p.day, p.tz, nowMs)
      ? `today ${formatDuration(p.todayMinutes * 60_000)} · ${sessions}`
      : null;

  const updated = `updated ${formatAgo(nowMs - Date.parse(p.updatedAt))}`;
  return { state, headline, today, footer: p.model ? `${p.model} · ${updated}` : updated };
}
