import { describe, expect, it } from "vitest";
import {
  type Presence,
  effectiveState,
  isOwnerToday,
  meterCells,
  parsePresence,
  presenceView,
} from "./claude-presence";

const MIN = 60_000;
const NOW = Date.parse("2026-09-28T07:34:00.000Z"); // 10:34 in Moscow
const AFTER_MOSCOW_MIDNIGHT = Date.parse("2026-09-28T21:05:00.000Z"); // 00:05 on the 29th

function makePresence(overrides: Partial<Presence> = {}): Presence {
  return {
    v: 1,
    state: "working",
    since: "2026-09-28T06:14:00.000Z",
    lastActive: "2026-09-28T07:33:00.000Z",
    todayMinutes: 220,
    sessionsToday: 4,
    model: "opus",
    day: "2026-09-28",
    tz: "Europe/Moscow",
    updatedAt: "2026-09-28T07:30:00.000Z",
    ...overrides,
  };
}

describe("parsePresence", () => {
  it("accepts a valid v1 payload", () => {
    expect(parsePresence(makePresence())).toEqual(makePresence());
  });

  it("accepts nulls where the contract allows them", () => {
    const p = makePresence({ state: "offline", since: null, lastActive: null, model: null });
    expect(parsePresence(p)).toEqual(p);
  });

  it.each([
    ["a wrong version", { v: 2 }],
    ["an unknown state", { state: "sleeping" }],
    ["an unknown model", { model: "gpt" }],
    ["fractional minutes", { todayMinutes: 1.5 }],
    ["negative sessions", { sessionsToday: -1 }],
    ["a bad updatedAt", { updatedAt: "yesterday" }],
    ["a bad since", { since: "soon" }],
    ["a bad day", { day: "28.09.2026" }],
    ["an empty tz", { tz: "" }],
  ])("rejects %s", (_label, override) => {
    expect(parsePresence({ ...makePresence(), ...override })).toBeNull();
  });

  it("rejects non-objects and missing keys", () => {
    expect(parsePresence(null)).toBeNull();
    expect(parsePresence("x")).toBeNull();
    expect(parsePresence([])).toBeNull();
    const noSince = { ...makePresence(), since: undefined };
    expect(parsePresence(noSince)).toBeNull();
  });

  it("drops unknown extra keys", () => {
    expect(parsePresence({ ...makePresence(), cwd: "C:\\secret" })).not.toHaveProperty("cwd");
  });
});

describe("effectiveState", () => {
  it("keeps the published state while fresh", () => {
    expect(effectiveState(makePresence(), NOW)).toBe("working");
  });

  // updatedAt is 4 minutes before NOW.
  it("stays live up to exactly 20 minutes old", () => {
    expect(effectiveState(makePresence(), NOW + 16 * MIN)).toBe("working");
  });

  it("goes offline once the file is older than 20 minutes", () => {
    expect(effectiveState(makePresence(), NOW + 16 * MIN + 1)).toBe("offline");
    expect(effectiveState(makePresence(), NOW + 17 * MIN)).toBe("offline");
  });
});

describe("isOwnerToday", () => {
  it("matches the owner's date in their zone", () => {
    expect(isOwnerToday("2026-09-28", "Europe/Moscow", NOW)).toBe(true);
  });

  it("rolls over at the owner's midnight, not UTC's", () => {
    expect(isOwnerToday("2026-09-28", "Europe/Moscow", AFTER_MOSCOW_MIDNIGHT)).toBe(false);
    expect(isOwnerToday("2026-09-28", "UTC", AFTER_MOSCOW_MIDNIGHT)).toBe(true);
  });

  it("is false for an invalid zone", () => {
    expect(isOwnerToday("2026-09-28", "Not/AZone", NOW)).toBe(false);
  });
});

describe("presenceView", () => {
  it("working: how long the current stretch has run", () => {
    expect(presenceView(makePresence(), NOW)).toEqual({
      state: "working",
      headline: "working · for 1h 20m",
      today: "today 3h 40m · 4 sessions",
      footer: "opus · updated 4 min ago",
    });
  });

  it("waiting without a since has a bare headline", () => {
    expect(presenceView(makePresence({ state: "waiting", since: null }), NOW).headline).toBe(
      "waiting",
    );
  });

  it("a stale file reads as offline with last active", () => {
    const view = presenceView(makePresence(), NOW + 120 * MIN);
    expect(view.state).toBe("offline");
    expect(view.headline).toBe("offline · last active 2h ago");
  });

  it("offline with no lastActive has a bare headline", () => {
    const p = makePresence({ state: "offline", since: null, lastActive: null });
    expect(presenceView(p, NOW).headline).toBe("offline");
  });

  it("hides today once it's a new day for the owner", () => {
    expect(presenceView(makePresence(), AFTER_MOSCOW_MIDNIGHT).today).toBeNull();
  });

  it("hides today when there were no sessions", () => {
    const p = makePresence({ todayMinutes: 0, sessionsToday: 0 });
    expect(presenceView(p, NOW).today).toBeNull();
  });

  it("uses the singular for one session", () => {
    const p = makePresence({ todayMinutes: 45, sessionsToday: 1 });
    expect(presenceView(p, NOW).today).toBe("today 45m · 1 session");
  });

  it("omits a null model from the footer", () => {
    expect(presenceView(makePresence({ model: null }), NOW).footer).toBe("updated 4 min ago");
  });
});

describe("meterCells", () => {
  const CODE = { on: "o", part: "p", off: "-" } as const;
  const fills = (cells: ReturnType<typeof meterCells>) => cells.map((c) => CODE[c.fill]).join("");
  const live = (cells: ReturnType<typeof meterCells>) => cells.findIndex((c) => c.live);

  it("is 24 cells, one per hour of today's active time", () => {
    const cells = meterCells(15 * 60 + 8, "offline");
    expect(cells).toHaveLength(24);
    // 15 full hours, a partial 16th, the rest off.
    expect(fills(cells)).toBe("o".repeat(15) + "p" + "-".repeat(8));
    expect(live(cells)).toBe(-1);
  });

  it("marks the last lit cell live while a session is on", () => {
    expect(live(meterCells(15 * 60 + 8, "working"))).toBe(15);
    expect(live(meterCells(3 * 60, "waiting"))).toBe(2);
  });

  it("shows a just-started session as one live partial cell", () => {
    const cells = meterCells(0, "working");
    expect(fills(cells)).toBe("p" + "-".repeat(23));
    expect(live(cells)).toBe(0);
  });

  it("is all off with no time today and nothing running", () => {
    expect(fills(meterCells(0, "offline"))).toBe("-".repeat(24));
  });

  it("never overflows the day", () => {
    expect(fills(meterCells(30 * 60, "working"))).toBe("o".repeat(24));
    expect(live(meterCells(30 * 60, "working"))).toBe(23);
  });
});
