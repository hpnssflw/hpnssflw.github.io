/**
 * Constants for the /now/ page, kept in one place.
 * See docs/superpowers/specs/2026-09-28-now-page-design.md.
 *
 * The site never calls Yandex's API (it answers browsers 403 and GitHub's
 * runners 451); scripts/presence/run.mjs fetches playlists from Artem's
 * machine and publishes them next to presence.json.
 */

/**
 * Where the Music block links when playlists.json can't be loaded.
 * The new Yandex Music UI has no public profile page (/users/<login> and
 * /profile/<uid> 404 as of 2026-09-28), so this is the main playlist.
 */
export const YANDEX_MUSIC_FALLBACK_URL =
  "https://music.yandex.ru/playlists/f5db5527-5d0e-50fa-9f52-ee32cf758900";

/** Both written by scripts/presence/run.mjs from Artem's machine, not by Actions. */
export const PLAYLISTS_URL =
  "https://raw.githubusercontent.com/hpnssflw/hpnssflw.github.io/presence-data/playlists.json";

export const PRESENCE_URL =
  "https://raw.githubusercontent.com/hpnssflw/hpnssflw.github.io/presence-data/presence.json";

/** Older than this and the widget shows offline, whatever the file says. */
export const PRESENCE_STALE_MS = 20 * 60_000;

/** raw.githubusercontent caches ~5 min, so polling faster buys nothing. */
export const PRESENCE_POLL_MS = 5 * 60_000;
