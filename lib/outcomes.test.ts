import { describe, expect, it } from "vitest";
import { type AgentState, buildOutcomes, parseAgentState, topicVerdicts } from "./outcomes";

function verdict(relevance: number, rubric: string, at: string, queued: boolean) {
  return { relevance, rubric, ranked_at: at, queued_at: queued ? at : null };
}

const state: AgentState = {
  sent: { times_sent: 1, dismissed: null, ranks: { tooling: verdict(8, "aaa", "2026-10-05T18:22:00+00:00", true) } },
  rejected: { times_sent: 0, dismissed: "rejected", ranks: { tooling: verdict(7, "aaa", "2026-10-04T10:00:00+00:00", true) } },
  expired: { times_sent: 0, dismissed: "expired", ranks: { tooling: verdict(6, "bbb", "2026-10-06T08:00:00+00:00", true) } },
  pending: {
    times_sent: 0,
    dismissed: null,
    ranks: {
      tooling: verdict(9, "bbb", "2026-10-06T09:00:00+00:00", true),
      web: verdict(3, "ccc", "2026-10-06T09:00:00+00:00", false),
    },
  },
  old: { times_sent: 0, dismissed: null, ranks: { tooling: verdict(2, "old", "2026-09-01T00:00:00+00:00", true) } },
  "pre-#6": { times_sent: 1, dismissed: null, ranks: {} },
};

const now = new Date("2026-10-06T12:00:00Z");

describe("buildOutcomes", () => {
  it("buckets queued items like agent/report.py", () => {
    const out = buildOutcomes(state, ["tooling"], now);
    expect(out).toMatchObject({ queued: 4, sent: 1, rejected: 1, expired: 1, pending: 1 });
    expect(out.histogram).toEqual([0, 0, 0, 0, 0, 1, 1, 1, 1, 0]);
  });

  it("counts verdicts per UTC day over the last 14 days", () => {
    const out = buildOutcomes(state, ["tooling"], now);
    expect(out.scoredPerDay).toHaveLength(14);
    expect(out.scoredPerDay[0]).toEqual({ day: "2026-09-23", count: 0 });
    expect(out.scoredPerDay.slice(-3)).toEqual([
      { day: "2026-10-04", count: 1 },
      { day: "2026-10-05", count: 1 },
      { day: "2026-10-06", count: 2 },
    ]);
  });

  it("adds topics together", () => {
    const out = buildOutcomes(state, ["tooling", "web"], now);
    expect(out.queued).toBe(4);
    expect(out.histogram[2]).toBe(1);
    expect(out.scoredPerDay.at(-1)).toEqual({ day: "2026-10-06", count: 3 });
  });
});

describe("topicVerdicts", () => {
  it("counts a topic's cached verdicts and names the newest rubric", () => {
    expect(topicVerdicts(state, ["tooling"])).toEqual({ count: 5, rubric: "bbb" });
    expect(topicVerdicts(state, ["nope"])).toEqual({ count: 0, rubric: null });
  });
});

describe("parseAgentState", () => {
  it("loads entries without ranks or dismissed, like dedupe.load_state", () => {
    expect(parseAgentState({ abc: { first_seen: "x", last_score: 3, times_sent: 0 } })).toEqual({
      abc: { times_sent: 0, dismissed: null, ranks: {} },
    });
  });

  it("keeps verdicts and drops fields the page doesn't use", () => {
    const parsed = parseAgentState({
      abc: {
        times_sent: 0,
        dismissed: null,
        ranks: { tooling: { relevance: 7, rubric: "r", ranked_at: "t", source_score: 80, summary: "s", queued_at: null } },
      },
    });
    expect(parsed?.abc.ranks.tooling).toEqual({ relevance: 7, rubric: "r", ranked_at: "t", queued_at: null });
  });

  it("rejects malformed files", () => {
    expect(parseAgentState([])).toBeNull();
    expect(parseAgentState({ abc: { times_sent: "1" } })).toBeNull();
    expect(parseAgentState({ abc: { times_sent: 0, dismissed: 3 } })).toBeNull();
    expect(parseAgentState({ abc: { times_sent: 0, ranks: { t: { relevance: "7", rubric: "r", ranked_at: "t" } } } })).toBeNull();
  });
});
