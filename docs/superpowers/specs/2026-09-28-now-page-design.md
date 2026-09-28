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

> **Revision (2026-09-28, same day): Plan B adopted.** The GitHub Actions
> probe got `451 Unavailable For Legal Reasons` from
> `api.music.yandex.net` (run 36386492821), so playlists can't be fetched
> at build time. The local presence runner now also fetches them from
> Artem's machine and publishes a trimmed `playlists.json` next to
> `presence.json` on `presence-data`; the page reads it client-side. The
> build-time fetch and the daily scheduled rebuild are dropped. This
> document describes the revised design throughout.

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
- A local Node presence collector (`scripts/presence/`) run by Windows Task
  Scheduler, publishing `presence.json` and a trimmed Yandex Music
  `playlists.json` to a new orphan branch `presence-data`.
- A client Music block reading `playlists.json` (`components/NowMusic.tsx`,
  normalized by `lib/yandex-music.ts`).
- A client widget reading `presence.json` (`lib/claude-presence.ts`,
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
  **403** — the browser cannot call this API.
- From a GitHub Actions runner (US IP) the same request returns **451
  Unavailable For Legal Reasons** (run 36386492821, host
  `music-web-default-production-music-98.vla.yp-c.yandex.net`) — the build
  cannot call it either. Only Artem's machine can, which is why the
  presence runner fetches playlists.
- `https://music.yandex.ru/iframe/playlists/<uuid>` returns 200 with no
  `X-Frame-Options` — frameable from the site. It has no dark theme; full
  tracks play only for visitors logged into Yandex with Plus (previews
  otherwise). Autoplay without a gesture is blocked by browsers anyway.
- From a runner (US IP) the iframe page, the playlist page and a
  `avatars.yandex.net` cover all return **200** (run 36387764861): covers
  and the player shell load abroad. Whether the player then actually plays
  for a visitor outside Yandex Music's regions is unknown — it loads track
  data from the visitor's browser, from backends that answered the runner
  451. **Known limitation, not handled:** a cross-origin iframe's failure
  can't be detected from the page.
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

## Music (client-side, from `presence-data`)

Neither the browser (403) nor the Actions build (451) can call the Yandex
API, so the presence runner fetches playlists from Artem's machine and
publishes a trimmed `playlists.json` to `presence-data` (see "Runner"
below). The page reads it client-side from
`https://raw.githubusercontent.com/hpnssflw/hpnssflw.github.io/presence-data/playlists.json`.
The site never calls Yandex's API itself, at build time or in the browser.

`lib/yandex-music.ts` (pure, tested):

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

export function normalizePlaylists(json: unknown): Playlist[];
```

- `normalizePlaylists` accepts the Yandex response shape `{ result: [...] }`
  — the runner's trimmed file keeps that shape, so the normalizer doesn't
  care which of the two it gets. It keeps only `visibility === "public"`,
  sorts by `modified` descending, builds cover URLs as `https://` +
  `itemsUri[i]` with every `%%` → `200x200` (only URIs starting
  `avatars.yandex.net/`, first 4 only; missing/non-mosaic cover → `[]`),
  and skips any item missing `playlistUuid` or `title`, or
  whose `playlistUuid` isn't UUID-shaped (it's interpolated into an iframe
  `src`). The file comes from a public branch, so the client still treats
  it as untrusted input.

`lib/now-config.ts` holds the page's constants in one place:
`YANDEX_MUSIC_FALLBACK_URL` (the "siick vibin" playlist page — the new
Yandex Music UI has no public profile page: `/users/<login>`,
`/users/<login>/playlists` and `/profile/<uid>` all 404 as of
2026-09-28), `PLAYLISTS_URL`, `PRESENCE_URL`,
`PRESENCE_STALE_MS = 20 * 60_000`, `PRESENCE_POLL_MS = 5 * 60_000`. The
Yandex login and API URL live in the runner, not the site.

Rendering:

