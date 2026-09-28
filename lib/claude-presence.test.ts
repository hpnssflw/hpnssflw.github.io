import { describe, expect, it } from "vitest";
import {
  type Presence,
  effectiveState,
  isOwnerToday,
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

  it("goes offline once the file is older than 15 minutes", () => {
    expect(effectiveState(makePresence(), NOW + 12 * MIN)).toBe("offline");
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
