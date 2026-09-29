/** One public Yandex Music playlist, as the /now/ page renders it. */
export interface Playlist {
  uuid: string;
  title: string;
  trackCount: number;
  durationMs: number;
  /** ISO timestamp from the API; drives newest-first ordering. */
  modified: string;
  /** 0–4 absolute 200x200 cover URLs for the 2×2 mosaic. */
  coverTiles: string[];
  url: string;
  embedUrl: string;
}

const COVER_SIZE = "200x200";
/** Cover URIs are host-relative; only Yandex's image host becomes an <img src>. */
const COVER_URI_PREFIX = "avatars.yandex.net/";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function coverTiles(cover: unknown): string[] {
  if (typeof cover !== "object" || cover === null) return [];
  const c = cover as Record<string, unknown>;
  if (c.type !== "mosaic" || !Array.isArray(c.itemsUri)) return [];
  return c.itemsUri
    .filter((uri): uri is string => typeof uri === "string" && uri.startsWith(COVER_URI_PREFIX))
    .slice(0, 4)
    .map((uri) => `https://${uri.replaceAll("%%", COVER_SIZE)}`);
}

function time(iso: string): number {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : t;
}

/**
 * Shapes playlists.json — the trimmed copy of the unofficial
 * `GET /users/<login>/playlists/list` response that
 * scripts/presence/run.mjs publishes to the presence-data branch (same
 * `{ result: [...] }` shape). It comes from a public branch, so it's
 * treated as untrusted: public playlists only, newest-modified first, and
 * the uuid is checked against the UUID format because it's interpolated
 * into an iframe src.
 */
export function normalizePlaylists(json: unknown): Playlist[] {
  if (typeof json !== "object" || json === null) return [];
  const result = (json as Record<string, unknown>).result;
  if (!Array.isArray(result)) return [];

  const playlists: Playlist[] = [];
  for (const item of result) {
    if (typeof item !== "object" || item === null) continue;
    const p = item as Record<string, unknown>;
    if (p.visibility !== "public") continue;
    if (typeof p.playlistUuid !== "string" || !UUID_RE.test(p.playlistUuid)) continue;
    if (typeof p.title !== "string" || p.title === "") continue;
    playlists.push({
      uuid: p.playlistUuid,
      title: p.title,
      trackCount: typeof p.trackCount === "number" ? p.trackCount : 0,
      durationMs: typeof p.durationMs === "number" ? p.durationMs : 0,
      modified: typeof p.modified === "string" ? p.modified : "",
      coverTiles: coverTiles(p.cover),
      url: `https://music.yandex.ru/playlists/${p.playlistUuid}`,
      embedUrl: `https://music.yandex.ru/iframe/playlists/${p.playlistUuid}`,
    });
  }
  return playlists.sort((a, b) => time(b.modified) - time(a.modified));
}
