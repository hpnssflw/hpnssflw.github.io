/**
 * Pure logic for the local collector (run.mjs): Claude Code presence and
 * the Yandex Music playlist trimmer. No I/O — everything, including
 * `now`, is passed in, so it is fully testable. buildPresence() and
 * trimPlaylists() are the privacy boundaries: they assemble the published
 * objects key by key and never spread an input.
 * See docs/superpowers/specs/2026-09-28-now-page-design.md.
 */

export const ACTIVE_GAP_MS = 15 * 60_000;

/** The complete allowlist of keys that may appear in presence.json. */
export const PRESENCE_KEYS = Object.freeze([
  "v",
  "state",
  "since",
  "lastActive",
  "todayMinutes",
  "sessionsToday",
  "model",
  "day",
  "tz",
  "updatedAt",
]);

/** The complete per-playlist allowlist for playlists.json. */
export const PLAYLIST_KEYS = Object.freeze([
  "playlistUuid",
  "title",
  "visibility",
  "trackCount",
  "durationMs",
  "modified",
  "cover",
]);

const FAMILIES = ["opus", "sonnet", "haiku", "fable"];

/**
 * working: a session is busy. waiting: none busy, but activity within the
 * gap. offline: everything else — an idle session left open for days is
 * not presence.
 */
export function deriveState({ agents, lastActiveMs, nowMs }) {
  if (agents.some((a) => a && a.status === "busy")) return "working";
  if (lastActiveMs !== null && nowMs - lastActiveMs <= ACTIVE_GAP_MS) return "waiting";
  return "offline";
}

/** Merges timestamps (from dayStartMs on) into stretches split by gaps > gapMs. */
export function mergeActivity(timestampsMs, { dayStartMs, gapMs = ACTIVE_GAP_MS }) {
  const sorted = timestampsMs
    .filter((t) => Number.isFinite(t) && t >= dayStartMs)
    .sort((a, b) => a - b);
  const intervals = [];
  for (const t of sorted) {
    const last = intervals[intervals.length - 1];
    if (last && t - last.end <= gapMs) last.end = t;
    else intervals.push({ start: t, end: t });
  }
  return intervals;
}

export function totalMinutes(intervals) {
  const ms = intervals.reduce((sum, i) => sum + (i.end - i.start), 0);
  return Math.floor(ms / 60_000);
}

export function modelFamily(modelId) {
  if (typeof modelId !== "string") return null;
  return FAMILIES.find((family) => modelId.includes(family)) ?? null;
}

/**
 * One "offline" push, then silence — the page's staleness check covers the
 * rest — unless the playlists changed, which is worth a push on its own.
 */
export function shouldPublish({ prevState, nextState, playlistsChanged }) {
  return playlistsChanged || !(prevState === "offline" && nextState === "offline");
}

function pad(n) {
  return String(n).padStart(2, "0");
}

/** The machine's local calendar day and its midnight. */
export function localDayInfo(nowMs) {
  const d = new Date(nowMs);
  return {
    day: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    dayStartMs: new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(),
  };
}

function isoMinute(ms) {
  return ms === null ? null : new Date(Math.floor(ms / 60_000) * 60_000).toISOString();
}

function maxOrNull(values) {
  let max = null;
  for (const v of values) if (Number.isFinite(v) && (max === null || v > max)) max = v;
  return max;
}

export function buildPresence({ agents, events, nowMs, dayStartMs, day, tz, prevLastActive }) {
  const prevMs = typeof prevLastActive === "string" ? Date.parse(prevLastActive) : NaN;
  const lastActiveMs = maxOrNull([...events.map((e) => e.ts), prevMs]);
  const today = events.filter((e) => Number.isFinite(e.ts) && e.ts >= dayStartMs);
  const intervals = mergeActivity(
    today.map((e) => e.ts),
    { dayStartMs },
  );
  const state = deriveState({ agents, lastActiveMs, nowMs });
  const lastInterval = intervals[intervals.length - 1];

  let model = null;
  let modelTs = -Infinity;
  for (const e of today) {
    const family = modelFamily(e.model);
    if (family && e.ts > modelTs) {
      model = family;
      modelTs = e.ts;
    }
  }

  const sessions = new Set();
  for (const e of today) if (typeof e.sessionId === "string") sessions.add(e.sessionId);

  return {
    v: 1,
    state,
    since: state !== "offline" && lastInterval ? isoMinute(lastInterval.start) : null,
    lastActive: isoMinute(lastActiveMs),
    todayMinutes: totalMinutes(intervals),
    sessionsToday: sessions.size,
    model,
    day,
    tz,
    updatedAt: isoMinute(nowMs),
  };
}

function trimCover(cover) {
  if (typeof cover !== "object" || cover === null) return null;
  const out = {};
  if (typeof cover.type === "string") out.type = cover.type;
  if (Array.isArray(cover.itemsUri)) {
    out.itemsUri = cover.itemsUri.filter((uri) => typeof uri === "string").slice(0, 4);
  }
  return out;
}

/**
 * The playlists.json privacy boundary. Keeps the API's `{ result: [...] }`
 * shape so lib/yandex-music.ts normalizes it unchanged, but only public
 * playlists and only PLAYLIST_KEYS (cover: `type`, `itemsUri`), each copied
 * only when it has the expected type. Drops the `owner` block and every
 * other key. `null` = not a playlist response at all (the runner then
 * keeps the last published file); `{ result: [] }` = no public playlists.
 */
export function trimPlaylists(json) {
  if (typeof json !== "object" || json === null || !Array.isArray(json.result)) return null;
  const result = [];
  for (const item of json.result) {
    if (typeof item !== "object" || item === null || item.visibility !== "public") continue;
    const out = {};
    for (const key of ["playlistUuid", "title", "visibility", "modified"]) {
      if (typeof item[key] === "string") out[key] = item[key];
    }
    for (const key of ["trackCount", "durationMs"]) {
      if (typeof item[key] === "number") out[key] = item[key];
    }
    const cover = trimCover(item.cover);
    if (cover) out.cover = cover;
    result.push(out);
  }
  return { result };
}
