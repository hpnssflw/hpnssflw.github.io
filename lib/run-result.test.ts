import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseRunResult, storyOf } from "./run-result";

const FIXTURES = join(process.cwd(), "agent", "tests", "fixtures");

/** A golden as JSON, deep-copied so a test can break it. */
function golden(...parts: string[]): Record<string, any> {
  return JSON.parse(readFileSync(join(FIXTURES, ...parts), "utf8"));
}
const tony = () => golden("tony", "golden", "real", "run-result.json");
const newsroom = (run: 1 | 2) => golden("newsroom-demo", "golden", `run${run}.json`);
const agro = (run: 1 | 2) => golden("agro-demo", "golden", `run${run}.json`);

describe("parseRunResult on the goldens", () => {
  it("reads Tony's real run", () => {
    const result = parseRunResult(tony());
    expect(result?.preset).toEqual({ slug: "tony", name: "Tony Scraponi", language: "en" });
    expect(result?.run).toEqual({ id: "2026-10-06T1200Z", at: "2026-10-06T12:00:00+00:00", offline: false });
    expect(result?.config.topics.map((t) => t.slug)).toEqual(["ai-engineering", "tooling", "web-products"]);
    expect(result?.config.topics[0].sources).toEqual({
      hacker_news: { min_points: 30 },
      github_trending: { min_stars: 100, topics: ["llm", "mcp", "ai-agents", "rag", "llm-inference"] },
    });
    expect(result?.config.ranking.batch_size).toBe(40);
    expect(result?.config.approval).toEqual({
      type: "inbox",
      decisions_url: "https://api.github.com/repos/hpnssflw/tony-inbox/contents/decisions.json",
      expire_days: 7,
    });
    expect(result?.config.delivery).toEqual({ type: "telegram", title: "Research digest", cadence_hours: 24, chat: "@hypnosisflow" });
    expect(result?.config.sources).toEqual({ rss: [], telegram_public: null });
    expect(result?.stages).toHaveLength(11);
    expect(result?.failures).toEqual([]);
    expect(result?.queue.items).toHaveLength(9);
    expect(result?.delivery).toEqual({ sent_items: 1, messages: 1, last_sent_at: "2026-10-06T12:00:00+00:00" });
  });

  it("reads both demo presets' runs", () => {
    for (const raw of [newsroom(1), newsroom(2), agro(1), agro(2)]) {
      const result = parseRunResult(raw);
      expect(result?.preset.language).toBe("ru");
      expect(result?.config.approval.type).toBe("file");
      expect(result?.config.delivery.chat).toBeNull();
    }
    const news = parseRunResult(newsroom(1));
    expect(news?.config.sources.rss.map((f) => [f.id, f.full_text])).toEqual([
      ["agency", true],
      ["ministry", false],
      ["city", false],
    ]);
    expect(news?.config.sources.telegram_public?.channels.map((c) => c.handle)).toEqual([
      "example_agency",
      "example_region_gov",
      "example_city_chat",
    ]);
    expect(news?.stages.find((s) => s.stage === "rank")?.scopes["*"].assigned).toEqual({ economy: 4, incidents: 6, power: 4 });
    expect(news?.queue.items[0].decision).toBe("approve");
    expect(parseRunResult(agro(1))?.config.topics.find((t) => t.slug === "prices")?.rss.map((f) => f.id)).toEqual(["exchange"]);
  });
});

describe("parseRunResult rejects a bad core", () => {
  const cases: [string, (r: Record<string, any>) => void][] = [
    ["schema 1", (r) => (r.schema_version = 1)],
    ["no preset", (r) => delete r.preset],
    ["an unknown language", (r) => (r.preset.language = "de")],
    ["a run time that isn't a date", (r) => (r.run.at = "soon")],
    ["a topic without include", (r) => delete r.config.topics[0].include],
    ["a stage count that isn't a number", (r) => (r.stages[0].scopes.tooling.in = "3")],
    ["an unknown approval type", (r) => (r.config.approval.type = "buttons")],
    ["not an object", (r) => Object.keys(r).forEach((k) => delete r[k])],
  ];
  it.each(cases)("%s", (_, breakIt) => {
    const raw = tony();
    breakIt(raw);
    expect(parseRunResult(raw)).toBeNull();
  });

  it("null and strings", () => {
    expect(parseRunResult(null)).toBeNull();
    expect(parseRunResult("run")).toBeNull();
  });
});

describe("parseRunResult drops a bad optional part", () => {
  it("failures → []", () => {
    const raw = tony();
    raw.failures = {};
    expect(parseRunResult(raw)?.failures).toEqual([]);
  });

  it("a queue item without a url is left out", () => {
    const raw = tony();
    delete raw.queue.items[0].url;
    expect(parseRunResult(raw)?.queue.items).toHaveLength(8);
  });

  it("an unparseable last_sent_at → null", () => {
    const raw = tony();
    raw.delivery.last_sent_at = "garbage";
    expect(parseRunResult(raw)?.delivery.last_sent_at).toBeNull();
  });

  it("a malformed telegram_public → null", () => {
    const raw = newsroom(1);
    raw.config.sources.telegram_public = { channels: "x" };
    expect(parseRunResult(raw)?.config.sources.telegram_public).toBeNull();
  });
});

describe("stories", () => {
  it("parses the newsroom's story fields", () => {
    const run = parseRunResult(newsroom(1))!;
    const pipe = run.queue.items.find((i) => i.url === "https://example-agency.ru/news/101")!;
    expect(pipe.story!.reports.map((r) => r.source_id)).toEqual(["agency", "city", "ministry"]);
    expect(pipe.story!.facts).toHaveLength(2);
    expect(run.config.stories?.timezone).toBe("+03:00");
    expect(storyOf(pipe)).not.toBeNull();
  });

  it("leaves Tony and agro without stories", () => {
    expect(readFileSync(join(process.cwd(), "agent", "presets", "tony.yaml"), "utf8")).not.toMatch(/^stories:/m);
    const tonyRun = parseRunResult(tony())!;
    expect(tonyRun.config.stories).toBeUndefined();
    expect(tonyRun.queue.items.every((i) => i.story === undefined)).toBe(true);
    const agroRun = parseRunResult(agro(1))!;
    expect(agroRun.config.stories).toBeUndefined();
    expect(agroRun.queue.items.every((i) => i.story === undefined)).toBe(true);
  });

  it("drops a malformed story but keeps the item", () => {
    const raw = newsroom(1);
    raw.queue.items[0].story = { reports: "nope" };
    const run = parseRunResult(raw)!;
    expect(run.queue.items[0].story).toBeUndefined();
    expect(run.queue.items).toHaveLength(raw.queue.items.length);
  });
});
