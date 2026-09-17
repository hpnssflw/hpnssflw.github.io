import { describe, expect, it } from "vitest";
import { topics } from "./topics";

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

  it("every topic has a non-empty gloss", () => {
    for (const t of topics) {
      expect(t.gloss.length).toBeGreaterThan(0);
    }
  });
});
