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

/**
 * True for a subagent transcript (`<session>/subagents/agent-*.jsonl`).
 * Its events still count as activity, but its model is not the one Artem
 * is talking to, so run.mjs drops it. Takes either separator; a project
 * dir merely named like `...subagents-foo` doesn't match.
 */
export function isSubagentTranscript(path) {
  return typeof path === "string" && /(^|[\\/])subagents[\\/]/.test(path);
}

export function modelFamily(modelId) {
  if (typeof modelId !== "string") return null;
  return FAMILIES.find((family) => modelId.includes(family)) ?? null;
}

/**
 * One "offline" push, then silence — the page's staleness check covers the
 * rest — unless the playlists changed, which is worth a push on its own, or
 * the clone holds a commit whose push failed (`unpushed`): prevState and
 * the playlists comparison were read from that unpushed commit.
 */
export function shouldPublish({ prevState, nextState, playlistsChanged, unpushed = false }) {
  return unpushed || playlistsChanged || !(prevState === "offline" && nextState === "offline");
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

/** Cover URIs are host-relative (`avatars.yandex.net/...%%`); the page prefixes `https://`. */
const COVER_URI_PREFIX = "avatars.yandex.net/";

function trimCover(cover) {
  if (typeof cover !== "object" || cover === null) return null;
  const out = {};
  if (typeof cover.type === "string") out.type = cover.type;
  if (Array.isArray(cover.itemsUri)) {
    out.itemsUri = cover.itemsUri
      .filter((uri) => typeof uri === "string" && uri.startsWith(COVER_URI_PREFIX))
      .slice(0, 4);
  }
  return out;
}

/**
 * The playlists.json privacy boundary. Keeps the API's `{ result: [...] }`
 * shape so lib/yandex-music.ts normalizes it unchanged, but only public
 * playlists and only PLAYLIST_KEYS (cover: `type`, and `itemsUri` limited
 * to avatars.yandex.net), each copied only when it has the expected type.
 * Drops the `owner` block and every other key. `null` = not a playlist
 * response at all (the runner then keeps the last published file);
 * `{ result: [] }` = no public playlists.
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

// assertPublishable's own lists, deliberately not PRESENCE_KEYS / PLAYLIST_KEYS:
// widening an allowlist constant must not silently pass this check too.
const PUBLISHABLE_PRESENCE_KEYS = [
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
];
const PUBLISHABLE_PLAYLIST_KEYS = [
  "playlistUuid",
  "title",
  "visibility",
  "trackCount",
  "durationMs",
  "modified",
  "cover",
];
const PUBLISHABLE_COVER_KEYS = ["type", "itemsUri"];

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isLeaf(value) {
  return value === null || typeof value === "string" || typeof value === "number";
}

function hasOnlyKeys(obj, allowed) {
  return Object.keys(obj).every((key) => allowed.includes(key));
}

function notPublishable(check) {
  // Names the failed check only — never a key or a value: this goes to run.log.
  return new Error(`not publishable: ${check}`);
}

/**
 * The last gate before anything leaves the machine: run.mjs calls it on
 * exactly what it is about to write (parsed back from the text), in both
 * the publish and --dry-run paths. `playlists` is null when this run
 * publishes no new playlists.json. Throws on the first failed check.
 */
export function assertPublishable({ presence, playlists }) {
  if (!isPlainObject(presence)) throw notPublishable("presence.json is not an object");
  if (
    Object.keys(presence).length !== PUBLISHABLE_PRESENCE_KEYS.length ||
    !hasOnlyKeys(presence, PUBLISHABLE_PRESENCE_KEYS)
  ) {
    throw notPublishable("presence.json keys are not exactly the ten allowed");
  }
  if (!Object.values(presence).every(isLeaf)) {
    throw notPublishable("presence.json has a value that is not a string, number or null");
  }

  if (playlists === null || playlists === undefined) return;
  if (
    !isPlainObject(playlists) ||
    Object.keys(playlists).length !== 1 ||
    !Array.isArray(playlists.result)
  ) {
    throw notPublishable("playlists.json is not exactly { result: [...] }");
  }
  for (const item of playlists.result) {
    if (!isPlainObject(item)) throw notPublishable("playlists.json has an item that is not an object");
    if (!hasOnlyKeys(item, PUBLISHABLE_PLAYLIST_KEYS)) {
      throw notPublishable("playlists.json has an item key outside the allowlist");
    }
    for (const [key, value] of Object.entries(item)) {
      if (key !== "cover" && !isLeaf(value)) {
        throw notPublishable(
          "playlists.json has an item value that is not a string, number or null",
        );
      }
    }
    const { cover } = item;
    if (cover === undefined || cover === null) continue;
    if (!isPlainObject(cover)) throw notPublishable("playlists.json has a cover that is not an object");
    if (!hasOnlyKeys(cover, PUBLISHABLE_COVER_KEYS)) {
      throw notPublishable("playlists.json has a cover key outside the allowlist");
    }
    if (!isLeaf(cover.type ?? null)) {
      throw notPublishable("playlists.json has a cover type that is not a string, number or null");
    }
    if (
      cover.itemsUri !== undefined &&
      !(Array.isArray(cover.itemsUri) && cover.itemsUri.every(isLeaf))
    ) {
      throw notPublishable("playlists.json has a cover itemsUri that is not a flat list");
    }
  }
}
