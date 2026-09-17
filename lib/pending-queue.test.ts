import { describe, expect, it } from "vitest";
import {
  type PendingItem,
  type PendingQueue,
  groupByTopic,
  isPendingQueue,
} from "./pending-queue";

function makeItem(overrides: Partial<PendingItem> = {}): PendingItem {
  return {
    url: "https://example.com/a",
    title: "A title",
    source: "hacker_news",
    topic: "ai-engineering",
    topic_name: "AI Engineering",
    summary: "A one-line summary.",
    score: 7,
    pending_since: "2026-09-17T08:00:00+00:00",
    ...overrides,
  };
}

function makeQueue(overrides: Partial<PendingQueue> = {}): PendingQueue {
  return {
    last_email_at: null,
    items: [],
    ...overrides,
  };
}

describe("isPendingQueue", () => {
  const good = makeQueue({ items: [makeItem()] });

  it("accepts a well-formed payload", () => {
    expect(isPendingQueue(good)).toBe(true);
  });

  it("accepts a non-null last_email_at", () => {
    expect(
      isPendingQueue({ ...good, last_email_at: "2026-09-17T00:00:00+00:00" }),
    ).toBe(true);
  });

  it("rejects non-objects and nulls", () => {
    expect(isPendingQueue(null)).toBe(false);
    expect(isPendingQueue("nope")).toBe(false);
    expect(isPendingQueue(undefined)).toBe(false);
  });

  it("rejects a wrong-typed last_email_at", () => {
    expect(isPendingQueue({ ...good, last_email_at: 12345 })).toBe(false);
  });

  it("rejects a non-array items field", () => {
    expect(isPendingQueue({ ...good, items: {} })).toBe(false);
  });

  it("rejects an item missing a required field", () => {
    expect(
      isPendingQueue({ ...good, items: [{ ...makeItem(), score: undefined }] }),
    ).toBe(false);
  });

  it("rejects an item with a wrong-typed field", () => {
    expect(
      isPendingQueue({
        ...good,
        items: [{ ...makeItem(), score: "high" as unknown as number }],
      }),
    ).toBe(false);
  });
});

describe("groupByTopic", () => {
  it("groups items under their topic_name, keyed in first-appearance order", () => {
    const queue = makeQueue({
      items: [
        makeItem({ url: "a", topic_name: "AI Engineering" }),
        makeItem({ url: "b", topic_name: "Tooling" }),
        makeItem({ url: "c", topic_name: "AI Engineering" }),
      ],
    });
    const grouped = groupByTopic(queue);
    expect(Object.keys(grouped)).toEqual(["AI Engineering", "Tooling"]);
    expect(grouped["AI Engineering"]).toHaveLength(2);
    expect(grouped["Tooling"]).toHaveLength(1);
  });

  it("sorts each group by score descending", () => {
    const queue = makeQueue({
      items: [
        makeItem({ url: "a", score: 3 }),
        makeItem({ url: "b", score: 9 }),
        makeItem({ url: "c", score: 5 }),
      ],
    });
    const grouped = groupByTopic(queue);
    expect(grouped["AI Engineering"].map((i) => i.url)).toEqual([
      "b",
      "c",
      "a",
    ]);
  });

  it("returns an empty object for an empty queue", () => {
    expect(groupByTopic(makeQueue())).toEqual({});
  });

  it("does not throw on a score tie", () => {
    const queue = makeQueue({
      items: [
        makeItem({ url: "a", score: 5 }),
        makeItem({ url: "b", score: 5 }),
      ],
    });
    expect(() => groupByTopic(queue)).not.toThrow();
    expect(groupByTopic(queue)["AI Engineering"]).toHaveLength(2);
  });
});
