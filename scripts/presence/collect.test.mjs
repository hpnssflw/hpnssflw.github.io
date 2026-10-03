import { describe, expect, it } from "vitest";
import { DAILY_DAYS as SITE_DAILY_DAYS, MODELS, parsePresence } from "../../lib/claude-presence.ts";
import {
  MODEL_FAMILIES,
  PLAYLIST_KEYS,
  PRESENCE_KEYS,
  assertPublishable,
  DAILY_DAYS,
  buildPresence,
  dailyMinutes,
  deriveState,
  isSubagentTranscript,
  localDayInfo,
  mergeActivity,
  modelFamily,
  pastDayStarts,
  shouldPublish,
  totalMinutes,
  trimPlaylists,
} from "./collect.mjs";

const MIN = 60_000;
// Stand-in for a local midnight; every function takes it as an input.
const DAY_START = Date.UTC(2026, 8, 28, 0, 0);
const at = (h, m) => DAY_START + (h * 60 + m) * MIN;
const iso = (ms) => new Date(ms).toISOString();

describe("deriveState", () => {
  it("is working when any session is busy", () => {
    const agents = [{ status: "idle" }, { status: "busy" }];
    expect(deriveState({ agents, lastActiveMs: null, nowMs: at(10, 0) })).toBe("working");
  });

  it("is waiting when idle but active within 15 minutes", () => {
    const agents = [{ status: "idle" }];
    expect(deriveState({ agents, lastActiveMs: at(9, 45), nowMs: at(10, 0) })).toBe("waiting");
  });

  it("is offline when idle and the last activity is older", () => {
    const agents = [{ status: "idle" }];
    expect(deriveState({ agents, lastActiveMs: at(9, 44), nowMs: at(10, 0) })).toBe("offline");
  });

  it("treats a days-old idle session as offline", () => {
    const agents = [{ status: "idle" }];
    const threeDaysAgo = at(9, 0) - 3 * 24 * 60 * MIN;
    expect(deriveState({ agents, lastActiveMs: threeDaysAgo, nowMs: at(10, 0) })).toBe("offline");
  });

  it("is offline with no sessions and no activity", () => {
    expect(deriveState({ agents: [], lastActiveMs: null, nowMs: at(10, 0) })).toBe("offline");
  });
});

describe("mergeActivity / totalMinutes", () => {
  const opts = { dayStartMs: DAY_START };

  it("merges events closer than the gap", () => {
    const intervals = mergeActivity([at(9, 0), at(9, 10), at(9, 20)], opts);
    expect(intervals).toEqual([{ start: at(9, 0), end: at(9, 20) }]);
    expect(totalMinutes(intervals)).toBe(20);
  });

  it("splits on a gap longer than 15 minutes", () => {
    const intervals = mergeActivity([at(9, 0), at(9, 10), at(9, 40), at(9, 50)], opts);
    expect(intervals).toEqual([
      { start: at(9, 0), end: at(9, 10) },
      { start: at(9, 40), end: at(9, 50) },
    ]);
    expect(totalMinutes(intervals)).toBe(20);
  });

  it("treats exactly 15 minutes as the same stretch", () => {
    expect(mergeActivity([at(9, 0), at(9, 15)], opts)).toHaveLength(1);
  });

  it("clips events before the day start", () => {
    expect(mergeActivity([DAY_START - 5 * MIN, at(0, 5)], opts)).toEqual([
      { start: at(0, 5), end: at(0, 5) },
    ]);
  });

  it("counts a lone event as zero minutes", () => {
    expect(totalMinutes(mergeActivity([at(9, 0)], opts))).toBe(0);
  });

  it("sorts unsorted input", () => {
    expect(mergeActivity([at(9, 10), at(9, 0)], opts)).toEqual([
      { start: at(9, 0), end: at(9, 10) },
    ]);
  });
});

