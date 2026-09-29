# Presence Runner Minors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the three Minor follow-ups the `/now/` final review parked in the presence runner: a config write on every run, a test that can't fail, and a skip decision read from the working tree.

**Architecture:** Point edits in `scripts/presence/run.mjs` (the I/O shell: git, files, network) and one rewritten test in `scripts/presence/collect.test.mjs`. `collect.mjs` (the pure, tested logic) doesn't change. The git-state fixes are proven on a scratch replica of the runner that publishes to a local bare repository, run on the old code first and then the new.

**Tech Stack:** Node ESM (`node:child_process`, `node:fs`), git 2.47 (Git for Windows), Vitest, Git Bash for the replica harness.

**Spec:** `docs/superpowers/specs/2026-09-29-presence-runner-minors-design.md`

## Global Constraints

- Files this plan may change: `scripts/presence/run.mjs`, `scripts/presence/collect.test.mjs`, `docs/superpowers/specs/2026-09-28-now-page-design.md`, `PROGRESS.md`. `scripts/presence/collect.mjs` must end the plan byte-identical to how it started.
- `run.mjs` imports nothing but `./collect.mjs` and node builtins (the scheduled task runs a pinned copy of just these two files).
- No replica ever points at GitHub, Yandex or the real `claude agents`. The real clone at `%LOCALAPPDATA%\polozov-presence\repo` is only ever read, through `--dry-run`.
- Do not run `install.ps1`. Artem runs it himself with `!` (Task 4).
- Commit directly on `main`, one commit per task, staging only that task's files. Never stage `reports/`, `research_notes/`, `drafts/`, `content/lab/`, `.claude/settings.local.json`.
- Every commit message ends with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Do not push. Task 4 asks Artem.

## Replica harness (used by Tasks 2 and 3)

A scratch copy of the runner that is safe to run for real. It is never committed. Put it in the session scratchpad as `replica.sh`, with `SCRATCH` set to that scratchpad's absolute path in Git Bash form (e.g. `/c/Users/tigri/AppData/Local/Temp/claude/…/scratchpad`).

`replica.sh <scenario-dir> <old|new>` builds a fresh scenario:

- `bin/run.mjs`: `old` is the pre-plan baseline `558c129`, `new` is the working tree. `bin/collect.mjs` is copied next to it.
- The copy is rewritten so that `REMOTE` is a local bare repository, `PLAYLISTS_API` is a closed local port (Yandex "down"), `PROJECTS` is an empty directory, and `claude agents` becomes `echo []`. With no sessions and no transcripts, the state is `offline`.
- `appdata/polozov-presence/repo` holds an already-published clone. Its `HEAD` `presence.json` says `working`, it is pushed to the bare repository, and it has no `playlists.json`.

