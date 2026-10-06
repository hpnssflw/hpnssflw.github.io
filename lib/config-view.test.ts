import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { configView } from "./config-view";
import { type RunResult, parseRunResult } from "./run-result";

function run(...parts: string[]): RunResult {
  const result = parseRunResult(JSON.parse(readFileSync(join(process.cwd(), "agent", "tests", "fixtures", ...parts), "utf8")));
  if (!result) throw new Error(`${parts.join("/")} doesn't parse`);
  return result;
}

describe("configView", () => {
  it("shows Tony's config as the spine reads it", () => {
    const view = configView(run("tony", "golden", "real", "run-result.json").config);
    expect(view.llm).toEqual({ model: "deepseek-v4-flash", baseUrl: "https://api.deepseek.com", temperature: 0, batchSize: 40, promptVersion: 2 });
    expect(view.reader).toMatch(/^Artem/);
    expect(view.queueWindowHours).toBe(23);
    expect(view.approval).toEqual({ kind: "inbox", repo: "hpnssflw/tony-inbox", expireDays: 7 });
    expect(view.delivery).toEqual({ kind: "telegram", chat: "@hypnosisflow", title: "Research digest", cadenceHours: 24 });
    expect(view.feeds).toEqual([]);
    expect(view.telegram).toBeNull();
    const ai = view.topics[0];
    expect(ai).toMatchObject({
      slug: "ai-engineering",
      maxItemsPerDay: 4,
      minRelevance: 6,
      maxAgeDays: 10,
      attention: { enabled: true, minScoreGain: 50 },
      hackerNews: { minPoints: 30 },
      github: { minStars: 100, topics: ["llm", "mcp", "ai-agents", "rag", "llm-inference"] },
      rss: [],
    });
    expect(ai.keywords).toHaveLength(21);
  });

  it("shows a demo preset's feeds, file approval and delivery, and the Telegram stub", () => {
    const view = configView(run("newsroom-demo", "golden", "run1.json").config);
    expect(view.approval).toEqual({ kind: "file", expireDays: 3 });
    expect(view.delivery).toEqual({ kind: "file", chat: null, title: "Сводка редакции", cadenceHours: 4 });
    expect(view.feeds.map((f) => f.id)).toEqual(["agency", "ministry", "city"]);
    expect(view.telegram?.map((c) => c.handle)).toEqual(["example_agency", "example_region_gov", "example_city_chat"]);
    expect(view.topics.map((t) => [t.slug, t.hackerNews, t.github, t.rss.length])).toEqual([
      ["incidents", null, null, 0],
      ["power", null, null, 0],
      ["economy", null, null, 0],
    ]);
  });

  it("keeps a topic's own feeds", () => {
    const view = configView(run("agro-demo", "golden", "run1.json").config);
    expect(view.topics.find((t) => t.slug === "prices")?.rss.map((f) => f.name)).toEqual(["Биржевые котировки (пример)"]);
  });
});
