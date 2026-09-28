/**
 * Local collector for /now/ — see
 * docs/superpowers/specs/2026-09-28-now-page-design.md.
 *
 * Run every 5 minutes by Task Scheduler — as the pinned copy install.ps1
 * puts in %LOCALAPPDATA%\polozov-presence\bin, never from this working
 * tree, so it imports nothing but ./collect.mjs and node builtins. Reads only
 * `timestamp`, `sessionId` and `message.model` from today's
 * ~/.claude/projects transcripts, plus each session's busy/idle status
 * from `claude agents --json --all`, and fetches Artem's public Yandex
 * Music playlists (the API refuses browsers and GitHub's runners, so this
 * machine is the only place that can). Force-pushes a ten-key
 * presence.json and a trimmed playlists.json to the orphan
 * `presence-data` branch from a dedicated clone under %LOCALAPPDATA% —
 * never from the working tree.
 *
 *   node scripts/presence/run.mjs            collect + publish
 *   node scripts/presence/run.mjs --dry-run  collect + print, no publish
 */
import { exec, execFile } from "node:child_process";
import {
  appendFileSync,
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { get } from "node:https";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { promisify } from "node:util";
import {
  assertPublishable,
  buildPresence,
  localDayInfo,
  shouldPublish,
  trimPlaylists,
} from "./collect.mjs";

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

const PLAYLISTS_API = "https://api.music.yandex.net/users/tmkplzv/playlists/list";
const REMOTE = "https://github.com/hpnssflw/hpnssflw.github.io.git";
const BRANCH = "presence-data";
const BASE = join(
  process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"),
  "polozov-presence",
);
const REPO = join(BASE, "repo");
const LOG = join(BASE, "run.log");
const PROJECTS = join(homedir(), ".claude", "projects");
const DRY_RUN = process.argv.includes("--dry-run");

// Fail fast instead of hanging on a credential prompt nobody can see.
const GIT_ENV = { ...process.env, GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never" };

function log(message) {
  const line = `${new Date().toISOString()} ${message}\n`;
  if (DRY_RUN) {
    process.stderr.write(line);
    return;
  }
  try {
    appendFileSync(LOG, line);
    const lines = readFileSync(LOG, "utf8").split("\n");
    if (lines.length > 600) writeFileSync(LOG, lines.slice(-500).join("\n"));
  } catch {
    // Logging must never break a run.
  }
}

/** Busy/idle only — cwd, name, pid and sessionId are dropped right here. */
async function getAgents() {
  try {
    // `claude` is an npm .cmd shim on Windows; Node won't spawn .cmd
    // without a shell, so this goes through exec with a constant string.
    const { stdout } = await execAsync("claude agents --json --all", {
      timeout: 20_000,
      windowsHide: true,
    });
    const parsed = JSON.parse(stdout);
    return Array.isArray(parsed) ? parsed.map((a) => ({ status: a?.status })) : [];
  } catch (err) {
    log(`claude agents failed: ${err instanceof Error ? err.message.split("\n")[0] : err}`);
    return [];
  }
}

function todaysTranscripts(dayStartMs) {
  if (!existsSync(PROJECTS)) return [];
  return readdirSync(PROJECTS, { recursive: true })
    .filter((rel) => typeof rel === "string" && rel.endsWith(".jsonl"))
    .map((rel) => join(PROJECTS, rel))
    .filter((file) => {
      try {
        return statSync(file).mtimeMs >= dayStartMs;
      } catch {
        return false;
      }
    });
}

/** Extracts ONLY timestamp, sessionId and message.model from each line. */
async function readEvents(file, out) {
  const lines = createInterface({
    input: createReadStream(file, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });
  for await (const line of lines) {
    if (!line) continue;
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    const ts = typeof row?.timestamp === "string" ? Date.parse(row.timestamp) : NaN;
    if (!Number.isFinite(ts)) continue;
    out.push({
      ts,
      sessionId: typeof row.sessionId === "string" ? row.sessionId : null,
      model: typeof row.message?.model === "string" ? row.message.model : null,
    });
  }
}

/**
 * GET → parsed JSON over node:https rather than fetch(): Yandex's
 * anti-robot layer answers 403 (x-yandex-captcha) to Node TLS handshakes
 * that advertise ALPN, which undici's fetch always does; the plain https
 * client, like curl, gets 200.
 */
function getJson(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const req = get(url, { signal: AbortSignal.timeout(timeoutMs) }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        body += chunk;
      });
      res.on("error", reject);
      res.on("close", () => {
        if (!res.complete) reject(new Error("response ended early"));
      });
      res.on("end", () => {
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
        try {
          resolve(JSON.parse(body));
        } catch (err) {
          reject(err);
        }
      });
    });
    req.on("error", reject);
  });
}

