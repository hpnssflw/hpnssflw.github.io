import { afterEach, describe, expect, it, vi } from "vitest";
import { GitHubAuthError, encodeBase64Utf8 } from "./github-contents";
import {
  DECISIONS_RAW_URL,
  type Decisions,
  EMPTY_DECISIONS,
  commitMessage,
  fetchOwnerDecisions,
  fetchPublicDecisions,
  isDecisions,
  itemStatus,
  pruneDecisions,
  serializeDecisions,
  setDecision,
} from "./inbox";

const NOW = new Date("2026-09-28T12:00:00.000Z");

function makeDecisions(entries: Decisions["decisions"] = {}): Decisions {
  return { version: 1, decisions: entries };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("isDecisions", () => {
  it("accepts an empty and a filled file", () => {
    expect(isDecisions(EMPTY_DECISIONS)).toBe(true);
    expect(
      isDecisions(
        makeDecisions({
          "https://a": { decision: "approve", at: "x" },
          "https://b": { decision: "reject", at: "y" },
        }),
      ),
    ).toBe(true);
  });

  it("rejects non-objects", () => {
    expect(isDecisions(null)).toBe(false);
    expect(isDecisions("nope")).toBe(false);
    expect(isDecisions([])).toBe(false);
  });

  it("rejects a wrong or missing version", () => {
    expect(isDecisions({ version: 2, decisions: {} })).toBe(false);
    expect(isDecisions({ decisions: {} })).toBe(false);
  });

  it("rejects a non-object or array decisions map", () => {
    expect(isDecisions({ version: 1, decisions: [] })).toBe(false);
    expect(isDecisions({ version: 1, decisions: null })).toBe(false);
  });

  it("rejects an unknown decision value or a missing at", () => {
    expect(isDecisions(makeDecisions({ "https://a": { decision: "maybe", at: "x" } as never }))).toBe(
      false,
    );
    expect(isDecisions({ version: 1, decisions: { "https://a": { decision: "approve" } } })).toBe(
      false,
    );
  });
});

describe("setDecision", () => {
  it("records a decision with an ISO timestamp", () => {
    expect(setDecision(EMPTY_DECISIONS, "https://a", "approve", NOW)).toEqual(
      makeDecisions({ "https://a": { decision: "approve", at: "2026-09-28T12:00:00.000Z" } }),
    );
  });

  it("overwrites an earlier decision", () => {
    const before = makeDecisions({ "https://a": { decision: "approve", at: "old" } });
    expect(setDecision(before, "https://a", "reject", NOW).decisions["https://a"]).toEqual({
      decision: "reject",
      at: "2026-09-28T12:00:00.000Z",
    });
  });

  it("removes the entry on undo (null)", () => {
    const before = makeDecisions({ "https://a": { decision: "approve", at: "old" } });
    expect(setDecision(before, "https://a", null, NOW)).toEqual(EMPTY_DECISIONS);
  });

  it("does not mutate its input", () => {
    const before = makeDecisions({ "https://a": { decision: "approve", at: "x" } });
    const snapshot = structuredClone(before);
    setDecision(before, "https://a", null, NOW);
    setDecision(before, "https://b", "reject", NOW);
    expect(before).toEqual(snapshot);
  });
});

describe("pruneDecisions", () => {
  it("keeps only URLs still in the queue", () => {
    const before = makeDecisions({
      "https://live": { decision: "approve", at: "x" },
      "https://gone": { decision: "reject", at: "y" },
    });
    expect(pruneDecisions(before, ["https://live", "https://other"])).toEqual(
      makeDecisions({ "https://live": { decision: "approve", at: "x" } }),
    );
  });
});

describe("itemStatus", () => {
  const decisions = makeDecisions({
    "https://a": { decision: "approve", at: "x" },
    "https://r": { decision: "reject", at: "y" },
  });

  it("maps decisions to statuses", () => {
    expect(itemStatus(decisions, "https://a")).toBe("approved");
    expect(itemStatus(decisions, "https://r")).toBe("rejected");
    expect(itemStatus(decisions, "https://w")).toBe("waiting");
  });

  it("treats missing decisions as waiting", () => {
    expect(itemStatus(null, "https://a")).toBe("waiting");
  });
});

describe("serializeDecisions", () => {
  it("round-trips through JSON.parse and ends with a newline", () => {
    const d = makeDecisions({ "https://a": { decision: "approve", at: "x" } });
    const text = serializeDecisions(d);
    expect(text.endsWith("\n")).toBe(true);
    expect(JSON.parse(text)).toEqual(d);
  });
});

describe("commitMessage", () => {
  it("keeps short messages as-is", () => {
    expect(commitMessage("approve", "Short title")).toBe("approve: Short title");
    expect(commitMessage("undo", "Short title")).toBe("undo: Short title");
  });

  it("truncates to 72 characters with an ellipsis", () => {
    const msg = commitMessage("reject", "x".repeat(200));
    expect(msg).toHaveLength(72);
    expect(msg.startsWith("reject: xxx")).toBe(true);
    expect(msg.endsWith("…")).toBe(true);
  });
});

describe("fetchPublicDecisions", () => {
  it("returns the parsed file from the raw URL", async () => {
    const d = makeDecisions({ "https://a": { decision: "approve", at: "x" } });
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(d), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchPublicDecisions()).resolves.toEqual(d);
    expect(fetchMock).toHaveBeenCalledWith(DECISIONS_RAW_URL, { cache: "no-store" });
  });

  it("returns null on a 404", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 404 })));
    await expect(fetchPublicDecisions()).resolves.toBeNull();
  });

  it("returns null on a malformed file", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ version: 9 }), { status: 200 })),
    );
    await expect(fetchPublicDecisions()).resolves.toBeNull();
  });

  it("returns null when fetch rejects", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("network down");
      }),
    );
    await expect(fetchPublicDecisions()).resolves.toBeNull();
  });
});

describe("fetchOwnerDecisions", () => {
  it("returns decisions and sha from the Contents API", async () => {
    const d = makeDecisions({ "https://a": { decision: "reject", at: "x" } });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ content: encodeBase64Utf8(serializeDecisions(d)), sha: "abc" }),
            { status: 200 },
          ),
      ),
    );
    await expect(fetchOwnerDecisions("tok")).resolves.toEqual({ decisions: d, sha: "abc" });
  });

  it("throws on a malformed file", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ content: encodeBase64Utf8('{"version":9}'), sha: "abc" }), {
            status: 200,
          }),
      ),
    );
    await expect(fetchOwnerDecisions("tok")).rejects.toThrow("decisions.json is malformed");
  });

  it("passes auth failures through as GitHubAuthError", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 401 })));
    await expect(fetchOwnerDecisions("tok")).rejects.toBeInstanceOf(GitHubAuthError);
  });
});
