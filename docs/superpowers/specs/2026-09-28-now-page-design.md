# Now Page — Design

A new `/now/` page on the site: a mobile-first, single-column page of
widgets showing what Artem is doing right now — his Yandex Music playlists
(with an inline player) and whether he's in Claude Code at the moment, plus
how long he's been in it today. Yandex Games gets a placeholder.

This is Phase 1 of a larger idea researched on 2026-09-28 (report:
`reports/Интеграции Яндекс и Claude Code.md`, notes in
`research_notes/Интеграции Яндекс и Claude Code/`): a presence service
where you can add people, see their playlists / now-playing / Claude Code
uptime, send 24h-ephemeral pager messages, and eventually ship as a Chrome
extension. Everything past Phase 1 needs a backend and has open legal
(ОРИ / 149-ФЗ, 152-ФЗ, foreign-login ban) and reachability-from-Russia
decisions — see the report's "Фазы 2–4" section. **None of that is in
scope here.** Phase 1 is deliberately backend-free and runs on the static
export exactly as the site does today.

## Goal

A public page that is honest about what it shows and never leaks private
data:

- **Music** — Artem's public Yandex Music playlists as cards; tapping one
  opens Yandex's official player inline.
- **Claude Code** — `working` / `waiting` / `offline`, how long the current
  stretch has lasted, active time today, sessions today, model family.
- **Games** — an "upcoming" placeholder card, no data.

## Scope

In scope:

- `app/now/page.tsx` route, header nav item, homepage link.
- Build-time Yandex Music fetch (`lib/yandex-music.ts`) + a daily scheduled
  rebuild in `.github/workflows/deploy.yml`.
- A local Node presence collector (`scripts/presence/`) run by Windows Task
  Scheduler, publishing `presence.json` to a new orphan branch
  `presence-data`.
- A client widget reading that file (`lib/claude-presence.ts`,
  `components/ClaudePresence.tsx`), plus shared formatters
  (`lib/now-format.ts`).
- Styles in `app/globals.css`, tests in Vitest.

Out of scope (later phases, each its own spec):

- "Last played / now playing" track (Last.fm or Ynison) — needs either a
  scrobbler setup or a Yandex token on a server.
- Any backend, login ("Sign in with Yandex ID" is only useful once there's
  a backend to store who logged in — Phase 2), friends, pager messages,
  Chrome extension.
- Claude Code cloud sessions (claude.ai/code on the web) — they don't run
  local hooks or the local collector; covering them needs a committed repo
  hook + network allowlist (see report).
- Claude Code hooks as a real-time source — useful once a backend with TTL
  exists; with a git-branch transport, a 5-minute poll is simpler and just
  as fresh.
- Project names in the Claude Code widget (decided: never shown).
- Real Yandex Games data — there is no API for a player's activity and
  games cannot be framed on third-party sites (verified 2026-09-28:
  `X-Frame-Options: DENY` / `SAMEORIGIN` + CSP `frame-ancestors`).

## Verified facts this design relies on (2026-09-28)