describe("modelFamily", () => {
  it("maps model ids to families", () => {
    expect(modelFamily("claude-opus-5-5")).toBe("opus");
    expect(modelFamily("claude-sonnet-5")).toBe("sonnet");
    expect(modelFamily("claude-haiku-4-5-20251001")).toBe("haiku");
    expect(modelFamily("claude-fable-5-1")).toBe("fable");
  });

  it("returns null for anything else", () => {
    expect(modelFamily("<synthetic>")).toBeNull();
    expect(modelFamily(undefined)).toBeNull();
    expect(modelFamily(42)).toBeNull();
  });
});

describe("isSubagentTranscript", () => {
  it("matches a transcript under a subagents directory, either separator", () => {
    const session = "C--A-polozov\\80a18c76-234c-4cbc-ae11-5f73f88a0833";
    expect(isSubagentTranscript(`${session}\\subagents\\agent-a5082db3cd24d77e7.jsonl`)).toBe(true);
    expect(
      isSubagentTranscript("-home-artem-polozov/80a18c76/subagents/agent-a5082db3.jsonl"),
    ).toBe(true);
    expect(
      isSubagentTranscript("C:\\Users\\tigri\\.claude\\projects\\C--A\\s1\\subagents\\a.jsonl"),
    ).toBe(true);
  });

  it("does not match a main-session transcript", () => {
    expect(isSubagentTranscript("C--A-polozov\\80a18c76-234c-4cbc.jsonl")).toBe(false);
    expect(isSubagentTranscript("-home-artem-polozov/80a18c76.jsonl")).toBe(false);
  });

  it("does not match a project dir merely named like subagents", () => {
    expect(isSubagentTranscript("C--A-subagents-foo\\80a18c76.jsonl")).toBe(false);
    expect(isSubagentTranscript("C--A-my-subagents/80a18c76.jsonl")).toBe(false);
    expect(isSubagentTranscript("C--A\\s1\\subagents-foo\\a.jsonl")).toBe(false);
    expect(isSubagentTranscript("C--A/s1/mysubagents/a.jsonl")).toBe(false);
  });

  it("is false for a non-string", () => {
    expect(isSubagentTranscript(undefined)).toBe(false);
  });
});

describe("shouldPublish", () => {
  const same = { playlistsChanged: false };

  it("skips only offline → offline when the playlists are unchanged", () => {
    expect(shouldPublish({ prevState: "offline", nextState: "offline", ...same })).toBe(false);
    expect(shouldPublish({ prevState: "working", nextState: "offline", ...same })).toBe(true);
    expect(shouldPublish({ prevState: null, nextState: "offline", ...same })).toBe(true);
    expect(shouldPublish({ prevState: "offline", nextState: "working", ...same })).toBe(true);
  });

  it("publishes offline → offline when the playlists changed", () => {
    expect(
      shouldPublish({ prevState: "offline", nextState: "offline", playlistsChanged: true }),
    ).toBe(true);
  });

  it("publishes offline → offline when the last push never landed", () => {
    const offline = { prevState: "offline", nextState: "offline", ...same };
    expect(shouldPublish({ ...offline, unpushed: true })).toBe(true);
    expect(shouldPublish({ ...offline, unpushed: false })).toBe(false);
  });
});

describe("localDayInfo", () => {
  it("returns the machine-local date and midnight", () => {
    const now = new Date(2026, 8, 28, 10, 30).getTime();
    expect(localDayInfo(now)).toEqual({
      day: "2026-09-28",
      dayStartMs: new Date(2026, 8, 28).getTime(),
    });
  });
});

describe("pastDayStarts", () => {
  it("gives the local midnights of the n days before today, then today's", () => {
    const today = new Date(2026, 8, 28).getTime();
    const starts = pastDayStarts(today, 27);
    expect(starts).toHaveLength(28);
    expect(starts[0]).toBe(new Date(2026, 8, 1).getTime());
    expect(starts[26]).toBe(new Date(2026, 8, 27).getTime());
    expect(starts[27]).toBe(today);
  });
});

