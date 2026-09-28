import { describe, expect, it } from "vitest";
import { formatAgo, formatDuration } from "./now-format";

const MIN = 60_000;

describe("formatDuration", () => {
  it("renders minutes only under an hour", () => {
    expect(formatDuration(45 * MIN)).toBe("45m");
  });

  it("renders hours and minutes", () => {
    expect(formatDuration(220 * MIN)).toBe("3h 40m");
  });

  it("keeps a zero minute part past an hour", () => {
    expect(formatDuration(60 * MIN)).toBe("1h 0m");
  });

  it("rounds to the nearest minute", () => {
    expect(formatDuration(48357650)).toBe("13h 26m");
    expect(formatDuration(21399780)).toBe("5h 57m");
    expect(formatDuration(34700980)).toBe("9h 38m");
  });

  it("never goes negative", () => {
    expect(formatDuration(-5 * MIN)).toBe("0m");
  });
});

describe("formatAgo", () => {
  it("says just now under a minute", () => {
    expect(formatAgo(30_000)).toBe("just now");
  });

  it("counts minutes", () => {
    expect(formatAgo(4 * MIN)).toBe("4 min ago");
  });

  it("counts whole hours", () => {
    expect(formatAgo(125 * MIN)).toBe("2h ago");
  });

  it("counts whole days", () => {
    expect(formatAgo(50 * 60 * MIN)).toBe("2d ago");
  });

  it("clamps a future time to just now", () => {
    expect(formatAgo(-MIN)).toBe("just now");
  });
});