```bash
#!/usr/bin/env bash
# Replica of the presence runner for the runner-minors plan. Scratch only.
# Usage: replica.sh <scenario-dir> <old|new>
set -euo pipefail
REPO_ROOT=/c/A/polozov
BASELINE=558c129
dir="$1"
which="$2"
rm -rf "$dir"
mkdir -p "$dir/bin" "$dir/empty-projects"
if [ "$which" = old ]; then
  git -C "$REPO_ROOT" show "$BASELINE:scripts/presence/run.mjs" > "$dir/bin/run.mjs"
else
  cp "$REPO_ROOT/scripts/presence/run.mjs" "$dir/bin/run.mjs"
fi
cp "$REPO_ROOT/scripts/presence/collect.mjs" "$dir/bin/collect.mjs"
W=$(cygpath -m "$dir")
sed -i \
  -e "s|^const REMOTE = .*|const REMOTE = \"$W/bare.git\";|" \
  -e "s|^const PLAYLISTS_API = .*|const PLAYLISTS_API = \"https://127.0.0.1:9/playlists\";|" \
  -e "s|^const PROJECTS = .*|const PROJECTS = \"$W/empty-projects\";|" \
  -e 's|execAsync("claude agents --json --all"|execAsync("echo []"|' \
  "$dir/bin/run.mjs"
# Refuse to continue unless every rewrite landed.
grep -q "^const REMOTE = \"$W/bare.git\";" "$dir/bin/run.mjs"
grep -q '^const PLAYLISTS_API = "https://127.0.0.1:9/playlists";' "$dir/bin/run.mjs"
grep -q "^const PROJECTS = \"$W/empty-projects\";" "$dir/bin/run.mjs"
grep -q 'execAsync("echo \[\]"' "$dir/bin/run.mjs"
if grep -q 'github\.com\|api\.music\.yandex\.net\|execAsync("claude' "$dir/bin/run.mjs"; then
  echo "replica still points at a real source" >&2
  exit 1
fi

git init -q --bare -b presence-data "$dir/bare.git"
R="$dir/appdata/polozov-presence/repo"
mkdir -p "$R"
git -C "$R" init -q -b presence-data
git -C "$R" remote add origin "$W/bare.git"
printf '{\n  "state": "working",\n  "lastActive": "2026-09-01T08:00:00.000Z"\n}\n' > "$R/presence.json"
git -C "$R" add presence.json
git -C "$R" commit -q -m seed
git -C "$R" push -q origin HEAD:refs/heads/presence-data
git -C "$R" fetch -q origin
echo "replica ready: $dir ($which)"
```

Run a scenario and inspect it (in the same Git Bash command as the setup, with `dir` set to the scenario directory):

```bash
R="$dir/appdata/polozov-presence/repo"
LOCALAPPDATA="$(cygpath -w "$dir/appdata")" node "$dir/bin/run.mjs"; echo "exit=$?"
cat "$dir/appdata/polozov-presence/run.log"
git -C "$dir/bare.git" show presence-data:presence.json | grep '"state"'
```

The runner's `git commit --amend` uses the machine's global git identity, as the real task does.

---

### Task 1: Make the `assertPublishable` message test able to fail

**Files:**
- Modify: `scripts/presence/collect.test.mjs:488-496` (the `it("never puts a key or value into its message", …)` block)
- Temporarily mutated, then restored: `scripts/presence/collect.mjs:247`

**Interfaces:**
- Consumes: `assertPublishable({ presence, playlists })` from `collect.mjs`, which throws an `Error` whose message matches `/presence\.json keys/` when `presence` has a key outside the allowlist.
- Produces: nothing new.

The defect: `expect.unreachable()` sits inside the `try`. If `assertPublishable` stopped throwing, the error from `unreachable` is caught instead, its message doesn't contain `secret`, and the test passes anyway.

- [ ] **Step 1: Break `assertPublishable` on purpose**

```bash
cd /c/A/polozov && sed -i '247s/^export function assertPublishable({ presence, playlists }) {$/export function assertPublishable({ presence, playlists }) { return;/' scripts/presence/collect.mjs && sed -n 247p scripts/presence/collect.mjs
```

Expected: `export function assertPublishable({ presence, playlists }) { return;`

- [ ] **Step 2: Show the old test passes against the broken function**

Run: `npx vitest run scripts/presence/collect.test.mjs -t "never puts a key or value into its message"`
Expected: PASS (1 passed). This is the defect: the test can't catch a non-throwing `assertPublishable`.

- [ ] **Step 3: Rewrite the test**

Replace the whole block at `scripts/presence/collect.test.mjs:488-496`:

```js
  it("never puts a key or value into its message", () => {
    const secret = "C:\\A\\secret-client-repo";
    try {
      assertPublishable({ presence: { ...presence, [secret]: secret }, playlists: null });
      expect.unreachable();
    } catch (err) {
      expect(err.message).not.toContain("secret");
    }
  });
```

with:

```js
  it("never puts a key or value into its message", () => {
    const secret = "C:\\A\\secret-client-repo";
    let caught;
    try {
      assertPublishable({ presence: { ...presence, [secret]: secret }, playlists: null });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(caught.message).toMatch(/presence\.json keys/);
    expect(caught.message).not.toContain("secret");
  });
```