describe("dailyMinutes", () => {
  it("sums each day's merged activity separately", () => {
    const d0 = DAY_START - 2 * 24 * 60 * MIN;
    const d1 = DAY_START - 24 * 60 * MIN;
    const day = (start, h, m) => start + (h * 60 + m) * MIN;
    const ts = [
      day(d0, 9, 0), day(d0, 9, 10), day(d0, 9, 20), day(d0, 9, 30), // 30 min, gaps under 15
      day(d1, 23, 50), day(d1, 23, 59), // 9 min — the day boundary splits it
      DAY_START + 5 * MIN, // today: outside the range, ignored
      d0 - MIN, // before the range, ignored
    ];
    expect(dailyMinutes(ts, [d0, d1, DAY_START])).toEqual([30, 9]);
  });

  it("is zero for days without activity", () => {
    const d1 = DAY_START - 24 * 60 * MIN;
    expect(dailyMinutes([], [d1, DAY_START])).toEqual([0]);
  });
});

describe("buildPresence", () => {
  const base = {
    agents: [{ status: "busy" }],
    events: [
      { ts: at(9, 0), sessionId: "s1", model: "claude-sonnet-5" },
      { ts: at(9, 10), sessionId: "s1", model: "claude-opus-5-5" },
      { ts: at(10, 0), sessionId: "s2", model: "<synthetic>" },
      { ts: at(10, 5), sessionId: "s2", model: null },
    ],
    nowMs: at(10, 7) + 30_000,
    dayStartMs: DAY_START,
    day: "2026-09-28",
    tz: "Europe/Moscow",
    prevLastActive: null,
  };

  it("builds the v1 object", () => {
    expect(buildPresence(base)).toEqual({
      v: 1,
      state: "working",
      since: iso(at(10, 0)),
      lastActive: iso(at(10, 5)),
      todayMinutes: 15, // 9:00–9:10 plus 10:00–10:05
      sessionsToday: 2,
      model: "opus", // latest recognised model; <synthetic> is skipped
      day: "2026-09-28",
      tz: "Europe/Moscow",
      updatedAt: iso(at(10, 7)), // floored to the minute
      dailyMinutes: [...Array(27).fill(0), 15], // no past days given; today last
    });
  });

  it("ends dailyMinutes with today, after the 27 past days it was given", () => {
    const past = Array.from({ length: 27 }, (_, i) => i * 10);
    const out = buildPresence({ ...base, pastMinutes: past });
    expect(out.dailyMinutes).toEqual([...past, 15]);
    expect(out.dailyMinutes).toHaveLength(DAILY_DAYS);
  });

  it("ignores past days that aren't 27 non-negative integers", () => {
    for (const bad of [[1, 2, 3], Array(27).fill(-1), Array(27).fill(1.5), "nope", null]) {
      expect(buildPresence({ ...base, pastMinutes: bad }).dailyMinutes).toEqual([
        ...Array(27).fill(0),
        15,
      ]);
    }
  });

  it("has no since when offline", () => {
    const out = buildPresence({ ...base, agents: [{ status: "idle" }], nowMs: at(12, 0) });
    expect(out.state).toBe("offline");
    expect(out.since).toBeNull();
    expect(out.lastActive).toBe(iso(at(10, 5)));
  });

  it("falls back to the previous lastActive when nothing happened today", () => {
    const out = buildPresence({
      ...base,
      agents: [],
      events: [],
      prevLastActive: "2026-09-27T21:40:00.000Z",
    });
    expect(out).toMatchObject({
      state: "offline",
      lastActive: "2026-09-27T21:40:00.000Z",
      todayMinutes: 0,
      sessionsToday: 0,
      model: null,
    });
  });

  it("never leaks anything outside the allowlist", () => {
    const secrets = [
      "C:\\A\\secret-client-repo",
      "c--CODE-secret-client-frontend",
      "feature/secret-branch",
      "fix the auth bug in payments",
      "bdc066e9-59e9-43df-8b22-9969ae67e644",
      "secret-session-name",
    ];
    const [cwd, projectDir, branch, promptText, sessionId, name] = secrets;
    const poisoned = {
      ...base,
      agents: [{ status: "busy", cwd, name, sessionId, pid: 21372 }],
      events: base.events.map((e) => ({
        ...e,
        sessionId,
        cwd,
        project: projectDir,
        gitBranch: branch,
        text: promptText,
      })),
    };
    const out = buildPresence(poisoned);
    expect(Object.keys(out).sort()).toEqual([...PRESENCE_KEYS].sort());
    const json = JSON.stringify(out);
    for (const secret of secrets) expect(json).not.toContain(secret);
    expect(json).not.toContain("21372");
  });
});

