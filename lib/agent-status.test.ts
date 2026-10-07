import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type AgentStatus,
  fmtCountdown,
  isStale,
  parseAgentStatus,
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

const good = makeStatus({
  last_sent_at: "2026-09-30T04:08:45.319706+00:00",
  topics: [{ slug: "tooling", name: "Tooling", collected: 3, kept: 1 }],
  funnel: { tooling: { collected: 3, in_window: 3, new: 2, kept: 1 } },
  run_history: [{ kept: 1, ts: "2026-09-09T08:00:00+00:00" }],
  recent_events: [
    { ts: "2026-09-09T08:00:00+00:00", verdict: "kept", topic: "tooling", title: "A tool", score: 7 },
    { ts: "2026-09-09T07:59:00+00:00", verdict: "drop", topic: "tooling", title: "Not a tool", reason: "below_threshold" },
  ],
});
const [keptEvent, dropEvent] = good.recent_events;

function without(key: keyof AgentStatus): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...good };
  delete copy[key];
  return copy;
}

describe("parseAgentStatus", () => {
  it("returns a well-formed payload unchanged", () => {
    expect(parseAgentStatus(good)).toStrictEqual(good);
  });

  it("passes unknown keys through (kept events carry source)", () => {
    const withSource = { ...good, recent_events: [{ ...keptEvent, source: "hacker_news" }] };
    expect(parseAgentStatus(withSource)).toStrictEqual(withSource);
  });

  it("rejects non-objects", () => {
    for (const value of [null, undefined, "nope", 3, []]) expect(parseAgentStatus(value)).toBeNull();
  });

  it.each([
    "cadence_hours",
    "delivery_cadence_hours",
    "streak",
    "pending_count",
    "updated_at",
    "last_sent_at",
    "topics",
    "funnel",
    "run_history",
    "recent_events",
  ] as (keyof AgentStatus)[])("rejects a payload without %s", (key) => {
    expect(parseAgentStatus(without(key))).toBeNull();
  });

  it("rejects wrong-typed top-level fields", () => {
    expect(parseAgentStatus({ ...good, streak: "1" })).toBeNull();
    expect(parseAgentStatus({ ...good, topics: {} })).toBeNull();
    expect(parseAgentStatus({ ...good, funnel: null })).toBeNull();
    expect(parseAgentStatus({ ...good, last_sent_at: 5 })).toBeNull();
  });

  it("rejects dates that don't parse", () => {
    expect(parseAgentStatus({ ...good, updated_at: "yesterday" })).toBeNull();
    expect(parseAgentStatus({ ...good, last_sent_at: "not a date" })).toBeNull();
    expect(parseAgentStatus({ ...good, run_history: [{ kept: 1, ts: "soon" }] })).toBeNull();
    expect(parseAgentStatus({ ...good, recent_events: [{ ...keptEvent, ts: "" }] })).toBeNull();
  });

  it("accepts last_sent_at null (nothing sent yet)", () => {
    expect(parseAgentStatus({ ...good, last_sent_at: null })).toStrictEqual({ ...good, last_sent_at: null });
  });

  it("rejects malformed entries inside the collections", () => {
    expect(parseAgentStatus({ ...good, topics: [{ slug: "tooling", collected: 3, kept: 1 }] })).toBeNull();
    expect(parseAgentStatus({ ...good, funnel: { tooling: { collected: 3, in_window: 3, kept: 1 } } })).toBeNull();
    expect(parseAgentStatus({ ...good, funnel: { ...good.funnel, retired: 5 } })).toBeNull();
    expect(parseAgentStatus({ ...good, run_history: [{ ts: "2026-09-09T08:00:00+00:00" }] })).toBeNull();
    expect(parseAgentStatus({ ...good, recent_events: [{ ...keptEvent, verdict: "maybe" }] })).toBeNull();
    expect(parseAgentStatus({ ...good, recent_events: [{ ...keptEvent, score: "7" }] })).toBeNull();
    expect(parseAgentStatus({ ...good, recent_events: [{ ...dropEvent, reason: 3 }] })).toBeNull();
    expect(parseAgentStatus({ ...good, recent_events: [{ ...dropEvent, title: undefined }] })).toBeNull();
  });

  it("rejects a topic with no funnel entry", () => {
    expect(parseAgentStatus({ ...good, funnel: {} })).toBeNull();
  });

  it.each(["toString", "__proto__", "constructor"])(
    "does not let the prototype satisfy topic slug %s with no own funnel entry",
    (slug) => {
      const topics = [{ slug, name: "Inherited", collected: 0, kept: 0 }];
      expect(parseAgentStatus({ ...good, topics, funnel: {} })).toBeNull();
    },
  );
});

describe("parseAgentStatus on the agent's golden status.json", () => {
  const goldenPath = join(process.cwd(), "agent", "tests", "fixtures", "tony", "golden", "real", "status.json");
  const golden = JSON.parse(readFileSync(goldenPath, "utf8")) as Record<string, unknown>;

  it("parses the agent's real run output (a drifted shape would blank every agent widget)", () => {
    const parsed = parseAgentStatus(golden);
    expect(parsed).not.toBeNull();
    expect(parsed?.drops).toStrictEqual(golden.drops);
    expect(parsed?.failures).toStrictEqual(golden.failures);
    expect(golden.drops).toBeDefined();
    expect(golden.failures).toBeDefined();
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

describe("parseAgentStatus — drops and failures", () => {
  const drops = { tooling: { dedupe: { seen: 2, already_ranked: 1 } } };
  const failures = [
    { stage: "collect", topic: "tooling", source: "github_trending" },
    { stage: "deliver", topic: null, source: null },
  ];

  it("leaves them absent when the payload has none (written before 2026-10)", () => {
    const status = parseAgentStatus(good);
    expect(status).not.toBeNull();
    expect(status).not.toHaveProperty("drops");
    expect(status).not.toHaveProperty("failures");
  });

  it("keeps well-formed drops and failures", () => {
    expect(parseAgentStatus({ ...good, drops, failures })).toStrictEqual({ ...good, drops, failures });
  });

  it.each([
    ["a non-number count", { tooling: { dedupe: { seen: "2" } } }],
    ["an array", []],
    ["an array of stages", { tooling: [] }],
  ])("strips drops with %s and keeps the rest", (_, bad) => {
    expect(parseAgentStatus({ ...good, drops: bad, failures })).toStrictEqual({ ...good, failures });
  });

  it.each([
    ["an object", {}],
    ["a numeric stage", [{ stage: 1, topic: null, source: null }]],
    ["a numeric topic", [{ stage: "rank", topic: 3, source: null }]],
  ])("strips failures with %s and keeps the rest", (_, bad) => {
    expect(parseAgentStatus({ ...good, drops, failures: bad })).toStrictEqual({ ...good, drops });
  });

  it("does not modify its input", () => {
    const input = { ...good, drops: [], failures };
    const before = structuredClone(input);
    parseAgentStatus(input);
    expect(input).toStrictEqual(before);
  });
});
