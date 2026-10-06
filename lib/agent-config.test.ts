import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { deepMerge, loadAgentConfig } from "./agent-config";

describe("loadAgentConfig against this repo's agent/", () => {
  const config = loadAgentConfig();

  it("loads the three topics in file-name order", () => {
    expect(config.topics.map((t) => t.slug)).toEqual(["ai-engineering", "tooling", "web-products"]);
  });

  it("applies a topic's override over defaults.yaml", () => {
    expect(config.topics.find((t) => t.slug === "ai-engineering")?.maxItemsPerDay).toBe(4);
    expect(config.topics.find((t) => t.slug === "tooling")?.maxItemsPerDay).toBe(3);
  });

  it("carries criteria, keywords and both sources for every topic", () => {
    for (const topic of config.topics) {
      expect(topic.include.length).toBeGreaterThan(0);
      expect(topic.exclude.length).toBeGreaterThan(0);
      expect(topic.keywords.length).toBeGreaterThan(0);
      expect(topic.hackerNews?.minPoints).toBeGreaterThan(0);
      expect(topic.github?.topics.length).toBeGreaterThan(0);
    }
  });

  it("reads the constants that live in code", () => {
    expect(config.llm.batchSize).toBe(40);
    expect(config.llm.temperature).toBe(0);
    expect(Number.isInteger(config.llm.promptVersion) && config.llm.promptVersion >= 2).toBe(true);
    expect(config.queueWindowHours).toBe(23);
    expect(config.cron).toBe("0 */4 * * *");
    expect(config.schedule).toEqual({ minute: 0, hourStep: 4, hour: null });
  });

  it("reads delivery, inbox and the reader profile", () => {
    expect(config.inbox).toEqual({ repo: "hpnssflw/tony-inbox", expireDays: 7 });
    expect(config.delivery.channel).toBe("@hypnosisflow");
    expect(config.reader).toMatch(/^Artem/);
    expect(config.reader).toBe(config.reader.trim());
  });
});

const FILES: Record<string, string> = {
  "agent/defaults.yaml": [
    "max_age_days: 10",
    "min_relevance: 6",
    "max_items_per_day: 3",
    "attention:",
    "  enabled: true",
    "  min_score_gain: 50",
    "llm:",
    "  base_url: https://api.example.com",
    "  model: some-model",
    "ranking:",
    "  reader: >",
    "    A reader",
    "    on two lines.",
    "delivery:",
    '  telegram_channel: "@channel"',
    "  delivery_cadence_hours: 24",
    "inbox:",
    "  decisions_url: https://api.github.com/repos/owner/inbox/contents/decisions.json",
    "  expire_days: 7",
    "",
  ].join("\n"),
  "agent/topics/b-topic.yaml": [
    "name: B Topic",
    "description: >",
    "  Second.",
    "keywords: [one]",
    "sources:",
    "  hacker_news: { min_points: 30 }",
    "",
  ].join("\n"),
  "agent/topics/a-topic.yaml": [
    "name: A Topic",
    "description: First.",
    "max_items_per_day: 5",
    "attention: { min_score_gain: 10 }",
    "include: [in]",
    "exclude: [out]",
    "keywords: [two, three]",
    "sources:",
    "  github_trending: { min_stars: 100, topics: [llm, mcp] }",
    "",
  ].join("\n"),
  "agent/summarize.py": "RANK_PROMPT_VERSION = 3\nRANK_BATCH_SIZE = 25\n\ndef f():\n    return dict(temperature=0)\n",
  "agent/rank_cache.py": "from datetime import timedelta\n\nQUEUE_WINDOW = timedelta(hours=20)\n",
  ".github/workflows/agent-run.yml": 'on:\n  schedule:\n    - cron: "15 */6 * * *"\n',
};

