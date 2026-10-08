import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EMPTY_DECISIONS } from "./inbox";
import { statusCounts } from "./queue-view";
import { mergeDecisions, parseTelegramDecisions } from "./telegram-decisions";

interface MergeCase {
  name: string;
  site: Record<string, { decision: "approve" | "reject"; at: string }>;
  telegram: Record<string, { decision: "approve" | "reject" | "clear"; at: string }>;
  expected: Record<string, string>;
  via_telegram: string[];
}

const CASES: MergeCase[] = JSON.parse(
  readFileSync(join(process.cwd(), "agent", "tests", "fixtures", "approval-merge.json"), "utf8"),
).cases;

describe("mergeDecisions on the shared cases (agent/approval.py's merge_decisions runs them too)", () => {
  for (const c of CASES) {
    it(c.name, () => {
      const merged = mergeDecisions({ version: 1, decisions: c.site }, { decisions: c.telegram });
      const decided = Object.fromEntries(Object.entries(merged.decisions.decisions).map(([url, e]) => [url, e.decision]));
      expect(decided).toEqual(c.expected);
      expect([...merged.viaTelegram].sort()).toEqual([...c.via_telegram].sort());
    });
  }
});

describe("mergeDecisions", () => {
  it("leaves the site's decisions alone without a Telegram file", () => {
    const site = { version: 1 as const, decisions: { "https://a": { decision: "approve" as const, at: "2026-10-09T08:00:00.000Z" } } };
    expect(mergeDecisions(site, null)).toEqual({ decisions: site, viaTelegram: new Set() });
  });

  it("feeds the queue's status counts", () => {
    const merged = mergeDecisions(EMPTY_DECISIONS, { decisions: { "https://a": { decision: "approve", at: "2026-10-09T12:00:00+00:00" } } });
    const item = { url: "https://a", title: "A", source: "hn", topic: "t", topic_name: "T", summary: "", score: 8, pending_since: "2026-10-09T00:00:00+00:00" };
    expect(statusCounts([item], merged.decisions, "all")).toEqual({ waiting: 0, approved: 1, rejected: 0, all: 1 });
  });
});

describe("parseTelegramDecisions", () => {
  const valid = { version: 1, offset: 4, decisions: { "https://a": { decision: "clear", at: "x" } }, messages: {} };

  it("reads the decisions of a valid file", () => {
    expect(parseTelegramDecisions(valid)).toEqual({ decisions: valid.decisions });
  });

  it.each([
    ["not an object", null],
    ["another version", { ...valid, version: 2 }],
    ["decisions not an object", { ...valid, decisions: [] }],
    ["an unknown decision", { ...valid, decisions: { "https://a": { decision: "maybe", at: "x" } } }],
    ["a missing time", { ...valid, decisions: { "https://a": { decision: "approve" } } }],
  ])("rejects %s", (_name, value) => {
    expect(parseTelegramDecisions(value)).toBeNull();
  });
});