- `components/NowMusic.tsx` (client) fetches `PLAYLISTS_URL` once on
  mount — no polling; playlists change every few days — and runs it
  through `normalizePlaylists`:

  | Condition | Shows |
  |---|---|
  | loading | `…` |
  | fetch/parse failed, or 0 playlists | `yandex music ↗` → `YANDEX_MUSIC_FALLBACK_URL` |
  | playlists | `<PlaylistList>` |

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
- With playlists present there's no extra link — each card title links to
  its own playlist page.

Freshness: as fresh as the runner's last push (it pushes whenever the
trimmed list changes) plus raw.githubusercontent's ~5-minute cache. The
file persists on `presence-data` while the machine is off, so the block
keeps showing the last known playlists. `deploy.yml` is not changed —
nothing is baked in at build time.

**Superseded:** the original design fetched playlists during `next build`
and added a daily scheduled rebuild. The runner probe (451) ruled that
out; see the revision note at the top.

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
  most recent assistant message today in a main (non-subagent) session.
  Subagent transcripts (`<session>/subagents/*.jsonl`) still count as
  activity and toward sessions, but their model is ignored.
- `day`: owner's local date `YYYY-MM-DD`; `tz`: IANA zone from
  `Intl.DateTimeFormat().resolvedOptions().timeZone` on the machine.
- All timestamps floored to the minute.
- **These ten keys are the complete allowlist.** Nothing else — no `cwd`,
  project dir, `name`, `sessionId`, `gitBranch`, prompt/response text,
  AI title, pid, OS username — may ever appear.

### Data contract — `playlists.json`

Same branch, file `playlists.json` at the root. A trimmed copy of
`GET https://api.music.yandex.net/users/tmkplzv/playlists/list`, keeping
the response's `{ result: [...] }` shape so `normalizePlaylists` reads it
unchanged:

```json
{
  "result": [
    {
      "playlistUuid": "f5db5527-5d0e-50fa-9f52-ee32cf758900",
      "title": "siick vibin on a daily basis",
      "visibility": "public",
      "trackCount": 265,
      "durationMs": 48357650,
      "modified": "2026-09-28T05:06:23+00:00",
      "cover": {
        "type": "mosaic",
        "itemsUri": ["avatars.yandex.net/get-music-content/97284/666ef04f.a.5907678-1/%%"]
      }
    }
  ]
}
```

- **Allowlist:** top level `result` only; per item only the seven keys
  above; `cover` only `type` and `itemsUri` (only URIs starting
  `avatars.yandex.net/`). Everything else in the real
  response — the `owner` block (uid, login, display name, `sex`), `kind`,
  `revision`, colors, tags, likes — is dropped. Only public playlists are
  kept.

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
- `trimPlaylists(json)`: the `playlists.json` privacy boundary. Returns
  `{ result: [...] }` built key by key (never by spreading an input) from
  public items only, with exactly the allowlisted keys; returns `null` for
  anything without a `result` array, so the runner can tell "Yandex sent
  garbage" from "Artem has no public playlists" (`{ result: [] }`).

### Runner — `scripts/presence/run.mjs` (I/O shell)

1. Run `claude agents --json --all` through a shell (`exec`, 20s timeout
   — on this machine `claude` is an npm `claude.cmd` shim, which Node
   refuses to spawn without a shell). On failure,
   continue with `agents = []` (state can then be at most `waiting`).
2. List `~/.claude/projects/**/*.jsonl` with mtime within the owner's
   current local day; stream each line-by-line, `JSON.parse` each line,
   and extract **only** `timestamp`, `sessionId`, and `message?.model`
   into a local array (model left `null` for files under a `subagents`
   directory). Bad lines are skipped.
3. Compute presence via `collect.mjs`.
4. Fetch `https://api.music.yandex.net/users/tmkplzv/playlists/list`
   (no token, 10s timeout) and run it through `trimPlaylists`. Any failure
   — network, non-200, bad JSON, `null` from `trimPlaylists` — is an
   expected error: log it and leave the clone's existing `playlists.json`
   untouched. A Yandex hiccup never publishes an empty list.
