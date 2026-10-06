import { describe, expect, it } from "vitest";
import type { AgentConfig, TopicConfigView } from "./agent-config";
import type { AgentStatus } from "./agent-status";
import type { Decisions } from "./inbox";
import type { PendingItem, PendingQueue } from "./pending-queue";
import { STAGE_KEYS, type StageNumbers, buildStages, topicSlugs } from "./pipeline-stages";

function topic(slug: string, minRelevance = 6): TopicConfigView {
  return {
    slug,
    name: slug,
    description: "",
    include: [],
    exclude: [],
    keywords: ["k"],
    maxAgeDays: 10,
    minRelevance,
    maxItemsPerDay: 3,
    attention: { enabled: true, minScoreGain: 50 },
    hackerNews: { minPoints: 30 },
    github: null,
  };
}

function makeConfig(topics = [topic("tooling"), topic("web")]): AgentConfig {
  return {
    cron: "0 */4 * * *",
    schedule: { minute: 0, hourStep: 4, hour: null },
    llm: { model: "m", baseUrl: "b", temperature: 0, batchSize: 40, promptVersion: 2 },
    reader: "r",
    queueWindowHours: 23,
    delivery: { channel: "@c", cadenceHours: 24 },
    inbox: { repo: "o/r", expireDays: 7 },
    topics,
  };
}

const status: AgentStatus = {
  cadence_hours: 4,
  delivery_cadence_hours: 24,
  streak: 3,
  pending_count: 3,
  updated_at: "2026-10-05T18:22:00+00:00",
  last_sent_at: "2026-09-30T04:08:45+00:00",
  topics: [
    { slug: "tooling", name: "tooling", collected: 101, kept: 3 },
    { slug: "web", name: "web", collected: 13, kept: 3 },
  ],
  funnel: {
    tooling: { collected: 101, in_window: 100, new: 70, kept: 3 },
    web: { collected: 13, in_window: 13, new: 12, kept: 3 },
  },
  recent_events: [],
  run_history: [],
};

const drops = {
  tooling: {
    collect: { undated: 2 },
    date_guard: { outside_window: 1 },
    dedupe: { seen: 25, dismissed: 1, already_ranked: 4 },
    rank: { below_relevance: 45, over_max_items: 22 },
    inbox: { rejected: 2, expired: 1 },
  },
  web: { dedupe: { seen: 1 }, rank: { below_relevance: 7, over_max_items: 2 } },
};

function item(url: string, topicSlug: string): PendingItem {
  return {
    url,
    title: url,
    source: "hn",
    topic: topicSlug,
    topic_name: topicSlug,
    summary: "",
    score: 7,
    pending_since: "2026-10-05T18:22:00+00:00",
  };
}

const queue: PendingQueue = {
  last_email_at: null,
  items: [item("https://a", "tooling"), item("https://b", "tooling"), item("https://c", "web")],
};

const decisions: Decisions = {
  version: 1,
  decisions: {
    "https://a": { decision: "approve", at: "2026-10-05T19:00:00Z" },
    "https://c": { decision: "reject", at: "2026-10-05T19:00:00Z" },
  },
};

function table(stages: StageNumbers[]): Record<string, [string, string]> {
  return Object.fromEntries(stages.map((s) => [s.key, [s.value, s.line]]));
}

describe("buildStages", () => {
  it("returns the nine stages in order", () => {
    const stages = buildStages(makeConfig(), { status, queue, decisions }, "all");
    expect(stages.map((s) => s.key)).toEqual([...STAGE_KEYS]);
  });

  it("numbers one topic's last run with drop reasons", () => {
    const stages = buildStages(makeConfig(), { status: { ...status, drops }, queue, decisions }, "tooling");
    expect(table(stages)).toEqual({
      collect: ["101", "−2 undated"],
      window: ["100", "−1 too old"],
      dedupe: ["74", "−25 seen · −1 dismissed"],
      cache: ["70", "−4 cached below"],
      rank: ["25", "−45 below 6"],
      cap: ["3", "−22 over cap"],
      queue: ["2", "+3 this run"],
      review: ["1", "−2 rejected · −1 expired"],
      deliver: ["09-30", "approved only"],
    });
  });

  it("sums every topic under all", () => {
    const stages = buildStages(makeConfig(), { status: { ...status, drops }, queue, decisions }, "all");
    expect(table(stages)).toMatchObject({
      collect: ["114", "−2 undated"],
      window: ["113", "−1 too old"],
      dedupe: ["86", "−26 seen · −1 dismissed"],
      cache: ["82", "−4 cached below"],
      rank: ["30", "−52 below 6"],
      cap: ["6", "−24 over cap"],
      queue: ["3", "+6 this run"],
      review: ["1", "−2 rejected · −1 expired"],
    });
  });

  it("shows what today's status.json allows when drops are missing", () => {
    const stages = buildStages(makeConfig(), { status, queue, decisions }, "tooling");
    expect(table(stages)).toEqual({
      collect: ["101", "found"],
      window: ["100", ""],
      dedupe: ["—", ""],
      cache: ["70", ""],
      rank: ["—", ""],
      cap: ["3", ""],
      queue: ["2", "+3 this run"],
      review: ["1", ""],
      deliver: ["09-30", "approved only"],
    });
  });

  it("shows dashes when nothing has loaded", () => {
    const stages = buildStages(makeConfig(), { status: null, queue: null, decisions: null }, "all");
    expect(stages.map((s) => s.value)).toEqual(Array(9).fill("—"));
    expect(stages.find((s) => s.key === "deliver")?.line).toBe("approved only");
    expect(stages.find((s) => s.key === "collect")?.line).toBe("");
  });

  it("says never when nothing was ever delivered", () => {
    const stages = buildStages(makeConfig(), { status: { ...status, last_sent_at: null }, queue, decisions }, "all");
    expect(stages.find((s) => s.key === "deliver")?.value).toBe("never");
  });

  it("marks failed stages for the topics in view", () => {
    const failures = [
      { stage: "collect", topic: "tooling", source: "github_trending" },
      { stage: "collect", topic: "web", source: "hacker_news" },
      { stage: "rank", topic: "web", source: null },
      { stage: "inbox", topic: null, source: null },
      { stage: "deliver", topic: null, source: null },
    ];
    const one = buildStages(makeConfig(), { status: { ...status, failures }, queue, decisions }, "tooling");
    const failed = Object.fromEntries(one.map((s) => [s.key, s.failed]));
    expect(failed).toMatchObject({ collect: "github_trending", rank: null, review: "run", deliver: "run", cap: null });
    const all = buildStages(makeConfig(), { status: { ...status, failures }, queue, decisions }, "all");
    expect(all.find((s) => s.key === "collect")?.failed).toBe("github_trending, hacker_news");
    expect(all.find((s) => s.key === "rank")?.failed).toBe("run");
  });

  it("names the threshold only when the topics agree on it", () => {
    const config = makeConfig([topic("tooling", 6), topic("web", 7)]);
    const stages = buildStages(config, { status: { ...status, drops }, queue, decisions }, "all");
    expect(stages.find((s) => s.key === "rank")?.line).toBe("−52 below threshold");
  });
});

describe("topicSlugs", () => {
  it("expands all and passes one topic through", () => {
    expect(topicSlugs(makeConfig(), "all")).toEqual(["tooling", "web"]);
    expect(topicSlugs(makeConfig(), "web")).toEqual(["web"]);
  });
});
