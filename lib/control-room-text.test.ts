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

  it("puts Russian numbers after a label so they never need a plural form", () => {
    const flat = (parts: (string | { v: string | number })[]) =>
      parts.map((part) => (typeof part === "string" ? part : String(part.v))).join("");
    expect(TEXT.ru.rail.drops.already_ranked).toBe("ранее оценены ниже порога");
    expect(TEXT.ru.rail.sent(1, 1)).toBe("отправлено: 1 · сообщений: 1");
    expect(TEXT.ru.rail.every(1)).toBe("раз в 1 ч");
    expect(TEXT.ru.rail.fullText(21)).toBe("полный текст: +21");
    expect(flat(TEXT.ru.spine.rssOn(1))).toBe("rss — лент: 1");
    expect(flat(TEXT.ru.spine.hnOn(21, 5))).toBe("hn — слов в заголовке: 21, очки ≥5");
    expect(flat(TEXT.ru.spine.githubOn(1, 100))).toBe("github — тем: 1, ≥100★");
    expect(flat(TEXT.ru.spine.hnSearch("5"))).toBe("поиск hn по заголовкам, очки ≥5");
    expect(flat(TEXT.ru.spine.window("1"))).toBe("опубликовано не раньше чем 1 дн. назад");
    expect(flat(TEXT.ru.spine.regrow("1"))).toBe("переоценка при 2× и +1 к очкам/звёздам");
    expect(flat(TEXT.ru.spine.deliverTelegram("@c", 1))).toBe("только одобренное · telegram @c · раз в 1 ч");
    expect(flat(TEXT.ru.spine.deliverFile("T", 21))).toBe("только одобренное · сводка «T» · раз в 21 ч");
  });

  it("speaks Russian for ru presets", () => {
    expect(TEXT.ru.stages.collect).toBe("сбор");
    expect(TEXT.ru.rail.drops.undated).toBe("без даты");
    expect(TEXT.ru.demo.tag("2026-10-06")).toBe("демо · синтетические данные · офлайн-прогоны 06.10.2026");
  });
});