describe("presence.json contract: collect.mjs vs lib/claude-presence.ts", () => {
  const inputs = {
    agents: [{ status: "busy" }],
    events: [{ ts: at(9, 0), sessionId: "s1", model: "claude-opus-5-5" }],
    nowMs: at(9, 5),
    dayStartMs: DAY_START,
    day: "2026-09-28",
    tz: "Europe/Moscow",
    prevLastActive: null,
  };

  it("parsePresence accepts buildPresence output and keeps exactly PRESENCE_KEYS", () => {
    const parsed = parsePresence(JSON.parse(JSON.stringify(buildPresence(inputs))));
    expect(parsed).not.toBeNull();
    expect(Object.keys(parsed).sort()).toEqual([...PRESENCE_KEYS].sort());
  });

  it("both sides count the same number of days", () => {
    expect(SITE_DAILY_DAYS).toBe(DAILY_DAYS);
    expect(parsePresence(buildPresence(inputs))?.dailyMinutes).toHaveLength(DAILY_DAYS);
  });

  it("both sides know the same model families", () => {
    expect([...MODELS].sort()).toEqual([...MODEL_FAMILIES].sort());
    for (const family of MODEL_FAMILIES) {
      const events = [{ ts: at(9, 0), sessionId: "s1", model: `claude-${family}-9` }];
      const built = buildPresence({ ...inputs, events });
      expect(built.model).toBe(family);
      expect(parsePresence(built)?.model).toBe(family);
    }
  });
});

