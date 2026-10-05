import { describe, expect, it, vi } from "vitest";
import {
  type Calendar,
  fetchCalendar,
  levelsOf,
  parseCalendar,
  placeCells,
  twinkle,
} from "./github-calendar";

function response(weeks: { date: string; contributionCount: number }[][], total = 7) {
  return {
    data: {
      user: {
        contributionsCollection: {
          contributionCalendar: {
            totalContributions: total,
            weeks: weeks.map((contributionDays) => ({ contributionDays })),
          },
        },
      },
    },
  };
}

const GOOD = response([
  [
    { date: "2026-09-23", contributionCount: 0 },
    { date: "2026-09-24", contributionCount: 3 },
  ],
  [{ date: "2026-09-27", contributionCount: 4 }],
]);

describe("parseCalendar", () => {
  it("keeps the total and every day, week by week", () => {
    expect(parseCalendar(GOOD)).toEqual({
      total: 7,
      weeks: [
        [
          { date: "2026-09-23", count: 0 },
          { date: "2026-09-24", count: 3 },
        ],
        [{ date: "2026-09-27", count: 4 }],
      ],
    });
  });

  it("drops keys it doesn't know", () => {
    const extra = response([[{ date: "2026-09-27", contributionCount: 1 }]]);
    const day = extra.data.user.contributionsCollection.contributionCalendar.weeks[0]
      .contributionDays[0] as Record<string, unknown>;
    day.color = "#39d353";
    expect(parseCalendar(extra)?.weeks[0][0]).toEqual({ date: "2026-09-27", count: 1 });
  });

  it("rejects an error response with no user", () => {
    expect(parseCalendar({ data: { user: null }, errors: [{ message: "nope" }] })).toBeNull();
    expect(parseCalendar({ message: "Bad credentials" })).toBeNull();
    expect(parseCalendar(null)).toBeNull();
  });

  it("rejects malformed days", () => {
    expect(parseCalendar(response([[{ date: "2026-9-27", contributionCount: 1 }]]))).toBeNull();
    expect(parseCalendar(response([[{ date: "2026-09-27", contributionCount: -1 }]]))).toBeNull();
    expect(parseCalendar(response([[{ date: "2026-09-27", contributionCount: 1.5 }]]))).toBeNull();
    expect(parseCalendar(response([]))).toBeNull();
  });

  it("rejects a bad total", () => {
    expect(parseCalendar(response([[{ date: "2026-09-27", contributionCount: 1 }]], -3))).toBeNull();
  });
});

describe("levelsOf", () => {
  it("keeps empty days at 0", () => {
    expect(levelsOf([0, 0, 0])).toEqual([0, 0, 0]);
  });

  it("splits active days into quartiles of the active days", () => {
    // Active counts 1..8: quartile cut-offs at 2, 4, 6.
    expect(levelsOf([0, 1, 2, 3, 4, 5, 6, 7, 8])).toEqual([0, 1, 1, 2, 2, 3, 3, 4, 4]);
  });

  it("isn't flattened by one huge day", () => {
    // GitHub's own levels are relative to the max, so a 100 would push
    // every other day to level 1.
    expect(levelsOf([2, 3, 5, 8, 100])).toEqual([1, 1, 2, 3, 4]);
  });

  it("puts identical active days on one level", () => {
    expect(levelsOf([5, 0, 5, 5])).toEqual([1, 0, 1, 1]);
  });
});

describe("placeCells", () => {
  it("puts weeks in columns and weekdays in rows, Sunday on top", () => {
    const cal: Calendar = {
      total: 3,
      weeks: [
        // 2026-09-23 is a Wednesday: a partial first week starts on row 3.
        [
          { date: "2026-09-23", count: 0 },
          { date: "2026-09-26", count: 1 },
        ],
        [{ date: "2026-09-27", count: 2 }],
      ],
    };
    expect(placeCells(cal.weeks)).toEqual([
      { col: 0, row: 3, date: "2026-09-23", count: 0, level: 0 },
      { col: 0, row: 6, date: "2026-09-26", count: 1, level: 1 },
      { col: 1, row: 0, date: "2026-09-27", count: 2, level: 4 },
    ]);
  });
});

describe("twinkle", () => {
  const year = Array.from({ length: 365 }, (_, i) =>
    new Date(Date.UTC(2025, 9, 1) + i * 86_400_000).toISOString().slice(0, 10),
  );

  it("is the same for the same day", () => {
    expect(twinkle("2026-09-30")).toEqual(twinkle("2026-09-30"));
  });

  it("stays in range, rounded to 0.1 s", () => {
    for (const date of year) {
      const t = twinkle(date);
      expect(t.duration).toBeGreaterThanOrEqual(6);
      expect(t.duration).toBeLessThanOrEqual(15);
      expect(t.delay).toBeGreaterThanOrEqual(0);
      expect(t.delay).toBeLessThanOrEqual(t.duration);
      expect(Math.round(t.duration * 10)).toBeCloseTo(t.duration * 10, 9);
    }
  });

  it("spreads across days: all tones, many rhythms", () => {
    const all = year.map(twinkle);
    expect(new Set(all.map((t) => t.tone))).toEqual(new Set([0, 1, 2]));
    expect(new Set(all.map((t) => t.duration)).size).toBeGreaterThan(40);
  });
});

describe("fetchCalendar", () => {
  const ok = (body: unknown) =>
    Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));

  it("skips the request without a token", async () => {
    const fetchImpl = vi.fn();
    expect(await fetchCalendar("hpnssflw", undefined, fetchImpl)).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("posts the query with the token and parses the answer", async () => {
    const fetchImpl = vi.fn(() => ok(GOOD));
    const cal = await fetchCalendar("hpnssflw", "t0ken", fetchImpl);
    expect(cal?.total).toBe(7);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.github.com/graphql");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe("bearer t0ken");
    expect(JSON.parse(init.body as string).variables).toEqual({ login: "hpnssflw" });
  });

  it("retries once after a network error", async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new Error("ECONNRESET"))
      .mockImplementationOnce(() => ok(GOOD));
    expect((await fetchCalendar("hpnssflw", "t0ken", fetchImpl))?.total).toBe(7);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("gives up with null after two failures or a non-200", async () => {
    const failing = vi.fn().mockRejectedValue(new Error("ECONNRESET"));
    expect(await fetchCalendar("hpnssflw", "t0ken", failing)).toBeNull();
    expect(failing).toHaveBeenCalledTimes(2);

    const denied = vi.fn(() => Promise.resolve(new Response("{}", { status: 401 })));
    expect(await fetchCalendar("hpnssflw", "t0ken", denied)).toBeNull();
  });
});
