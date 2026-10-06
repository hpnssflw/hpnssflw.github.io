import { describe, expect, it } from "vitest";
import { TEXT } from "./control-room-text";

/** Every key path in a nested object, functions counted as leaves. */
function paths(value: unknown, prefix = ""): string[] {
  if (typeof value !== "object" || value === null) return [prefix];
  return Object.entries(value).flatMap(([key, inner]) => paths(inner, prefix ? `${prefix}.${key}` : key));
}

describe("TEXT", () => {
  it("has the same keys in both languages", () => {
    expect(paths(TEXT.ru).sort()).toEqual(paths(TEXT.en).sort());
  });

  it("keeps Tony's English rail lines as they read today", () => {
    expect(TEXT.en.rail.below("6")).toBe("below 6");
    expect(TEXT.en.rail.thisRun(8)).toBe("+8 this run");
    expect(TEXT.en.rail.sent(1, 1)).toBe("1 sent in 1 message");
    expect(TEXT.en.rail.every(4)).toBe("every 4 hours");
    expect(TEXT.en.spine.window("10")).toEqual(["published in the last ", { v: "10" }, " days"]);
  });

  it("speaks Russian for ru presets", () => {
    expect(TEXT.ru.stages.collect).toBe("сбор");
    expect(TEXT.ru.rail.drops.undated).toBe("без даты");
    expect(TEXT.ru.demo.tag("2026-10-06")).toBe("демо · синтетические данные · офлайн-прогоны 06.10.2026");
  });
});