describe("trimPlaylists", () => {
  // Shape of the real GET /users/tmkplzv/playlists/list response (2026-09-28),
  // extra keys abbreviated; the second playlist is a made-up private one.
  const RAW = {
    invocationInfo: { "req-id": "1790576806261179", hostname: "music-web-default" },
    result: [
      {
        owner: {
          uid: 1659591274,
          login: "tmkplzv",
          name: "Artem Polozov",
          sex: "unknown",
          verified: false,
        },
        uid: 1659591274,
        kind: 1001,
        revision: 812,
        title: "siick vibin on a daily basis",
        playlistUuid: "f5db5527-5d0e-50fa-9f52-ee32cf758900",
        visibility: "public",
        trackCount: 265,
        durationMs: 48357650,
        modified: "2026-09-28T05:06:23+00:00",
        likesCount: 3,
        tags: [],
        derivedColors: { average: "#6b5a4e" },
        cover: {
          type: "mosaic",
          itemsUri: [
            "avatars.yandex.net/get-music-content/97284/666ef04f.a.5907678-1/%%",
            "avatars.yandex.net/get-music-content/20622967/0b58311f.a.43768630-1/%%",
          ],
          custom: false,
          version: "1590764633470",
        },
      },
      {
        owner: { uid: 1659591274, login: "tmkplzv", name: "Artem Polozov" },
        kind: 1003,
        title: "secret mix",
        playlistUuid: "0a1b2c3d-0000-4000-8000-000000000000",
        visibility: "private",
        trackCount: 5,
        durationMs: 1000000,
        modified: "2026-09-27T10:00:00+00:00",
      },
    ],
  };

  it("keeps public playlists and only the allowlisted keys", () => {
    expect(trimPlaylists(RAW)).toEqual({
      result: [
        {
          playlistUuid: "f5db5527-5d0e-50fa-9f52-ee32cf758900",
          title: "siick vibin on a daily basis",
          visibility: "public",
          trackCount: 265,
          durationMs: 48357650,
          modified: "2026-09-28T05:06:23+00:00",
          cover: {
            type: "mosaic",
            itemsUri: [
              "avatars.yandex.net/get-music-content/97284/666ef04f.a.5907678-1/%%",
              "avatars.yandex.net/get-music-content/20622967/0b58311f.a.43768630-1/%%",
            ],
          },
        },
      ],
    });
  });

  it("never leaks anything outside the allowlist", () => {
    const out = trimPlaylists(RAW);
    expect(Object.keys(out)).toEqual(["result"]);
    for (const item of out.result) {
      expect(Object.keys(item).sort()).toEqual([...PLAYLIST_KEYS].sort());
      expect(Object.keys(item.cover).sort()).toEqual(["itemsUri", "type"]);
    }
    const json = JSON.stringify(out);
    for (const secret of ["1659591274", "tmkplzv", "Artem Polozov", "secret mix", "owner"]) {
      expect(json).not.toContain(secret);
    }
  });

  it("drops wrongly typed fields instead of copying them", () => {
    const [item] = RAW.result;
    const uri = (n) => `avatars.yandex.net/get-music-content/${n}/a/%%`;
    const out = trimPlaylists({
      result: [
        {
          ...item,
          title: { evil: "object" },
          trackCount: "265",
          cover: { type: "mosaic", itemsUri: [uri(1), 42, uri(2), uri(3), uri(4), uri(5)] },
        },
      ],
    });
    expect(out.result[0]).not.toHaveProperty("title");
    expect(out.result[0]).not.toHaveProperty("trackCount");
    expect(out.result[0].cover.itemsUri).toEqual([uri(1), uri(2), uri(3), uri(4)]);
  });

  it("keeps only avatars.yandex.net cover URIs", () => {
    const [item] = RAW.result;
    const kept = "avatars.yandex.net/get-music-content/97284/666ef04f.a.5907678-1/%%";
    const itemsUri = [
      "evil.example/get-music-content/1/%%",
      "avatars.yandex.net.evil.example/x/%%",
      "https://avatars.yandex.net/x/%%",
      "//evil.example/avatars.yandex.net/%%",
      "",
      kept,
    ];
    const out = trimPlaylists({ result: [{ ...item, cover: { type: "mosaic", itemsUri } }] });
    expect(out.result[0].cover.itemsUri).toEqual([kept]);
  });

  it("keeps an empty list distinct from garbage", () => {
    expect(trimPlaylists({ result: [] })).toEqual({ result: [] });
    expect(trimPlaylists({ result: ["not an object", null] })).toEqual({ result: [] });
  });

  it("returns null for garbage", () => {
    expect(trimPlaylists(null)).toBeNull();
    expect(trimPlaylists("x")).toBeNull();
    expect(trimPlaylists({})).toBeNull();
    expect(trimPlaylists({ result: "nope" })).toBeNull();
  });
});