- Artem's Yandex Music login is `tmkplzv` (uid `1659591274`); the profile
  is public. `GET https://api.music.yandex.net/users/tmkplzv/playlists/list`
  with **no token** returns 200 with 3 public playlists ("love", "siick
  vibin on a daily basis", "technical 🔻"). Each item has `playlistUuid`,
  `title`, `trackCount`, `durationMs`, `modified`, `visibility`, and
  `cover: { type: "mosaic", itemsUri: [...] }` where each URI is
  `avatars.yandex.net/...%%` (`%%` = size placeholder, e.g. `200x200`).
- The same request with `Origin: https://hpnssflw.github.io` returns
  **403** — the browser cannot call this API, so it must run at build time.
- `https://music.yandex.ru/iframe/playlists/<uuid>` returns 200 with no
  `X-Frame-Options` — frameable from the site. It has no dark theme; full
  tracks play only for visitors logged into Yandex with Plus (previews
  otherwise). Autoplay without a gesture is blocked by browsers anyway.
- **Not yet verified:** whether Yandex answers GitHub Actions runner IPs
  with 200. First implementation step is a probe (see Verification).
- `claude agents --json --all` (Claude Code ≥ 2.1.169) returns an array of
  `{ pid, cwd, kind, startedAt, sessionId, name, status }` with
  `status: "idle" | "busy"`. Sessions left open for days report `idle` —
  an open session is **not** presence on its own.
- Transcript lines in `~/.claude/projects/<dir>/<session>.jsonl` carry an
  ISO `timestamp`, `sessionId`, and (on `type: "assistant"`)
  `message.model` (e.g. `claude-opus-5-5`). They also carry `cwd`,
  `gitBranch`, prompt/response text, and AI titles — **and the project
  directory names themselves expose client project names.** Only
  `timestamp`, `sessionId`, and `message.model` may ever be read into the
  collector's data model.
- Local Node is v20.18 — no TypeScript stripping, so the collector is
  plain `.mjs`.

## Page

Route `app/now/page.tsx` (server component, statically rendered), page
title "Now". Single column at every width, `--measure` (640px) wide,
spacing on existing tokens. English copy, following the case system
(UPPERCASE labels, lowercase content). Block order is most-live first:

```
NOW

CLAUDE CODE
● working · for 1h 20m
today 3h 40m · 4 sessions
opus · updated 4 min ago

MUSIC
[2×2 mosaic] siick vibin on a daily basis
             265 tracks · 13h 26m
             ▸ play            ← tap mounts the Yandex iframe below
[2×2 mosaic] technical 🔻 · 93 tracks · 9h 38m
[2×2 mosaic] love · 84 tracks · 5h 57m
open profile ↗

GAMES
upcoming — yandex games, once there's something worth showing
```

Navigation:

- `components/SiteHeader.tsx` gets a `Now` link (with `aria-current` on
  `/now/`), after `Lab` and `Researcher`.
- The homepage has no header, so the hero's contact line
  (`app/page.tsx`) gets a `now →` link.

Styles: a new "Now page" section in `app/globals.css`. Status dots reuse
the agent widget's palette tokens — `--agent-lime` for `working` (●) and
`waiting` (◐, same hue, different glyph), `--muted` for `offline` (○). No
new colors: offline is a normal state, not an error, so it is never red.

## Music (build time)

`lib/yandex-music.ts`:

```ts
export interface Playlist {
  uuid: string;
  title: string;
  trackCount: number;
  durationMs: number;
  modified: string;      // ISO, from the API
  coverTiles: string[];  // 0–4 absolute https URLs, 200x200
  url: string;           // https://music.yandex.ru/playlists/<uuid>
  embedUrl: string;      // https://music.yandex.ru/iframe/playlists/<uuid>
}

export function normalizePlaylists(json: unknown): Playlist[];      // pure
export async function fetchPlaylists(login: string): Promise<Playlist[] | null>;
```

- `normalizePlaylists` keeps only `visibility === "public"`, sorts by
  `modified` descending, builds cover URLs as `https://` + `itemsUri[i]`
  with `%%` → `200x200` (first 4 only; missing/non-mosaic cover → `[]`),
  and skips any item missing `playlistUuid` or `title`.
- `fetchPlaylists` does one `fetch` with a 10s timeout
  (`AbortSignal.timeout`). Any failure — network, non-200, bad JSON,
  normalizer throws — returns `null` and `console.warn`s a single line
  into the build log. **The build must never fail because of Yandex**;
  otherwise Yandex being down would block LAB deploys.
- Before writing this, read the static-export/data-fetching guide in
  `node_modules/next/dist/docs/` (per `CLAUDE.md`): the fetch must run at
  build time and be baked into the HTML, not deferred to the client.

`lib/now-config.ts` holds the page's constants in one place:
`YANDEX_MUSIC_LOGIN = "tmkplzv"`, `YANDEX_MUSIC_PROFILE_URL`,
`PRESENCE_URL`, `PRESENCE_STALE_MS = 15 * 60_000`,
`PRESENCE_POLL_MS = 5 * 60_000`.

Rendering:

- `components/PlaylistList.tsx` (client) owns `openUuid: string | null` —
  at most one player open at a time; opening another closes the first.
- `components/PlaylistCard.tsx` renders the mosaic (plain `<img>`,
  `loading="lazy"`, `alt=""` — decorative, the title is text), title,
  `N tracks · Xh Ym`, a `▸ play` / `▾ close` button
  (`aria-expanded`), and, only when open, `<iframe src={embedUrl}
  title="Yandex Music player: <title>" loading="lazy"
  allow="autoplay; encrypted-media" width="100%">`. The iframe is never
  mounted until tapped — no white blocks on first paint, no three iframes
  on mobile.
- If `fetchPlaylists` returned `null` (or `[]`), the Music block renders
  just `open profile ↗` linking to the profile.

Freshness: `deploy.yml` gains `schedule: - cron: "0 3 * * *"` (06:00 MSK
daily) alongside its existing `push`/`workflow_dispatch` triggers.
Playlists change every few days; daily is enough.

**Plan B (documented, not built):** if the Actions probe shows Yandex
blocks runner IPs, replace the build-time fetch with a committed snapshot
`content/now/playlists.json`, refreshed from Artem's machine (by hand, or
by extending the presence collector) and read at build time through the
same `normalizePlaylists`.

## Games

