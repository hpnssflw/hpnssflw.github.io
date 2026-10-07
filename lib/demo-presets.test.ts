import { describe, expect, it } from "vitest";
import { DEMO_SLUGS, demoLinks, loadDemo } from "./demo-presets";

describe("demo presets", () => {
  it.each(DEMO_SLUGS)("loads %s's two recorded runs", (slug) => {
    const demo = loadDemo(slug);
    expect(demo.run1.preset.slug).toBe(slug);
    expect(demo.run2.preset.slug).toBe(slug);
    expect(demo.run1.preset.language).toBe("ru");
    expect(demo.run2.delivery.sent_items).toBe(slug === "newsroom-demo" ? 4 : 3);
  });

  it("names them for the switcher", () => {
    expect(demoLinks()).toEqual([
      { slug: "newsroom-demo", name: "Редакция (демо)" },
      { slug: "agro-demo", name: "Агродистрибутор (демо)" },
    ]);
  });

  it("refuses a slug it doesn't list", () => {
    expect(() => loadDemo("tony")).toThrow(/not a demo preset/);
  });
});