describe("assertPublishable", () => {
  // What run.mjs checks: the published text, parsed back.
  const roundTrip = (value) => JSON.parse(JSON.stringify(value));
  const presence = roundTrip(
    buildPresence({
      agents: [{ status: "busy" }],
      events: [
        { ts: at(9, 0), sessionId: "s1", model: "claude-opus-5-5" },
        { ts: at(9, 20), sessionId: "s1", model: null },
      ],
      nowMs: at(9, 21),
      dayStartMs: DAY_START,
      day: "2026-09-28",
      tz: "Europe/Moscow",
      prevLastActive: null,
    }),
  );
  const playlists = roundTrip(
    trimPlaylists({
      result: [
        {
          owner: { uid: 1659591274, login: "tmkplzv" },
          title: "siick vibin on a daily basis",
          playlistUuid: "f5db5527-5d0e-50fa-9f52-ee32cf758900",
          visibility: "public",
          trackCount: 265,
          durationMs: 48357650,
          modified: "2026-09-28T05:06:23+00:00",
          cover: {
            type: "mosaic",
            itemsUri: ["avatars.yandex.net/get-music-content/97284/666ef04f.a.5907678-1/%%"],
            custom: false,
          },
        },
      ],
    }),
  );
  const [item] = playlists.result;
  const check = (overrides) => () => assertPublishable({ presence, playlists, ...overrides });

  it("passes the real buildPresence and trimPlaylists output", () => {
    expect(check({})).not.toThrow();
    expect(check({ playlists: null })).not.toThrow();
    expect(check({ playlists: { result: [] } })).not.toThrow();
  });

  it("fails on an extra or a missing presence key", () => {
    expect(check({ presence: { ...presence, cwd: "C:\\A\\secret" } })).toThrow(/presence\.json keys/);
    const { tz: _tz, ...missing } = presence;
    expect(check({ presence: missing })).toThrow(/presence\.json keys/);
  });

  it("fails on a nested object where a presence scalar belongs", () => {
    expect(check({ presence: { ...presence, model: { id: "x" } } })).toThrow(/presence\.json/);
    expect(check({ presence: { ...presence, day: ["2026-09-28"] } })).toThrow(/presence\.json/);
  });

  it("fails on a dailyMinutes that isn't exactly 28 non-negative integers", () => {
    const bad = [
      presence.dailyMinutes.slice(1),
      [...presence.dailyMinutes, 0],
      presence.dailyMinutes.map((n, i) => (i === 3 ? 1.5 : n)),
      presence.dailyMinutes.map((n, i) => (i === 3 ? -1 : n)),
      presence.dailyMinutes.map((n, i) => (i === 3 ? "C:\\A\\secret" : n)),
      presence.dailyMinutes.map((n, i) => (i === 3 ? [n] : n)),
      "30,40",
      null,
    ];
    for (const dailyMinutes of bad) {
      expect(check({ presence: { ...presence, dailyMinutes } })).toThrow(/dailyMinutes/);
    }
  });

  it("fails on an extra top-level playlists key", () => {
    expect(check({ playlists: { ...playlists, invocationInfo: { hostname: "x" } } })).toThrow(
      /playlists\.json is not exactly/,
    );
    expect(check({ playlists: [item] })).toThrow(/playlists\.json is not exactly/);
  });

  it("fails on an extra item key or a nested object where a scalar belongs", () => {
    const withOwner = { ...item, owner: { login: "tmkplzv" } };
    expect(check({ playlists: { result: [withOwner] } })).toThrow(/item key outside/);
    const nested = { ...item, title: { text: "x" } };
    expect(check({ playlists: { result: [nested] } })).toThrow(/item value/);
  });

  it("fails on an extra cover key or a nested cover value", () => {
    const extraCover = { ...item, cover: { ...item.cover, custom: false } };
    expect(check({ playlists: { result: [extraCover] } })).toThrow(/cover key outside/);
    const nestedUri = { ...item, cover: { ...item.cover, itemsUri: [{ uri: "x" }] } };
    expect(check({ playlists: { result: [nestedUri] } })).toThrow(/itemsUri/);
  });

  it("never puts a key or value into its message", () => {
    const secret = "C:\\A\\secret-client-repo";
    let caught;
    try {
      assertPublishable({ presence: { ...presence, [secret]: secret }, playlists: null });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(caught.message).toMatch(/presence\.json keys/);
    expect(caught.message).not.toContain("secret");
  });
});