5. Publish (below). **Skip the push** only if both hold: the new `state`
   is `offline` and the last published `state` (read from the local
   clone's `presence.json`) is also `offline` — one "offline" push, then
   silence; the page's staleness check covers the rest — **and** the new
   `playlists.json` text is byte-identical to the clone's current file
   (or step 4 failed) — **and** the clone holds no unpushed commit (its
   `HEAD` equals `refs/remotes/origin/presence-data`, which a successful
   push moves), since both comparisons read that clone.
6. Log one line per run to `%LOCALAPPDATA%\polozov-presence\run.log`,
   truncated to the last 500 lines. Any unexpected error: log it, publish
   nothing, exit non-zero.

Publishing uses a dedicated local clone at
`%LOCALAPPDATA%\polozov-presence\repo` — **never the working tree at
`C:\A\polozov`**. First run: `git init`, orphan commit. A fresh clone
first seeds `playlists.json` from the published branch (`git fetch
--depth=1 origin presence-data`; a missing branch is fine), so a run
whose Yandex fetch failed never publishes a branch that drops it.
Every published run: remove a `.git/index.lock` older than 10 minutes
(left by a killed run), add `origin`
(`https://github.com/hpnssflw/hpnssflw.github.io.git`) if missing or
`set-url` it, write `presence.json` (and `playlists.json` when
step 4 succeeded), `git add`, `git commit --amend` (first run: plain
commit), `git push --force origin HEAD:refs/heads/presence-data`
(retried once). The branch is always one commit. Right before writing
(and before printing in `--dry-run`), `assertPublishable` re-checks the
outgoing text against its own literal copy of both allowlists; on
failure it logs which check failed and publishes nothing. Auth is
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
| Yandex API down / garbage, seen by the runner | logged locally; last published `playlists.json` stays; page unaffected |
| `playlists.json` missing / malformed / network error | Music shows `yandex music ↗` |
| Player can't play for a visitor outside Yandex Music's regions | not detectable from the page; known limitation |
| `presence.json` missing / malformed / network error | `status unavailable` |
| Collector hasn't pushed in > 20 min | `offline` regardless of file contents |
| `claude agents` fails locally | transcripts only; never `working` |
| Push fails | retried once, then logged; the next run publishes again; page goes `offline` after 20 min |

## Testing

Vitest; `vitest.config.mjs` `include` extends to
`["lib/**/*.test.ts", "scripts/**/*.test.mjs"]`.

- `lib/yandex-music.test.ts` — against a trimmed fixture from the real
  2026-09-28 response: public filter, `modified` sort, cover URL build
  (every `%%` → `200x200`, `https://` prefix, max 4, non-`avatars.yandex.net/`
  URIs skipped), missing cover → `[]`,
  items without a UUID-shaped `playlistUuid` or a title skipped, garbage
  input → `[]`. (No fetch tests — the site no longer fetches Yandex.)
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
  **`trimPlaylists` leak test:** feed the real response shape, including
  its `owner` block and extra keys, plus a private playlist; assert the
  output's key sets are exactly the allowlist at every level, the owner's
  uid/name and the private playlist's title appear nowhere in its JSON,
  and garbage input → `null` while `{ result: [] }` → `{ result: [] }`.

## Verification (before calling it done)

1. **Actions probe — done 2026-09-28: 451**, so Plan B (this design).
   A second probe confirmed covers and the player shell load from a US IP.
2. One manual `node scripts/presence/run.mjs`; inspect `presence-data`
   on GitHub by eye — `presence.json` has exactly the ten keys;
   `playlists.json` has only the allowlisted keys, no `owner` block, and
   Artem's three public playlists.
3. `npm test` green; `npm run build` + `npm run serve`; `/now/` checked
   at 375px and desktop width — Music loads the real playlists from
   `presence-data`, one player opens at a time; header and homepage links
   work; the widget shows the real state.
4. `install.ps1`; after ~10 minutes `updatedAt` has advanced; no console
   window flashed.

## Docs to update when shipping

- `PROGRESS.md` — new "Now page" section (status, what shipped, the
  presence-data branch and its two files) and its "How to resume" entry.
- `CLAUDE.md` — the `npm test` line lists `lib/yandex-music`,
  `lib/claude-presence`, `lib/now-format`, `scripts/presence`; mention that
  `presence-data` (presence and playlists) is written from Artem's
  machine, not by Actions.
- Nothing in `agent/`, `agent-run.yml`, or `agent-data` changes.
