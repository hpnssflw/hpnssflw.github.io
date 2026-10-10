import { describe, expect, it } from "vitest";
import { DEMO_SLUGS, loadDemo, presetLinks } from "./demo-presets";

describe("demo presets", () => {
  it.each(DEMO_SLUGS)("loads %s's two recorded runs", (slug) => {
    const demo = loadDemo(slug);
    expect(demo.run1.preset.slug).toBe(slug);
    expect(demo.run2.preset.slug).toBe(slug);
    expect(demo.run1.preset.language).toBe("ru");
    expect(demo.run2.delivery.sent_items).toBe(slug === "newsroom-demo" ? 4 : 3);
  });

  it("lists Tony first, then the demos, for the preset switch", () => {
    expect(presetLinks()).toEqual([
      { slug: "tony", name: "Tony Scraponi", href: "/researcher/queue/", live: true },
      { slug: "newsroom-demo", name: "Редакция (демо)", href: "/researcher/demo/newsroom-demo/", live: false },
      { slug: "agro-demo", name: "Агродистрибутор (демо)", href: "/researcher/demo/agro-demo/", live: false },
    ]);
  });

  it("refuses a slug it doesn't list", () => {
    expect(() => loadDemo("tony")).toThrow(/not a demo preset/);
  });
});
