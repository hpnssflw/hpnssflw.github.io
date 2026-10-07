import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TEXT } from "./control-room-text";
import type { Decisions } from "./inbox";
import type { PendingItem } from "./pending-queue";
import { type StageNumbers, buildStages, railKeys, topicSlugs } from "./pipeline-stages";
import { type RunResult, parseRunResult } from "./run-result";

function run(...parts: string[]): RunResult {
  const result = parseRunResult(JSON.parse(readFileSync(join(process.cwd(), "agent", "tests", "fixtures", ...parts), "utf8")));
  if (!result) throw new Error(`${parts.join("/")} doesn't parse`);
  return result;
}
const tony = run("tony", "golden", "real", "run-result.json");
const newsroom1 = run("newsroom-demo", "golden", "run1.json");
const newsroom2 = run("newsroom-demo", "golden", "run2.json");
const agro1 = run("agro-demo", "golden", "run1.json");
const NONE = { queue: null, decisions: null };
const en = TEXT.en.rail;

function table(stages: StageNumbers[]): Record<string, [string, string]> {
  return Object.fromEntries(stages.map((s) => [s.key, [s.value, s.line]]));
}

function item(url: string, topic: string): PendingItem {
  return { url, title: url, source: "hn", topic, topic_name: topic, summary: "", score: 7, pending_since: "2026-10-06T12:00:00+00:00" };
}

describe("topicSlugs", () => {
  it("is every topic for all, else the one picked", () => {
    expect(topicSlugs([{ slug: "a" }, { slug: "b" }], "all")).toEqual(["a", "b"]);
    expect(topicSlugs([{ slug: "a" }, { slug: "b" }], "b")).toEqual(["b"]);
  });
});

describe("buildStages on Tony's run", () => {
  it("returns the nine stages in order", () => {
    expect(buildStages(tony, NONE, "all", en).map((s) => s.key)).toEqual(railKeys(tony));
  });

  it("sums every topic under all", () => {
    expect(table(buildStages(tony, NONE, "all", en))).toEqual({
      collect: ["24", "−1 undated"],
      window: ["23", "−1 too old"],
      dedupe: ["18", "−3 seen · −2 dismissed"],
      cache: ["17", "−1 cached below"],
      rank: ["13", "−4 below 6"],
      cap: ["8", "−5 over cap"],
      queue: ["9", "+8 this run"],
      review: ["1", "−1 rejected · −1 expired"],
      deliver: ["10-06", "1 sent in 1 message"],
    });
  });

  it("numbers one topic", () => {
    expect(table(buildStages(tony, NONE, "tooling", en))).toEqual({
      collect: ["7", "−1 undated"],
      window: ["6", "−1 too old"],
      dedupe: ["4", "−2 seen · −0 dismissed"],
      cache: ["4", "−0 cached below"],
      rank: ["3", "−1 below 6"],
      cap: ["1", "−2 over cap"],
      queue: ["2", "+1 this run"],
      review: ["0", "−1 rejected · −1 expired"],
      deliver: ["10-06", "1 sent in 1 message"],
    });
  });

  it("counts the live queue and live decisions when the page has them", () => {
    const queue = [item("https://a", "tooling"), item("https://b", "tooling"), item("https://c", "web-products")];
    const decisions: Decisions = {
      version: 1,
      decisions: {
        "https://a": { decision: "approve", at: "2026-10-06T13:00:00Z" },
        "https://c": { decision: "reject", at: "2026-10-06T13:00:00Z" },
      },
    };
    const rows = table(buildStages(tony, { queue, decisions }, "tooling", en));
    expect(rows.queue).toEqual(["2", "+1 this run"]);
    expect(rows.review[0]).toBe("1");
  });

  it("marks the stage and source that failed, in the topics in view", () => {
    const failing: RunResult = {
      ...tony,
      failures: [
        { stage: "collect", scope: "tooling", source: "hacker_news", error_type: "HTTPError" },
        { stage: "format", scope: "*", source: null, error_type: "ValueError" },
      ],
    };
    const tooling = Object.fromEntries(buildStages(failing, NONE, "tooling", en).map((s) => [s.key, s.failed]));
    expect(tooling.collect).toBe("hacker_news");
    expect(tooling.deliver).toBe("run");
    expect(tooling.rank).toBeNull();
    const web = Object.fromEntries(buildStages(failing, NONE, "web-products", en).map((s) => [s.key, s.failed]));
    expect(web.collect).toBeNull();
  });

  it("shows dashes without a run, but still the live queue and decisions", () => {
    const queue = [item("https://a", "tooling")];
    const decisions: Decisions = { version: 1, decisions: { "https://a": { decision: "approve", at: "2026-10-06T13:00:00Z" } } };
    expect(table(buildStages(null, { queue, decisions }, "all", en))).toEqual({
      collect: ["—", ""],
      window: ["—", ""],
      dedupe: ["—", ""],
      cache: ["—", ""],
      rank: ["—", ""],
      cap: ["—", ""],
      queue: ["1", ""],
      review: ["1", ""],
      deliver: ["—", ""],
    });
  });
});