/**
 * playlists.json text as it would be published, or null when Yandex can't
 * be read this run — an expected failure: the last published file stays.
 */
async function fetchPlaylistsText() {
  try {
    const trimmed = trimPlaylists(await getJson(PLAYLISTS_API, 10_000));
    if (!trimmed) throw new Error("unexpected response shape");
    return `${JSON.stringify(trimmed, null, 2)}\n`;
  } catch (err) {
    log(`yandex music failed: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}

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

function git(args) {
  return execFileAsync("git", args, {
    cwd: REPO,
    env: GIT_ENV,
    timeout: 60_000,
    windowsHide: true,
  });
}

async function hasCommit() {
  try {
    await git(["rev-parse", "--verify", "-q", "HEAD"]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Keeps presence-data at exactly one commit: amend + force-push. A null
 * playlistsText leaves the previously committed playlists.json as it is.
 */
async function publish(presenceText, playlistsText, updatedAt) {
  if (!existsSync(join(REPO, ".git"))) {
    mkdirSync(REPO, { recursive: true });
    await git(["init", "-q", "-b", BRANCH]);
    await git(["remote", "add", "origin", REMOTE]);
  }
  writeFileSync(join(REPO, "presence.json"), presenceText);
  await git(["add", "presence.json"]);
  if (playlistsText !== null) {
    writeFileSync(join(REPO, "playlists.json"), playlistsText);
    await git(["add", "playlists.json"]);
  }
  const message = `presence ${updatedAt}`;
  await git(
    (await hasCommit())
      ? ["commit", "-q", "--amend", "-m", message]
      : ["commit", "-q", "-m", message],
  );
  await git(["push", "-q", "--force", "origin", `HEAD:refs/heads/${BRANCH}`]);
}

async function main() {
  mkdirSync(BASE, { recursive: true });
  const nowMs = Date.now();
  const { day, dayStartMs } = localDayInfo(nowMs);
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const prev = readPrevious();

  const events = [];
  for (const file of todaysTranscripts(dayStartMs)) {
    try {
      await readEvents(file, events);
    } catch (err) {
      log(`skipped a transcript: ${err instanceof Error ? err.message : err}`);
    }
  }

  const presence = buildPresence({
    agents: await getAgents(),
    events,
    nowMs,
    dayStartMs,
    day,
    tz,
    prevLastActive: typeof prev?.lastActive === "string" ? prev.lastActive : null,
  });

  const presenceText = `${JSON.stringify(presence, null, 2)}\n`;
  const playlistsText = await fetchPlaylistsText();
  const playlistsChanged =
    playlistsText !== null && playlistsText !== readPreviousPlaylistsText();

  // Checked on exactly the text that would be written, in both paths.
  const outgoing = {
    presence: JSON.parse(presenceText),
    playlists: playlistsText === null ? null : JSON.parse(playlistsText),
  };
  try {
    assertPublishable(outgoing);
  } catch (err) {
    log(`${err instanceof Error ? err.message : "not publishable"}; nothing published`);
    process.exitCode = 1;
    return;
  }

  if (DRY_RUN) {
    const both = { "presence.json": outgoing.presence, "playlists.json": outgoing.playlists };
    process.stdout.write(`${JSON.stringify(both, null, 2)}\n`);
    return;
  }
  const decision = { prevState: prev?.state ?? null, nextState: presence.state, playlistsChanged };
  if (!shouldPublish(decision)) {
    log("skip: offline, already published as offline; playlists unchanged");
    return;
  }
  await publish(presenceText, playlistsText, presence.updatedAt);
  const playlistsNote = playlistsText === null ? "kept" : playlistsChanged ? "updated" : "same";
  log(
    `published ${presence.state} today=${presence.todayMinutes}m ` +
      `sessions=${presence.sessionsToday} playlists=${playlistsNote}`,
  );
}

main().catch((err) => {
  log(`error: ${err instanceof Error ? err.stack : err}`);
  process.exitCode = 1;
});