- [ ] **Step 4: Show the new test fails against the broken function**

Run: `npx vitest run scripts/presence/collect.test.mjs -t "never puts a key or value into its message"`
Expected: FAIL, on `expect(caught).toBeInstanceOf(Error)` (`caught` is `undefined`).

- [ ] **Step 5: Restore `collect.mjs`**

```bash
cd /c/A/polozov && git checkout -- scripts/presence/collect.mjs && git diff --stat scripts/presence/collect.mjs
```

Expected: no output (the file matches `HEAD` again).

- [ ] **Step 6: Run the test file**

Run: `npx vitest run scripts/presence/collect.test.mjs`
Expected: PASS, every test in the file.

- [ ] **Step 7: Run the full suite**

Run: `npm test`
Expected: PASS, 114 tests (the count doesn't change: one test was rewritten).

- [ ] **Step 8: Commit**

```bash
cd /c/A/polozov && git add scripts/presence/collect.test.mjs && git commit -q -m "Let the assertPublishable message test fail when nothing throws

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" && git log --oneline -1
```

---

### Task 2: Write `.git/config` only when origin is missing or wrong

**Files:**
- Modify: `scripts/presence/run.mjs` (the `INDEX_LOCK_STALE_MS` constant at `:61`, `clearStaleIndexLock` at `:242-258`, `ensureRemote` at `:260-267`, the call in `publish` at `:309`)
- Modify: `docs/superpowers/specs/2026-09-28-now-page-design.md:371-374`
- Scratch only: `replica.sh` (see "Replica harness")

**Interfaces:**
- Consumes: `git(args)` in `run.mjs`. It returns `{ stdout, stderr }` and rejects with an error whose `code` is git's exit code, the same way `seedPlaylists` already uses `err?.code === 2`. Also `REMOTE`, `REPO`, `log`.
- Produces: `clearStaleLocks()` (replaces `clearStaleIndexLock`) and `LOCK_STALE_MS` (replaces `INDEX_LOCK_STALE_MS`). `ensureRemote()` keeps its name and signature.

The defect: every publish runs `git remote set-url` (or `remote add`), which takes `.git/config.lock`. A run killed at that moment leaves the lock, and every later run fails on it.

- [ ] **Step 1: Write the replica harness**

Create `$SCRATCH/replica.sh` with the script from "Replica harness" and `chmod +x` it. Set `SCRATCH` to the session scratchpad in Git Bash form.

- [ ] **Step 2: Reproduce the defect on the old code (R1, R2, R4)**

```bash
S="$SCRATCH/task2"
# R1: a fresh config.lock, origin correct
dir="$S/r1-old"; "$SCRATCH/replica.sh" "$dir" old
R="$dir/appdata/polozov-presence/repo"; touch "$R/.git/config.lock"
LOCALAPPDATA="$(cygpath -w "$dir/appdata")" node "$dir/bin/run.mjs"; echo "exit=$?"
grep -c "could not lock config file" "$dir/appdata/polozov-presence/run.log"
# R2: a config.lock 20 minutes old, no origin
dir="$S/r2-old"; "$SCRATCH/replica.sh" "$dir" old
R="$dir/appdata/polozov-presence/repo"; git -C "$R" remote remove origin; touch -d '20 minutes ago' "$R/.git/config.lock"
LOCALAPPDATA="$(cygpath -w "$dir/appdata")" node "$dir/bin/run.mjs"; echo "exit=$?"
grep -c "could not lock config file" "$dir/appdata/polozov-presence/run.log"
# R4: steady state, no lock
dir="$S/r4-old"; "$SCRATCH/replica.sh" "$dir" old
R="$dir/appdata/polozov-presence/repo"; before=$(stat -c %y "$R/.git/config")
LOCALAPPDATA="$(cygpath -w "$dir/appdata")" node "$dir/bin/run.mjs"; echo "exit=$?"
[ "$before" = "$(stat -c %y "$R/.git/config")" ] && echo "config untouched" || echo "config rewritten"
```

Expected: R1 prints `exit=1` and a non-zero count. R2 prints `exit=1` and a non-zero count. R4 prints `exit=0` and `config rewritten`. If R4 prints `config untouched`, git skipped the identical write on this machine. Note that in the task report and go on: R1 and R2 are the defect that matters.

- [ ] **Step 3: Rename the lock constant**

In `scripts/presence/run.mjs`, replace:

```js
const INDEX_LOCK_STALE_MS = 10 * 60_000;
```

with:

```js
const LOCK_STALE_MS = 10 * 60_000;
```

- [ ] **Step 4: Sweep both lock files**

Replace:

```js
/**
 * A run killed mid-git (the task's 2-minute limit, git's 60 s timeout) can
 * leave .git/index.lock behind and fail every later run. No live run holds
 * it anywhere near this long, so an older one is removed.
 */
function clearStaleIndexLock() {
  const lock = join(REPO, ".git", "index.lock");
  let ageMs;
  try {
    ageMs = Date.now() - statSync(lock).mtimeMs;
  } catch {
    return;
  }
  if (ageMs <= INDEX_LOCK_STALE_MS) return;
  unlinkSync(lock);
  log(`removed a stale .git/index.lock (${Math.round(ageMs / 60_000)} min old)`);
}
```

with:

```js
/**
 * A run killed mid-git (the task's 2-minute limit, git's 60 s timeout) can
 * leave .git/index.lock or .git/config.lock behind and fail every later
 * run. No live run holds either anywhere near this long, so an older one is
 * removed.
 */
function clearStaleLocks() {
  for (const name of ["index.lock", "config.lock"]) {
    const lock = join(REPO, ".git", name);
    let ageMs;
    try {
      ageMs = Date.now() - statSync(lock).mtimeMs;
    } catch {
      continue;
    }
    if (ageMs <= LOCK_STALE_MS) continue;
    unlinkSync(lock);
    log(`removed a stale .git/${name} (${Math.round(ageMs / 60_000)} min old)`);
  }
}
```

- [ ] **Step 5: Write origin only when it's missing or wrong**

Replace:

```js
/** Every run, so one killed between `git init` and `remote add` heals itself. */
async function ensureRemote() {
  const { stdout } = await git(["remote"]);
  const hasOrigin = stdout.split(/\r?\n/).includes("origin");
  await git(
    hasOrigin ? ["remote", "set-url", "origin", REMOTE] : ["remote", "add", "origin", REMOTE],
  );
}
```

with:

```js
/**
 * Every run, so one killed between `git init` and `remote add` heals itself,
 * but .git/config is written only when origin is missing or wrong. The URL
 * is read raw: `git remote get-url` expands a global `insteadOf` and would
 * never match.
 */
async function ensureRemote() {
  let url = null;
  try {
    const { stdout } = await git(["config", "--get", "remote.origin.url"]);
    url = stdout.trim();
  } catch (err) {
    if (err?.code !== 1) throw err; // 1: no such key, so no origin yet
  }
  if (url === REMOTE) return;
  await git(
    url === null ? ["remote", "add", "origin", REMOTE] : ["remote", "set-url", "origin", REMOTE],
  );
}
```

- [ ] **Step 6: Update the call in `publish`**

Replace:

```js
  clearStaleIndexLock();
  await ensureRemote();
```

with:

```js
  clearStaleLocks();
  await ensureRemote();
```

Then confirm nothing still uses the old names:

Run: `grep -n "clearStaleIndexLock\|INDEX_LOCK_STALE_MS" scripts/presence/run.mjs`
Expected: no output.

- [ ] **Step 7: Run the same scenarios on the new code**

```bash
S="$SCRATCH/task2"
# R1
dir="$S/r1-new"; "$SCRATCH/replica.sh" "$dir" new
R="$dir/appdata/polozov-presence/repo"; touch "$R/.git/config.lock"
LOCALAPPDATA="$(cygpath -w "$dir/appdata")" node "$dir/bin/run.mjs"; echo "exit=$?"
cat "$dir/appdata/polozov-presence/run.log"
git -C "$dir/bare.git" show presence-data:presence.json | grep '"state"'
# R2
dir="$S/r2-new"; "$SCRATCH/replica.sh" "$dir" new
R="$dir/appdata/polozov-presence/repo"; git -C "$R" remote remove origin; touch -d '20 minutes ago' "$R/.git/config.lock"
LOCALAPPDATA="$(cygpath -w "$dir/appdata")" node "$dir/bin/run.mjs"; echo "exit=$?"
cat "$dir/appdata/polozov-presence/run.log"
git -C "$R" config --get remote.origin.url
[ -e "$R/.git/config.lock" ] && echo "lock still there" || echo "lock removed"
git -C "$dir/bare.git" show presence-data:presence.json | grep '"state"'
# R4
dir="$S/r4-new"; "$SCRATCH/replica.sh" "$dir" new
R="$dir/appdata/polozov-presence/repo"; before=$(stat -c %y "$R/.git/config")
LOCALAPPDATA="$(cygpath -w "$dir/appdata")" node "$dir/bin/run.mjs"; echo "exit=$?"
[ "$before" = "$(stat -c %y "$R/.git/config")" ] && echo "config untouched" || echo "config rewritten"
```

Expected:
- R1: `exit=0`. The log has one `yandex music failed: …` line and one `published offline today=0m sessions=0 playlists=kept` line. The bare repository says `"state": "offline",`.
- R2: `exit=0`. The log has `removed a stale .git/config.lock (20 min old)` and `published offline today=0m sessions=0 playlists=kept (the previous push had not landed)`. `remote remove` dropped the remote-tracking ref, so that note is expected. The URL printed is `<scenario dir in C:/… form>/bare.git`, then `lock removed`, then `"state": "offline",`.
- R4: `exit=0`, `config untouched`.

- [ ] **Step 8: Update the /now/ spec's publishing paragraph**

In `docs/superpowers/specs/2026-09-28-now-page-design.md`, replace:

```
Every published run: remove a `.git/index.lock` older than 10 minutes
(left by a killed run), add `origin`
(`https://github.com/hpnssflw/hpnssflw.github.io.git`) if missing or
`set-url` it, write `presence.json` (and `playlists.json` when
```

with:

```
Every published run: remove a `.git/index.lock` or `.git/config.lock`
older than 10 minutes (left by a killed run), add `origin`
(`https://github.com/hpnssflw/hpnssflw.github.io.git`) if missing or
`set-url` it if its raw URL (`git config --get remote.origin.url`)
differs — a normal run doesn't write `.git/config` — write
`presence.json` (and `playlists.json` when
```

- [ ] **Step 9: Test suite and dry run**

Run: `npm test`
Expected: PASS, 114 tests. `run.mjs` has no unit tests, so this only confirms nothing else broke.

Run: `node scripts/presence/run.mjs --dry-run; echo "exit=$?"`
Expected: `exit=0`, and stdout is `{ "presence.json": {…ten keys…}, "playlists.json": … }`. A `yandex music failed` line on stderr is acceptable. The dry run returns before `publish`, so it never reaches `ensureRemote`. This step only confirms the file still loads and runs.

- [ ] **Step 10: Commit**

```bash
cd /c/A/polozov && git add scripts/presence/run.mjs docs/superpowers/specs/2026-09-28-now-page-design.md && git commit -q -m "Write the presence clone's origin only when it is missing or wrong

A leftover .git/config.lock no longer fails every later run: a normal
publish never writes .git/config, and a config.lock older than 10
minutes is swept like index.lock.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" && git log --oneline -1
```

---

### Task 3: Read the previous state from the clone's `HEAD`

**Files:**
- Modify: `scripts/presence/run.mjs` (`readPrevious` and `readPreviousPlaylistsText` at `:188-202`, and `main` at `:341`, `:364-365`, `:385-386`)
- Modify: `docs/superpowers/specs/2026-09-28-now-page-design.md:353-360` (runner step 5)
- Scratch only: `replica.sh` from Task 2 (if it's gone, recreate it from "Replica harness")

**Interfaces:**
- Consumes: `git(args)`, `REPO`, `existsSync`, `join` in `run.mjs`. Also `hasUnpushedCommit()`, which forces a publish whenever `HEAD` differs from `refs/remotes/origin/presence-data`.
- Produces: `readCommitted(file: string): Promise<string | null>`, and `readPrevious(): Promise<object | null>` (now async). `readPreviousPlaylistsText` is deleted.

The defect: `readPrevious` and `readPreviousPlaylistsText` read the clone's working tree. A run that fails between writing the files and `git commit` leaves the tree ahead of anything published. The next offline run then compares against it and can skip while the branch still says `working`.

- [ ] **Step 1: Reproduce the defect on the old code (R3)**

```bash
S="$SCRATCH/task3"
dir="$S/r3-old"; "$SCRATCH/replica.sh" "$dir" old
R="$dir/appdata/polozov-presence/repo"
# A run that wrote presence.json and died before committing:
printf '{\n  "state": "offline",\n  "lastActive": "2026-09-01T08:00:00.000Z"\n}\n' > "$R/presence.json"
LOCALAPPDATA="$(cygpath -w "$dir/appdata")" node "$dir/bin/run.mjs"; echo "exit=$?"
tail -1 "$dir/appdata/polozov-presence/run.log"
git -C "$dir/bare.git" show presence-data:presence.json | grep '"state"'
```

Expected: `exit=0`, then `… skip: offline, already published as offline; playlists unchanged`, then `"state": "working",`. That's the defect: the published branch still says `working`.

- [ ] **Step 2: Replace the working-tree readers**

In `scripts/presence/run.mjs`, replace:

```js
function readPrevious() {
  try {
    return JSON.parse(readFileSync(join(REPO, "presence.json"), "utf8"));
  } catch {
    return null;
  }
}

function readPreviousPlaylistsText() {
  try {
    return readFileSync(join(REPO, "playlists.json"), "utf8");
  } catch {
    return null;
  }
}
```

with:

```js
/**
 * `file` as committed at the clone's HEAD (what was published, or a commit
 * whose push failed, which hasUnpushedCommit forces out), or null when
 * there's no clone, no commit or no such file. Never the working tree: a
 * run that failed between writing and committing leaves it ahead of
 * anything published.
 */
async function readCommitted(file) {
  if (!existsSync(join(REPO, ".git"))) return null; // don't let git search parent dirs
  try {
    const { stdout } = await git(["show", `HEAD:${file}`]);
    return stdout;
  } catch {
    return null;
  }
}

async function readPrevious() {
  const text = await readCommitted("presence.json");
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
```

`readFileSync` is still used by `log`, so keep its import.

- [ ] **Step 3: Await the new readers in `main`**

Replace:

```js
  const prev = readPrevious();
```

with:

```js
  const prev = await readPrevious();
```

Replace:

```js
  const playlistsChanged =
    playlistsText !== null && playlistsText !== readPreviousPlaylistsText();
```

with:

```js
  const playlistsChanged =
    playlistsText !== null && playlistsText !== (await readCommitted("playlists.json"));
```

Replace:

```js
  // prev and the playlists comparison come from the clone, which may hold
  // a commit whose push failed — that alone forces a publish.
```

with:

```js
  // prev and the playlists comparison come from the clone's HEAD, which may
  // be a commit whose push failed — that alone forces a publish.
```

Then confirm nothing still uses the old reader:

Run: `grep -n "readPreviousPlaylistsText\|readPrevious()" scripts/presence/run.mjs`
Expected: exactly two lines, `async function readPrevious() {` and `const prev = await readPrevious();`. Nothing matches `readPreviousPlaylistsText`.

- [ ] **Step 4: Run R3 on the new code**

```bash
S="$SCRATCH/task3"
dir="$S/r3-new"; "$SCRATCH/replica.sh" "$dir" new
R="$dir/appdata/polozov-presence/repo"
printf '{\n  "state": "offline",\n  "lastActive": "2026-09-01T08:00:00.000Z"\n}\n' > "$R/presence.json"
LOCALAPPDATA="$(cygpath -w "$dir/appdata")" node "$dir/bin/run.mjs"; echo "exit=$?"
tail -1 "$dir/appdata/polozov-presence/run.log"
git -C "$dir/bare.git" show presence-data:presence.json | grep '"state"'
```

Expected: `exit=0`, then `… published offline today=0m sessions=0 playlists=kept`, then `"state": "offline",`.

- [ ] **Step 5: Confirm a quiet offline run still skips**

Run the new replica once more in the same scenario. `HEAD` now says `offline`, so this is the intended "one offline push, then silence":

```bash
LOCALAPPDATA="$(cygpath -w "$dir/appdata")" node "$dir/bin/run.mjs"; echo "exit=$?"
tail -1 "$dir/appdata/polozov-presence/run.log"
```

Expected: `exit=0`, then `… skip: offline, already published as offline; playlists unchanged`.

- [ ] **Step 6: Update the /now/ spec's runner step 5**

In `docs/superpowers/specs/2026-09-28-now-page-design.md`, replace:

```
5. Publish (below). **Skip the push** only if both hold: the new `state`
   is `offline` and the last published `state` (read from the local
   clone's `presence.json`) is also `offline` — one "offline" push, then
   silence; the page's staleness check covers the rest — **and** the new
   `playlists.json` text is byte-identical to the clone's current file
   (or step 4 failed) — **and** the clone holds no unpushed commit (its
   `HEAD` equals `refs/remotes/origin/presence-data`, which a successful
   push moves), since both comparisons read that clone.
```

with:

```
5. Publish (below). **Skip the push** only if both hold: the new `state`
   is `offline` and the last published `state` (read from the local
   clone's `HEAD` commit, never its working tree, which a failed run can
   leave ahead of it) is also `offline` — one "offline" push, then
   silence; the page's staleness check covers the rest — **and** the new
   `playlists.json` text is byte-identical to the one in that commit
   (or step 4 failed) — **and** the clone holds no unpushed commit (its
   `HEAD` equals `refs/remotes/origin/presence-data`, which a successful
   push moves), since both comparisons read that commit.
```

- [ ] **Step 7: Test suite and dry run against the real clone**

Run: `npm test`
Expected: PASS, 114 tests.

Run: `node scripts/presence/run.mjs --dry-run; echo "exit=$?"`
Expected: `exit=0` and the same two-file JSON shape as before. This dry run now reads the real clone through `git show HEAD:presence.json`, which is read-only.

- [ ] **Step 8: Commit**

```bash
cd /c/A/polozov && git add scripts/presence/run.mjs docs/superpowers/specs/2026-09-28-now-page-design.md && git commit -q -m "Read the presence runner's previous state from the clone's HEAD

A run that dies between writing and committing no longer makes the next
offline run skip while the published branch still says working.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" && git log --oneline -1
```

---

### Task 4: Reinstall the pinned runner and reconcile status docs

**Files:**
- Modify: `PROGRESS.md` (the "Now page" section, the bullet that starts `- Final whole-plan review (opus): 0 Critical; 2 Important + 10 Minor`)

**Interfaces:**
- Consumes: Tasks 1–3's commits.
- Produces: nothing new.

- [ ] **Step 1: Ask Artem to reinstall**

The task runs the pinned copy in `%LOCALAPPDATA%\polozov-presence\bin`, so the fixes reach it only through `install.ps1`. Ask Artem to type:

```
! powershell -NoProfile -ExecutionPolicy Bypass -File scripts\presence\install.ps1
```

Wait for the output. It should register the task with no error.

- [ ] **Step 2: Confirm the pinned copy is the new code**

```bash
cd /c/A/polozov && cmp scripts/presence/run.mjs "$LOCALAPPDATA/polozov-presence/bin/run.mjs" && cmp scripts/presence/collect.mjs "$LOCALAPPDATA/polozov-presence/bin/collect.mjs" && echo "pinned copy matches"
```

Expected: `pinned copy matches`.

- [ ] **Step 3: Watch the next scheduled run**

Note the current last line of `%LOCALAPPDATA%\polozov-presence\run.log`. The task fires about a minute after install, then every 5 minutes. Wait for a new line (with Monitor or an until-loop, not a foreground sleep, up to 7 minutes), then print the lines since the noted one.

Expected: the new lines end in `published …` or `skip: …`, with no `error:` line. A `yandex music failed` line or a single retried push is the known noise and doesn't count as a failure. If an `error:` line appears, stop and report it, don't fix it ad hoc.

- [ ] **Step 4: Update PROGRESS.md**

Get the fix range first: `git log --oneline -4` shows Tasks 1–3's commits. Call the oldest `<T1>` and the newest `<T3>` below.

In `PROGRESS.md`, replace:

```
- Final whole-plan review (opus): 0 Critical; 2 Important + 10 Minor
  fixed in one wave (`525e887..e76c57a`); scoped re-review clean. Parked
  Minor follow-ups: `ensureRemote` runs `git remote set-url` on every
  publish, so a leftover `.git/config.lock` would fail every later run
  (compare `get-url` first); one `assertPublishable` test in
  `collect.test.mjs` can't fail (`expect.unreachable` inside the `try`);
  `readPrevious*` read the clone's working tree, so a run that fails
  between write and commit can make the next offline run skip. Yandex
  timeouts and `getaddrinfo() thread failed to start` push failures show
  up in `run.log` a few times a day; both self-heal on the next run.
```

with the text below. Substitute the real short hashes for `<T1>` and `<T3>`:

```
- Final whole-plan review (opus): 0 Critical; 2 Important + 10 Minor
  fixed in one wave (`525e887..e76c57a`); scoped re-review clean. Its
  three parked Minor follow-ups were fixed on 2026-09-29 (`<T1>..<T3>`;
  spec `docs/superpowers/specs/2026-09-29-presence-runner-minors-design.md`,
  plan `docs/superpowers/plans/2026-09-29-presence-runner-minors.md`):
  `ensureRemote` writes `.git/config` only when `origin` is missing or
  wrong, and a stale `config.lock` is swept like `index.lock`; the
  `assertPublishable` message test can fail now; the previous state is
  read from the clone's `HEAD`, not its working tree. `install.ps1` was
  re-run the same day.
- Known self-healing noise in `run.log`: Yandex timeouts and
  `getaddrinfo() thread failed to start` push failures, a few times a
  day. Seen once (2026-09-28 16:03, right after the machine woke): a run
  started before sleep collided with a fresh one (`index.lock` exists,
  `cannot lock ref 'HEAD'`). Git refused safely and the next run
  published 20 s later. No run-level lock was added.
```

- [ ] **Step 5: Commit**

```bash
cd /c/A/polozov && git add PROGRESS.md && git commit -q -m "Reconcile status docs with the presence-runner Minor fixes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" && git log --oneline -1 && git status --short
```

Expected: `git status --short` lists only `?? reports/` and `?? research_notes/` (plus anything a parallel session left under `drafts/` or `content/lab/`, which stays untouched).

- [ ] **Step 6: Ask Artem about pushing**

`main` is now ahead of `origin/main` by the spec, plan and four task commits. A push redeploys the site. The site itself doesn't change: these commits touch docs and `scripts/presence/` only. Ask Artem whether to push, and push only on a yes.