A static card: label `GAMES`, one line `upcoming — yandex games, once
there's something worth showing`. No data, no config, no links.

## Claude Code presence

### Data contract — `presence.json` v1

Published to branch `presence-data`, file `presence.json` at the root,
read from
`https://raw.githubusercontent.com/hpnssflw/hpnssflw.github.io/presence-data/presence.json`.

```json
{
  "v": 1,
  "state": "working",
  "since": "2026-09-28T06:10:00.000Z",
  "lastActive": "2026-09-28T07:29:00.000Z",
  "todayMinutes": 220,
  "sessionsToday": 4,
  "model": "opus",
  "day": "2026-09-28",
  "tz": "Europe/Moscow",
  "updatedAt": "2026-09-28T07:30:00.000Z"
}
```

- `state`: `"working" | "waiting" | "offline"`.
- `since`: start of the current activity stretch; `null` when `offline`.
- `lastActive`: last transcript activity (any time); `null` if none today
  and none known.
- `todayMinutes`, `sessionsToday`: integers ≥ 0, for the owner's local
  `day`.
- `model`: `"opus" | "sonnet" | "haiku" | "fable" | null` — family of the
  most recent assistant message today.
- `day`: owner's local date `YYYY-MM-DD`; `tz`: IANA zone from
  `Intl.DateTimeFormat().resolvedOptions().timeZone` on the machine.
- All timestamps floored to the minute.
- **These ten keys are the complete allowlist.** Nothing else — no `cwd`,
  project dir, `name`, `sessionId`, `gitBranch`, prompt/response text,
  AI title, pid, OS username — may ever appear.

### Collector — `scripts/presence/collect.mjs` (pure, tested)

No I/O; all inputs passed in, `now` injected.

- `deriveState({ agents, lastActiveMs, nowMs })`:
  - `working` if any agent has `status === "busy"`;
  - else `waiting` if `nowMs - lastActiveMs <= 15 min`;
  - else `offline`. (An `idle` session open for days is `offline`.)
- `mergeActivity(timestampsMs, { gapMs = 15 min, dayStartMs })`:
  sort, clip to `>= dayStartMs`, merge consecutive events whose gap is
  `<= gapMs` into intervals; returns the intervals. `todayMinutes` =
  floor(sum of `(end − start)`) in minutes (a lone event contributes 0).
  `since` = start of the last interval today whenever `state` is not
  `offline`, else `null`. (A `working` state with no activity today — e.g.
  one long command running past midnight — also yields `null`; the widget
  then omits "for …".)
- `modelFamily(modelId)`: substring match on `opus` / `sonnet` / `haiku`
  / `fable`, else `null`.
- `buildPresence({...})` assembles the object from explicit fields only
  (never by spreading an input), floors timestamps to the minute, and
  returns exactly the ten allowlisted keys.

### Runner — `scripts/presence/run.mjs` (I/O shell)

1. Run `claude agents --json --all` (`execFile`, 20s timeout). On failure,
   continue with `agents = []` (state can then be at most `waiting`).
2. List `~/.claude/projects/**/*.jsonl` with mtime within the owner's
   current local day; stream each line-by-line, `JSON.parse` each line,
   and extract **only** `timestamp`, `sessionId`, and `message?.model`
   into a local array. Bad lines are skipped.
3. Compute presence via `collect.mjs`.
4. Publish (below). **Skip the push** if the new `state` is `offline` and
   the last published `state` (read from the local clone's
   `presence.json`) is also `offline` — one "offline" push, then silence;
   the page's staleness check covers the rest.
5. Log one line per run to `%LOCALAPPDATA%\polozov-presence\run.log`,
   truncated to the last 500 lines. Any unexpected error: log it, publish
   nothing, exit non-zero.

Publishing uses a dedicated local clone at
`%LOCALAPPDATA%\polozov-presence\repo` — **never the working tree at
`C:\A\polozov`**. First run: `git init`, add `origin`
(`https://github.com/hpnssflw/hpnssflw.github.io.git`), orphan commit.
Every run: write `presence.json`, `git add`, `git commit --amend`
(first run: plain commit), `git push --force origin
HEAD:refs/heads/presence-data`. The branch is always one commit. Auth is
the machine's existing Git Credential Manager. Pushing this branch
triggers neither `deploy.yml` (main only) nor `agent-run.yml`
(cron/dispatch only).

### Scheduling — `scripts/presence/install.ps1` / `uninstall.ps1`

`install.ps1` registers a Task Scheduler task `polozov-presence` running
`run.mjs` every 5 minutes for the current user, **without flashing a
console window** (the exact launcher — e.g. `conhost --headless` or a
tiny `.vbs` shim — is a plan-level choice). `uninstall.ps1` removes it.
Presence only exists while the machine is on and awake; that is correct
behavior, not a bug.

