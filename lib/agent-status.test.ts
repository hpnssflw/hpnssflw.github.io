import { describe, expect, it } from "vitest";
import {
  type AgentStatus,
  fmtCountdown,
  isStale,
  nextRunAt,
  sparklineCells,
} from "./agent-status";

function makeStatus(overrides: Partial<AgentStatus> = {}): AgentStatus {
  return {
    cadence_hours: 4,
    email_cadence_hours: 24,
    streak: 1,
    pending_email_count: 0,
    updated_at: "2026-09-09T08:00:00+00:00",
    last_email_at: null,
    topics: [],
    funnel: {},
    recent_events: [],
    run_history: [],
    ...overrides,
  };
}

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
