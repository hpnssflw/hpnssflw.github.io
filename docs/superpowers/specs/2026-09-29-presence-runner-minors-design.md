# Presence Runner Minors — Design

Three Minor follow-ups parked by the `/now/` final whole-plan review
(`PROGRESS.md`, "Now page"), fixed in one small wave. Nothing on the page
changes; this is `scripts/presence/` only. The runner and its publishing
rules are described in `docs/superpowers/specs/2026-09-28-now-page-design.md`
("Runner" and the paragraph after its numbered steps).

## Scope

In scope:

1. `ensureRemote` writes `.git/config` on every publish.
2. One `assertPublishable` test can't fail.
3. `readPrevious*` read the clone's working tree instead of its `HEAD`.

Out of scope: the overlapping-run race seen in `run.log` on 2026-09-28 at
16:03 (a run started before sleep and a new one collided after wake —
`index.lock` exists, `cannot lock ref 'HEAD'`). Git refused safely and
the next run published within 20 s; it is recorded in `PROGRESS.md` as an
observed, self-healing condition next to the Yandex timeouts and
`getaddrinfo` push failures. No run-level lock is added.

## 1. `ensureRemote` — write config only when it's wrong

Today every publish runs `git remote set-url origin …` (or `remote add`),
which takes `.git/config.lock`. A run killed at that moment leaves the
lock behind and every later run fails on it.

- Read the raw URL with `git config --get remote.origin.url`. Not
  `git remote get-url`: that expands `url.*.insteadOf` from global config,
  so on a machine with a rewrite rule it would never equal `REMOTE` and
  would still write every run.
- Same URL → no git write. Exit code 1 (key missing) → `remote add origin
  REMOTE`. Different URL → `remote set-url origin REMOTE`. Any other
  failure throws, as today.
- `clearStaleIndexLock` becomes `clearStaleLocks`: the same 10-minute rule
  and log line, applied to both `.git/index.lock` and `.git/config.lock`.
  After the change the only config writes left are the first run and a
  wrong URL — exactly the cases a lock left by a killed `remote add` would
  block.

## 2. The `assertPublishable` message test

`collect.test.mjs`, "never puts a key or value into its message", calls
`expect.unreachable()` inside the `try`. If `assertPublishable` stopped
throwing, `unreachable`'s own error is caught, its message doesn't
contain `secret`, and the test passes.

Fix: catch into a variable outside the `try`, then assert it is an
`Error` whose message matches `/presence\.json keys/` and does not
contain `secret`. A test-only change; `collect.mjs` is untouched.

## 3. Previous state from `HEAD`, not the working tree

`readPrevious()` and `readPreviousPlaylistsText()` read `presence.json` /
`playlists.json` from the clone's working tree. A run that fails between
`writeFileSync` and `git commit` leaves the tree ahead of `HEAD`; the next
run then compares against content that was never published — an
offline→offline run can skip while the branch still says `working`, and a
playlists change can be treated as already published.

- One helper, `readCommitted(file)`: `git show HEAD:<file>` in the clone,
  returning the text or `null`. It returns `null` without calling git when
  `REPO/.git` doesn't exist (so git never walks up to a parent
  repository), and on any git failure (no `HEAD` yet, file absent from the
  commit).
- `readPrevious` parses `readCommitted("presence.json")`;
  `readPreviousPlaylistsText` returns `readCommitted("playlists.json")`.
  Both become async; `main` awaits them. `--dry-run` reads the same way
  (read-only).
- `git show` prints the blob as stored (no eol filters), and the blob is
  the `\n`-terminated text the runner wrote, so the byte comparison with
  `playlistsText` stays exact.
- Why `HEAD` is the right baseline: either `HEAD` equals
  `refs/remotes/origin/presence-data` (it is what's published) or it
  doesn't, and `hasUnpushedCommit` already forces a publish.

## Verification

- `npm test` — full suite green.
- Mutation check for #2: with `assertPublishable`'s body temporarily
  replaced by `return;`, the rewritten test fails; restored afterwards,
  `git diff scripts/presence/collect.mjs` is empty.
- `node scripts/presence/run.mjs --dry-run` against the real clone: exit
  0, output shape unchanged.
- Replica scenarios in the session scratchpad, never against GitHub: a
  copy of `run.mjs` + `collect.mjs` with `REMOTE` → a local bare
  repository, `PROJECTS` → an empty directory, the `claude agents`
  command → `echo []` (so the state is `offline`), `PLAYLISTS_API` →
  `https://127.0.0.1:9/…` (Yandex down), run with `LOCALAPPDATA` → a
  scratch directory. Each scenario runs on the old code first (to show the
  defect) and then the new:
  - **R1** — a fresh `.git/config.lock` with the correct origin: old run
    fails on the lock; new run publishes.
  - **R2** — a `.git/config.lock` older than 10 minutes and no origin:
    new run removes the lock, adds origin, publishes.
  - **R3** — `HEAD`'s `presence.json` says `working`, the working tree's
    says `offline`: old run logs `skip`; new run publishes `offline`.
  - **R4** — a steady-state run leaves `.git/config`'s mtime unchanged.
- After the commits, Artem re-runs `install.ps1`; the next `run.log` line
  is a `published …` or `skip: …` line, not an error.

## Docs

- `2026-09-28-now-page-design.md`: step 5 says the last published state
  is read from the clone's `HEAD` commit; the "Every published run"
  sentence says stale `index.lock`/`config.lock` are removed and `origin`
  is written only when missing or different.
- `PROGRESS.md`, "Now page": drop the parked-Minors sentence, note the
  fix, add the 16:03 overlapping-run observation.
- `CLAUDE.md`: no change.