### Widget — `lib/claude-presence.ts` + `components/ClaudePresence.tsx`

`lib/claude-presence.ts` (pure, tested):

- `parsePresence(json): Presence | null` — validates v1 shape and types;
  anything off → `null`.
- `effectiveState(p, nowMs)` — `offline` if `nowMs − updatedAt >
  PRESENCE_STALE_MS`, else `p.state`. Stale data never shows as live.
- `isOwnerToday(day, tz, nowMs)` — true iff the owner's current local
  date in `tz` equals `day`.

`lib/now-format.ts` (pure, tested; shared by the widget and the playlist
cards): `formatDuration(ms)` → `"13h 26m"` / `"45m"` (rounded to the
nearest minute); `formatAgo(ms)` → `"4 min ago"` / `"2h ago"`.

`components/ClaudePresence.tsx` (client): fetch on mount, then every
`PRESENCE_POLL_MS` while `document.visibilityState === "visible"`
(raw.githubusercontent caches ~5 min, so polling faster buys nothing).
Rendering:

| Condition | Shows |
|---|---|
| loading | `…` |
| fetch/parse failed | `status unavailable` |
| `offline` | `○ offline · last active 2h ago` (or just `○ offline`) |
| `waiting` | `◐ waiting · for 1h 20m` |
| `working` | `● working · for 1h 20m` |

Second line `today 3h 40m · 4 sessions` only when `isOwnerToday`; third
line `opus · updated 4 min ago` (model omitted when `null`). The stretch
is shown as a duration ("for 1h 20m"), not a clock time, so viewers in
other time zones aren't misled.

## Error handling summary

| Failure | Result |
|---|---|
| Yandex API down / blocked at build | Music shows `open profile ↗`; build succeeds; warning in log |
| `presence.json` missing / malformed / network error | `status unavailable` |
| Collector hasn't pushed in > 15 min | `offline` regardless of file contents |
| `claude agents` fails locally | transcripts only; never `working` |
| Push fails | logged locally; page goes `offline` after 15 min |

## Testing

Vitest; `vitest.config.mjs` `include` extends to
`["lib/**/*.test.ts", "scripts/**/*.test.mjs"]`.

- `lib/yandex-music.test.ts` — against a trimmed fixture from the real
  2026-09-28 response: public filter, `modified` sort, cover URL build
  (`%%` → `200x200`, `https://` prefix, max 4), missing cover → `[]`,
  items without `playlistUuid` skipped, garbage input → `[]`.
- `lib/claude-presence.test.ts` — `parsePresence` accepts v1 / rejects
  wrong types and versions; `effectiveState` flips to `offline` past the
  threshold; `isOwnerToday` across a midnight boundary in two zones.
- `lib/now-format.test.ts` — `formatDuration` rounding and hour/minute
  forms; `formatAgo` minute/hour forms.
- `scripts/presence/collect.test.mjs` — `deriveState` (busy → working,
  idle + recent → waiting, idle + old → offline, no agents),
  `mergeActivity` (gap merge, gap split, day-start clipping, lone event =
  0), `modelFamily`. **Leak test:** feed inputs poisoned with `cwd`,
  project-dir names, `name`, prompt text, `gitBranch`, `sessionId`; assert
  none of those strings appear anywhere in `JSON.stringify(buildPresence(...))`
  and that its key set equals the ten-key allowlist exactly.

## Verification (before calling it done)

1. **Actions probe** — a one-off `workflow_dispatch` run (or a step in a
   throwaway branch workflow) that `curl`s the playlists endpoint from a
   runner and prints the status code. 200 → build-time fetch; otherwise
   switch to Plan B before building the Music block.
2. `npm test` green; `npm run build` + `npm run serve`; `/now/` checked
   at 375px and desktop width; one player opens at a time; header and
   homepage links work.
3. One manual `node scripts/presence/run.mjs`; inspect `presence-data`
   on GitHub by eye — exactly the ten keys, nothing else; the widget shows
   the real state.
4. `install.ps1`; after ~10 minutes `updatedAt` has advanced; no console
   window flashed.
5. After deploy, the scheduled daily rebuild appears in the Actions list.

## Docs to update when shipping

- `PROGRESS.md` — new "Now page" section (status, what shipped, the
  presence-data branch, Plan B status) and its "How to resume" entry.
- `CLAUDE.md` — the `npm test` line lists `lib/yandex-music`,
  `lib/claude-presence`, `lib/now-format`, `scripts/presence`; mention that
  `presence-data` is written from Artem's machine, not by Actions.
- Nothing in `agent/`, `agent-run.yml`, or `agent-data` changes.