/** A throwaway repo root; `null` leaves a file out. */
function fixtureRepo(overrides: Record<string, string | null> = {}): string {
  const root = mkdtempSync(join(tmpdir(), "agent-config-"));
  for (const [path, text] of Object.entries({ ...FILES, ...overrides })) {
    if (text === null) continue;
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

describe("loadAgentConfig against fixtures", () => {
  it("merges each topic over defaults like agent/config.py", () => {
    const config = loadAgentConfig(fixtureRepo());
    const [a, b] = config.topics;
    expect(config.topics.map((t) => t.slug)).toEqual(["a-topic", "b-topic"]);
    expect(a).toMatchObject({
      name: "A Topic",
      description: "First.",
      maxItemsPerDay: 5,
      maxAgeDays: 10,
      minRelevance: 6,
      attention: { enabled: true, minScoreGain: 10 },
      include: ["in"],
      exclude: ["out"],
      keywords: ["two", "three"],
      hackerNews: null,
      github: { minStars: 100, topics: ["llm", "mcp"] },
    });
    expect(b).toMatchObject({
      description: "Second.",
      maxItemsPerDay: 3,
      attention: { enabled: true, minScoreGain: 50 },
      include: [],
      exclude: [],
      hackerNews: { minPoints: 30 },
      github: null,
    });
    expect(config.reader).toBe("A reader on two lines.");
    expect(config.llm).toEqual({
      model: "some-model",
      baseUrl: "https://api.example.com",
      temperature: 0,
      batchSize: 25,
      promptVersion: 3,
    });
    expect(config.queueWindowHours).toBe(20);
    expect(config.schedule).toEqual({ minute: 15, hourStep: 6, hour: null });
    expect(config.inbox).toEqual({ repo: "owner/inbox", expireDays: 7 });
    expect(config.delivery).toEqual({ channel: "@channel", cadenceHours: 24 });
  });

  it.each([
    ["agent/summarize.py", "RANK_PROMPT_VERSION = 3\n\ndef f():\n    return dict(temperature=0)\n", /RANK_BATCH_SIZE/],
    ["agent/summarize.py", "RANK_BATCH_SIZE = 25\n\ndef f():\n    return dict(temperature=0)\n", /RANK_PROMPT_VERSION/],
    ["agent/summarize.py", "RANK_PROMPT_VERSION = 3\nRANK_BATCH_SIZE = 25\n", /temperature=/],
    ["agent/rank_cache.py", "QUEUE_WINDOW = timedelta(days=1)\n", /QUEUE_WINDOW/],
    [".github/workflows/agent-run.yml", "on: push\n", /cron/],
    [".github/workflows/agent-run.yml", 'on:\n  schedule:\n    - cron: "0 9 * * 1"\n', /unsupported cron/],
  ])("fails when %s lacks what it needs", (path, text, message) => {
    expect(() => loadAgentConfig(fixtureRepo({ [path]: text }))).toThrow(message);
  });

  it("fails on a missing YAML field", () => {
    const noInbox = FILES["agent/defaults.yaml"].replace(/inbox:[\s\S]*$/, "");
    expect(() => loadAgentConfig(fixtureRepo({ "agent/defaults.yaml": noInbox }))).toThrow(
      /missing inbox\.decisions_url in agent\/defaults\.yaml/,
    );
    const noSources = "name: B\ndescription: x\nkeywords: [one]\n";
    expect(() => loadAgentConfig(fixtureRepo({ "agent/topics/b-topic.yaml": noSources }))).toThrow(
      /missing sources in agent\/topics\/b-topic\.yaml/,
    );
  });

  it("fails on a missing file", () => {
    expect(() => loadAgentConfig(fixtureRepo({ "agent/rank_cache.py": null }))).toThrow();
  });
});

describe("deepMerge", () => {
  it("lets the override win and merges dicts key by key", () => {
    expect(deepMerge({ a: { x: 1, y: 2 }, b: 1 }, { a: { y: 3 }, c: 4 })).toEqual({ a: { x: 1, y: 3 }, b: 1, c: 4 });
  });

  it("replaces a dict with a non-dict", () => {
    expect(deepMerge({ a: { x: 1 } }, { a: [1] })).toEqual({ a: [1] });
  });
});