describe("buildStages on a demo preset's shared feeds", () => {
  it("sums the shared feeds into all, with the full-text note", () => {
    expect(table(buildStages(newsroom1, NONE, "all", en))).toEqual({
      collect: ["22", "−2 undated"],
      window: ["20", "−2 too old"],
      dedupe: ["19", "−1 seen · −0 dismissed"],
      cache: ["19", "−0 cached below"],
      rank: ["14", "−3 below 6 · −2 off topic · +3 full text"],
      stories: ["11", "+0 joined · −0 same story · 2 with facts · 0 flagged"],
      cap: ["8", "−3 over cap"],
      queue: ["8", "+8 this run"],
      review: ["0", "−0 rejected · −0 expired"],
      deliver: ["never", "approved only"],
    });
  });

  it("shows a topic the shared feeds before sorting, and what was sorted into it", () => {
    const shared = " · shared feeds, before sorting";
    expect(table(buildStages(newsroom1, NONE, "power", en))).toEqual({
      collect: ["22", `−2 undated${shared}`],
      window: ["20", `−2 too old${shared}`],
      dedupe: ["19", `−1 seen · −0 dismissed${shared}`],
      cache: ["19", `−0 cached below${shared}`],
      rank: ["4", `−3 below 6 · −2 off topic · +3 full text${shared}`],
      stories: ["4", "+0 joined · −0 same story"],
      cap: ["3", "−1 over cap"],
      queue: ["3", "+3 this run"],
      review: ["0", "−0 rejected · −0 expired"],
      deliver: ["never", "approved only"],
    });
  });

  it("marks the shared full-text count on a topic's own rank line", () => {
    const mixed: RunResult = structuredClone(newsroom1);
    const rank = mixed.stages.find((s) => s.stage === "rank");
    const enrich = mixed.stages.find((s) => s.stage === "enrich");
    if (!rank || !enrich) throw new Error("fixture lacks rank or enrich");
    rank.scopes.power = { in: 5, out: 2, drops: { below_relevance: 3 } };
    delete enrich.scopes.power;
    expect(enrich.scopes["*"]?.notes?.full_text).toBeGreaterThan(0);
    const n = enrich.scopes["*"]?.notes?.full_text;
    expect(table(buildStages(mixed, NONE, "power", en)).rank[1]).toBe(`−3 below 6 · +${n} full text (shared feeds, before sorting)`);
  });

  it("keeps a topic's own feed numbers, plus what the shared feeds added", () => {
    const rows = table(buildStages(agro1, NONE, "prices", en));
    expect(rows.collect).toEqual(["3", "found"]);
    expect(rows.rank).toEqual(["3", "−0 below 6"]);
  });

  it("counts the sandbox's approvals on review", () => {
    const decisions: Decisions = {
      version: 1,
      decisions: { "https://example-agency.ru/news/102": { decision: "approve", at: "2026-10-06T06:00:00Z" } },
    };
    expect(table(buildStages(newsroom1, { queue: null, decisions }, "all", en)).review[0]).toBe("1");
  });

  it("shows a stories cell only for runs with a group stage", () => {
    const keys = (r: RunResult) => buildStages(r, NONE, "all", en).map((s) => s.key);
    expect(keys(newsroom1)).toEqual(["collect", "window", "dedupe", "cache", "rank", "stories", "cap", "queue", "review", "deliver"]);
    expect(keys(tony)).not.toContain("stories");
    const cell = buildStages(newsroom1, NONE, "all", TEXT.ru.rail).find((s) => s.key === "stories")!;
    expect(cell.value).toBe("11"); // stories formed in run 1: incidents 4, power 4, economy 3
  });

  it("speaks the preset's language", () => {
    expect(table(buildStages(newsroom1, NONE, "power", TEXT.ru.rail)).collect).toEqual([
      "22",
      "−2 без даты · общие ленты, до сортировки",
    ]);
  });

  it("shows the sent date as dd.mm in Russian", () => {
    expect(table(buildStages(newsroom2, NONE, "all", TEXT.ru.rail)).deliver[0]).toBe("06.10");
    expect(table(buildStages(newsroom2, NONE, "all", en)).deliver[0]).toBe("10-06");
  });
});
