import { describe, expect, it } from "vitest";
import {
  type Presence,
  effectiveState,
  isOwnerToday,
  parsePresence,
  presenceView,
  recentDays,
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
    dailyMinutes: [...Array(27).fill(0), 220],
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

  it("reads a file without dailyMinutes (an older runner) as no history", () => {
    const { dailyMinutes: _d, ...old } = makePresence();
    expect(parsePresence(old)?.dailyMinutes).toBeNull();
  });

  it.each([
    ["27 days", Array(27).fill(1)],
    ["29 days", Array(29).fill(1)],
    ["a fractional day", [...Array(27).fill(0), 1.5]],
    ["a negative day", [...Array(27).fill(0), -1]],
    ["more than a day of minutes", [...Array(27).fill(0), 1441]],
    ["a string", "1,2,3"],
    ["a nested array", [...Array(27).fill(0), [1]]],
  ])("rejects dailyMinutes with %s", (_label, dailyMinutes) => {
    expect(parsePresence({ ...makePresence(), dailyMinutes })).toBeNull();
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

describe("recentDays", () => {
  const minutes = Array.from({ length: 28 }, (_, i) => i * 10); // 0, 10, …, 270

  it("lays the 28 days out oldest first, the owner's today last", () => {
    const days = recentDays(makePresence({ dailyMinutes: minutes }), NOW);
    expect(days).toHaveLength(28);
    expect(days.map((d) => d.minutes)).toEqual(minutes);
    expect(days[27]).toMatchObject({ date: "2026-09-28", today: true });
    expect(days[0]).toMatchObject({ date: "2026-09-01", today: false });
    expect(days[0].level).toBe(0); // 0 minutes
    expect(days[27].level).toBe(4); // the busiest day
  });

  it("shifts a file from yesterday by a day, with nothing for today yet", () => {
    const days = recentDays(makePresence({ dailyMinutes: minutes }), AFTER_MOSCOW_MIDNIGHT);
    expect(days.map((d) => d.minutes)).toEqual([...minutes.slice(1), 0]);
    expect(days[27]).toMatchObject({ date: "2026-09-29", today: true, minutes: 0 });
  });

  it("is all empty for a file four weeks old or more", () => {
    const later = NOW + 30 * 24 * 60 * MIN;
    expect(recentDays(makePresence({ dailyMinutes: minutes }), later).every((d) => d.minutes === 0)).toBe(true);
  });

  it("falls back to today's minutes alone without history", () => {
    const days = recentDays(makePresence({ dailyMinutes: null }), NOW);
    expect(days.map((d) => d.minutes)).toEqual([...Array(27).fill(0), 220]);
  });
});
