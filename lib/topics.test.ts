import { describe, expect, it } from "vitest";
import { gloss, subtopics, topics } from "./topics";

describe("topics", () => {
  it("has exactly the three RESEARCHER themes, in order", () => {
    expect(topics.map((t) => t.name)).toEqual([
      "Web Products",
      "Tooling",
      "AI Engineering",
    ]);
  });

  it("only AI Engineering links to the agent page", () => {
    const linked = topics.filter((t) => t.href);
    expect(linked).toHaveLength(1);
    expect(linked[0]).toMatchObject({
      name: "AI Engineering",
      href: "/researcher/agent/",
    });
  });

  it("every topic has at least one non-empty subtopic", () => {
    for (const t of topics) {
      expect(t.subtopics.length).toBeGreaterThan(0);
      for (const s of t.subtopics) expect(s.trim()).not.toBe("");
    }
  });

  it("gloss reads a topic's subtopics as one sentence", () => {
    expect(gloss({ name: "X", subtopics: ["a", "b c", "D"] })).toBe(
      "a, b c, D.",
    );
  });

  it("subtopics lists every topic's subtopics, in topic order, no repeats", () => {
    expect(subtopics).toEqual(topics.flatMap((t) => t.subtopics));
    expect(new Set(subtopics).size).toBe(subtopics.length);
  });
});
