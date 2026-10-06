import { describe, expect, it } from "vitest";
import type { Decisions } from "./inbox";
import type { PendingItem } from "./pending-queue";
import { moveSelection, nextSelection, resolveSelection, statusCounts, topicCounts, visibleItems } from "./queue-view";

function item(url: string, topic: string, score: number, since: string): PendingItem {
  return { url, title: url, source: "hn", topic, topic_name: topic, summary: "", score, pending_since: since };
}

const items = [
  item("a", "tooling", 7, "2026-10-01T00:00:00Z"),
  item("b", "tooling", 9, "2026-10-02T00:00:00Z"),
  item("c", "web", 7, "2026-10-03T00:00:00Z"),
  item("d", "tooling", 7, "2026-10-04T00:00:00Z"),
];

const decisions: Decisions = {
  version: 1,
  decisions: { a: { decision: "approve", at: "x" }, c: { decision: "reject", at: "x" } },
};

const urls = (rows: PendingItem[]) => rows.map((r) => r.url);

describe("visibleItems", () => {
  it("sorts by score, then the newest first", () => {
    expect(urls(visibleItems(items, null, "all", "all"))).toEqual(["b", "d", "c", "a"]);
  });

  it("filters by topic and status", () => {
    expect(urls(visibleItems(items, decisions, "tooling", "waiting"))).toEqual(["b", "d"]);
    expect(urls(visibleItems(items, decisions, "all", "approved"))).toEqual(["a"]);
    expect(urls(visibleItems(items, decisions, "all", "rejected"))).toEqual(["c"]);
  });

  it("treats everything as waiting without decisions", () => {
    expect(urls(visibleItems(items, null, "all", "waiting"))).toEqual(["b", "d", "c", "a"]);
  });
});

describe("counts", () => {
  it("counts pending items per topic, plus all", () => {
    expect(topicCounts(items, ["tooling", "web", "empty"])).toEqual({ all: 4, tooling: 3, web: 1, empty: 0 });
  });

  it("counts statuses within the topic in view", () => {
    expect(statusCounts(items, decisions, "all")).toEqual({ waiting: 2, approved: 1, rejected: 1, all: 4 });
    expect(statusCounts(items, decisions, "tooling")).toEqual({ waiting: 2, approved: 1, rejected: 0, all: 3 });
  });
});

describe("selection", () => {
  const rows = visibleItems(items, null, "all", "all"); // b d c a

  it("moves to the row below a decided one, else the one above", () => {
    expect(nextSelection(rows, "d")).toBe("c");
    expect(nextSelection(rows, "a")).toBe("c");
    expect(nextSelection([rows[0]], "b")).toBeNull();
    expect(nextSelection(rows, "missing")).toBe("b");
  });

  it("falls back to the first row", () => {
    expect(resolveSelection(rows, "c")?.url).toBe("c");
    expect(resolveSelection(rows, "gone")?.url).toBe("b");
    expect(resolveSelection(rows, null)?.url).toBe("b");
    expect(resolveSelection([], null)).toBeNull();
  });

  it("moves j/k within the list", () => {
    expect(moveSelection(rows, null, 1)).toBe("d");
    expect(moveSelection(rows, "d", -1)).toBe("b");
    expect(moveSelection(rows, "b", -1)).toBe("b");
    expect(moveSelection(rows, "a", 1)).toBe("a");
    expect(moveSelection([], null, 1)).toBeNull();
  });
});
