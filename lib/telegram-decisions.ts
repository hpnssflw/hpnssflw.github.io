import type { Decision, DecisionEntry, Decisions } from "./inbox";

/**
 * The agent's record of Telegram approvals: agent/telegram.json on the
 * agent-data branch (docs/superpowers/specs/2026-10-08-telegram-approval-design.md).
 * The site reads only its decisions. mergeDecisions mirrors
 * agent/approval.py's merge_decisions; both run the shared cases in
 * agent/tests/fixtures/approval-merge.json, so change them together.
 */
export const TELEGRAM_URL =
  "https://raw.githubusercontent.com/hpnssflw/hpnssflw.github.io/agent-data/agent/telegram.json";

export type TelegramDecision = Decision | "clear";

export interface TelegramDecisions {
  decisions: Record<string, { decision: TelegramDecision; at: string }>;
}

export interface MergedDecisions {
  decisions: Decisions;
  /** URLs whose decision came from Telegram. */
  viaTelegram: ReadonlySet<string>;
}

function isEntry(value: unknown): value is { decision: TelegramDecision; at: string } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const e = value as Record<string, unknown>;
  return (e.decision === "approve" || e.decision === "reject" || e.decision === "clear") && typeof e.at === "string";
}

/** telegram.json's decisions; null when the file is malformed (one bad entry fails it, as in the agent). */
export function parseTelegramDecisions(value: unknown): TelegramDecisions | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (raw.version !== 1) return null;
  const decisions = raw.decisions;
  if (typeof decisions !== "object" || decisions === null || Array.isArray(decisions)) return null;
  if (!Object.values(decisions).every(isEntry)) return null;
  return { decisions: decisions as TelegramDecisions["decisions"] };
}

/** An unparseable time counts as the oldest. */
function when(iso: string): number {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? -Infinity : t;
}

/** Per URL, the later of the site's entry and Telegram's wins (a tie goes to the site); Telegram's "clear" (Undo) leaves the item undecided. */
export function mergeDecisions(site: Decisions, telegram: TelegramDecisions | null): MergedDecisions {
  const merged: Record<string, DecisionEntry> = {};
  const viaTelegram = new Set<string>();
  const fromTelegram = telegram?.decisions ?? {};
  for (const url of new Set([...Object.keys(site.decisions), ...Object.keys(fromTelegram)])) {
    const ours = site.decisions[url];
    const theirs = fromTelegram[url];
    if (theirs === undefined || (ours !== undefined && when(ours.at) >= when(theirs.at))) {
      merged[url] = ours;
      continue;
    }
    if (theirs.decision === "clear") continue;
    merged[url] = { decision: theirs.decision, at: theirs.at };
    viaTelegram.add(url);
  }
  return { decisions: { version: 1, decisions: merged }, viaTelegram };
}
