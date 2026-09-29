import { getFile } from "./github-contents";

/**
 * The Tony Scraponi inbox's decisions file (hpnssflw/tony-inbox). The
 * site's /researcher/queue/ owner mode is its only writer; the agent
 * reads it at the start of every run and delivers approved items only.
 * See docs/superpowers/specs/2026-09-28-tony-scraponi-inbox-design.md.
 */
export const DECISIONS_REPO = "hpnssflw/tony-inbox";
export const DECISIONS_PATH = "decisions.json";
export const DECISIONS_RAW_URL = `https://raw.githubusercontent.com/${DECISIONS_REPO}/main/${DECISIONS_PATH}`;

export type Decision = "approve" | "reject";
export type ItemStatus = "approved" | "rejected" | "waiting";

export interface DecisionEntry {
  decision: Decision;
  at: string;
}

export interface Decisions {
  version: 1;
  decisions: Record<string, DecisionEntry>;
}

export interface OwnerSnapshot {
  decisions: Decisions;
  sha: string;
}

export const EMPTY_DECISIONS: Decisions = { version: 1, decisions: {} };

const COMMIT_MESSAGE_MAX = 72;

/** Grace period for pruneDecisions' keepNewerThan cutoff: covers
 * raw.githubusercontent's ~5-min cache plus clock skew between devices. */
export const PRUNE_GRACE_MS = 10 * 60 * 1000;

function isDecisionEntry(value: unknown): value is DecisionEntry {
  if (typeof value !== "object" || value === null) return false;
  const e = value as Record<string, unknown>;
  return (e.decision === "approve" || e.decision === "reject") && typeof e.at === "string";
}

/** Mirrors agent/inbox.py's parse_decisions: any bad part fails the whole file. */
export function isDecisions(value: unknown): value is Decisions {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const d = value as Record<string, unknown>;
  if (d.version !== 1) return false;
  if (typeof d.decisions !== "object" || d.decisions === null || Array.isArray(d.decisions)) {
    return false;
  }
  return Object.values(d.decisions).every(isDecisionEntry);
}

/** Returns a new Decisions; `null` is undo (the entry is removed). */
export function setDecision(
  decisions: Decisions,
  url: string,
  decision: Decision | null,
  now: Date,
): Decisions {
  const next = { ...decisions.decisions };
  if (decision === null) delete next[url];
  else next[url] = { decision, at: now.toISOString() };
  return { version: 1, decisions: next };
}

/**
 * Drops entries this tab can't vouch for. An entry is removed only if its
 * URL isn't in the tab's loaded queue (`liveUrls`) AND its `at` is older
 * than `keepNewerThan` (the tab's queue-load time minus PRUNE_GRACE_MS): a
 * stale tab must not delete a decision made elsewhere for an item it
 * hasn't seen yet. An unparseable `at` counts as old (pruned if not live).
 */
export function pruneDecisions(
  decisions: Decisions,
  liveUrls: Iterable<string>,
  keepNewerThan: Date,
): Decisions {
  const live = new Set(liveUrls);
  const cutoff = keepNewerThan.getTime();
  const next: Record<string, DecisionEntry> = {};
  for (const [url, entry] of Object.entries(decisions.decisions)) {
    if (live.has(url) || Date.parse(entry.at) >= cutoff) next[url] = entry;
  }
  return { version: 1, decisions: next };
}

export function itemStatus(decisions: Decisions | null, url: string): ItemStatus {
  const entry = decisions?.decisions[url];
  if (entry?.decision === "approve") return "approved";
  if (entry?.decision === "reject") return "rejected";
  return "waiting";
}

export function serializeDecisions(decisions: Decisions): string {
  return `${JSON.stringify(decisions, null, 2)}\n`;
}

export function commitMessage(action: Decision | "undo", title: string): string {
  const message = `${action}: ${title}`;
  const codePoints = Array.from(message);
  return codePoints.length <= COMMIT_MESSAGE_MAX
    ? message
    : `${codePoints.slice(0, COMMIT_MESSAGE_MAX - 1).join("")}…`;
}

/** Public read through raw.githubusercontent (≈5 min cache). Any failure → null. */
export async function fetchPublicDecisions(): Promise<Decisions | null> {
  try {
    const res = await fetch(DECISIONS_RAW_URL, { cache: "no-store" });
    if (!res.ok) return null;
    const data: unknown = await res.json();
    return isDecisions(data) ? data : null;
  } catch {
    return null;
  }
}

/** Owner read through the Contents API: fresh, and with the sha a write needs. */
export async function fetchOwnerDecisions(token: string): Promise<OwnerSnapshot> {
  const file = await getFile(DECISIONS_REPO, DECISIONS_PATH, token);
  const data: unknown = JSON.parse(file.text);
  if (!isDecisions(data)) throw new Error("decisions.json is malformed");
  return { decisions: data, sha: file.sha };
}
