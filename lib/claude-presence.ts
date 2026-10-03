import { levelsOf } from "./github-calendar";
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
  /** Active minutes per owner-local day, the last 28 days, `day` last; null from an older runner. */
  dailyMinutes: number[] | null;
}

/** How many days dailyMinutes covers (DAILY_DAYS in scripts/presence/collect.mjs). */
export const DAILY_DAYS = 28;

const STATES: readonly string[] = ["working", "waiting", "offline"];
/** Must match MODEL_FAMILIES in scripts/presence/collect.mjs (cross-checked in its tests). */
export const MODELS: readonly string[] = ["opus", "sonnet", "haiku", "fable"];

function isIso(value: unknown): boolean {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function isCount(value: unknown): boolean {
  return Number.isInteger(value) && (value as number) >= 0;
}

function isDaily(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.length === DAILY_DAYS &&
    value.every((n) => isCount(n) && n <= 24 * 60)
  );
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
  // Missing is fine (a runner from before the key existed); malformed is not.
  if (p.dailyMinutes !== undefined && !isDaily(p.dailyMinutes)) return null;
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
    dailyMinutes: isDaily(p.dailyMinutes) ? [...p.dailyMinutes] : null,
  };
}

/** Stale data never shows as live: past the threshold it's offline. */
export function effectiveState(p: Presence, nowMs: number): PresenceState {
  return nowMs - Date.parse(p.updatedAt) > PRESENCE_STALE_MS ? "offline" : p.state;
}

/** The owner's calendar day (YYYY-MM-DD) at nowMs, in their time zone; null for a bad tz. */
export function ownerDay(tz: string, nowMs: number): string | null {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(nowMs);
    const part = (type: string) => parts.find((x) => x.type === type)?.value;
    return `${part("year")}-${part("month")}-${part("day")}`;
  } catch {
    return null;
  }
}

/** True iff it is still `day` for the owner, in the owner's time zone. */
export function isOwnerToday(day: string, tz: string, nowMs: number): boolean {
  return ownerDay(tz, nowMs) === day;
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

const DAY_MS = 86_400_000;
const dayNumber = (day: string) => Math.round(Date.parse(`${day}T00:00:00Z`) / DAY_MS);

export interface RecentDay {
  date: string; // YYYY-MM-DD, owner-local
  minutes: number;
  level: 0 | 1 | 2 | 3 | 4; // quartiles of the active days, as on the GitHub grid
  today: boolean;
}

/**
 * The home hero's 28-day strip, ending on the owner's today. A file from
 * an earlier day is shifted along (the days since it was written are
 * empty); without history, only today's minutes are known.
 */
export function recentDays(p: Presence, nowMs: number): RecentDay[] {
  const today = ownerDay(p.tz, nowMs) ?? p.day;
  const base = p.dailyMinutes ?? [...Array(DAILY_DAYS - 1).fill(0), p.todayMinutes];
  const elapsed = Math.max(0, dayNumber(today) - dayNumber(p.day));
  const minutes =
    elapsed >= DAILY_DAYS
      ? Array<number>(DAILY_DAYS).fill(0)
      : [...base.slice(elapsed), ...Array<number>(elapsed).fill(0)];
  const levels = levelsOf(minutes);
  const last = dayNumber(today);
  return minutes.map((m, i) => ({
    date: new Date((last - (DAILY_DAYS - 1 - i)) * DAY_MS).toISOString().slice(0, 10),
    minutes: m,
    level: levels[i],
    today: i === DAILY_DAYS - 1,
  }));
}
