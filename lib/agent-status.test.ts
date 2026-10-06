import { describe, expect, it } from "vitest";
import {
  type AgentStatus,
  fmtCountdown,
  parseAgentStatus,
  isStale,
  nextRunAt,
  sparklineCells,
} from "./agent-status";

function makeStatus(overrides: Partial<AgentStatus> = {}): AgentStatus {
  return {
    cadence_hours: 4,
    delivery_cadence_hours: 24,
    streak: 1,
    pending_count: 0,
    updated_at: "2026-09-09T08:00:00+00:00",
    last_sent_at: null,
    topics: [],
    funnel: {},
    recent_events: [],
    run_history: [],
    ...overrides,
  };
}

describe("parseAgentStatus", () => {
  const good = makeStatus({
    topics: [{ slug: "ai-agents", name: "AI Agents", collected: 3, kept: 1 }],
    funnel: { "ai-agents": { collected: 3, in_window: 3, new: 2, kept: 1 } },
  });
  const event = {
    ts: "2026-10-06T10:11:06.285593+00:00",
    verdict: "drop",
    topic: "ai-agents",
    title: "x",
    reason: "over_max_items",
  };

  it("returns a well-formed payload unchanged", () => {
    expect(parseAgentStatus(good)).toEqual(good);
  });

  it("rejects non-objects and nulls", () => {
    expect(parseAgentStatus(null)).toBeNull();
    expect(parseAgentStatus("nope")).toBeNull();
    expect(parseAgentStatus(undefined)).toBeNull();
  });

  it("rejects missing or wrong-typed core fields", () => {
    expect(parseAgentStatus({ ...good, run_history: undefined })).toBeNull();
    expect(parseAgentStatus({ ...good, topics: {} })).toBeNull();
    expect(parseAgentStatus({ ...good, funnel: null })).toBeNull();
    expect(parseAgentStatus({ ...good, streak: "3" })).toBeNull();
  });

  it("rejects a topic with no matching funnel entry", () => {
    expect(parseAgentStatus({ ...good, funnel: {} })).toBeNull();
  });

  it("rejects an updated_at that isn't a date (M1)", () => {
    expect(parseAgentStatus({ ...good, updated_at: "yesterday" })).toBeNull();
    expect(parseAgentStatus({ ...good, updated_at: 1 })).toBeNull();
  });

  it("turns an unparseable last_sent_at into null", () => {
    expect(parseAgentStatus({ ...good, last_sent_at: "soon" })?.last_sent_at).toBeNull();
    expect(parseAgentStatus({ ...good, last_sent_at: "2026-09-30T04:08:45.319706+00:00" })?.last_sent_at).toBe(
      "2026-09-30T04:08:45.319706+00:00",
    );
  });

  it("leaves out history and event entries with a bad date or shape", () => {
    const kept = { kept: 1, ts: "2026-10-06T10:10:42.237399+00:00" };
    const parsed = parseAgentStatus({
      ...good,
      run_history: [kept, { kept: 2, ts: "nope" }, { ts: "2026-10-06T10:00:00Z" }],
      recent_events: [event, { ...event, ts: "" }, { ...event, verdict: "maybe" }],
    });
    expect(parsed?.run_history).toEqual([kept]);
    expect(parsed?.recent_events).toEqual([event]);
  });
});

describe("isStale", () => {
  const status = makeStatus({ updated_at: "2026-09-09T08:00:00+00:00" });
  const updated = Date.parse("2026-09-09T08:00:00+00:00");

  it("is fresh within two cadence windows", () => {
    expect(isStale(status, updated + 7 * 3600 * 1000)).toBe(false);
  });

  it("is stale past two cadence windows", () => {
    expect(isStale(status, updated + 9 * 3600 * 1000)).toBe(true);
  });
});

describe("fmtCountdown", () => {
  it("zero-pads h:m:s", () => {
    expect(fmtCountdown(3661)).toBe("01:01:01");
    expect(fmtCountdown(45)).toBe("00:00:45");
  });

  it("collapses non-positive values to 'due now'", () => {
    expect(fmtCountdown(0)).toBe("due now");
    expect(fmtCountdown(-30)).toBe("due now");
  });
});

describe("sparklineCells", () => {
  it("returns nothing for empty history", () => {
    expect(sparklineCells([])).toEqual([]);
  });

  it("marks zero-kept runs and scales the rest to the max", () => {
    const cells = sparklineCells([
      { kept: 0, ts: "" },
      { kept: 1, ts: "" },
      { kept: 4, ts: "" },
    ]);
    expect(cells[0]).toEqual({ glyph: "▁", zero: true });
    expect(cells[1].zero).toBe(false);
    expect(cells[2]).toEqual({ glyph: "█", zero: false });
  });
});

describe("nextRunAt", () => {
  it("is updated_at plus one cadence window", () => {
    const status = makeStatus({
      updated_at: "2026-09-09T08:00:00+00:00",
      cadence_hours: 4,
    });
    expect(nextRunAt(status)).toBe(Date.parse("2026-09-09T12:00:00+00:00"));
  });
});

describe("parseAgentStatus — drops and failures", () => {
  const base = makeStatus({
    topics: [{ slug: "tooling", name: "Tooling", collected: 3, kept: 1 }],
    funnel: { tooling: { collected: 3, in_window: 3, new: 2, kept: 1 } },
  });

  it("accepts a payload without them (written before the agent change)", () => {
    expect(parseAgentStatus(base)).toEqual(base);
  });

  it("keeps well-formed drops and failures", () => {
    const full = {
      ...base,
      drops: { tooling: { dedupe: { seen: 2, already_ranked: 1 } } },
      failures: [
        { stage: "collect", topic: "tooling", source: "github_trending" },
        { stage: "deliver", topic: null, source: null },
      ],
    };
    expect(parseAgentStatus(full)).toEqual(full);
  });

  it("leaves out malformed drops but keeps the status (M2)", () => {
    for (const drops of [{ tooling: { dedupe: { seen: "2" } } }, [], { tooling: [] }]) {
      const parsed = parseAgentStatus({ ...base, drops });
      expect(parsed).not.toBeNull();
      expect(parsed).not.toHaveProperty("drops");
      expect(parsed?.streak).toBe(base.streak);
    }
  });

  it("leaves out malformed failures but keeps the status (M2)", () => {
    for (const failures of [{}, [{ stage: 1, topic: null, source: null }], [{ stage: "rank", topic: 3, source: null }]]) {
      const parsed = parseAgentStatus({ ...base, failures });
      expect(parsed).not.toBeNull();
      expect(parsed).not.toHaveProperty("failures");
    }
  });
});
