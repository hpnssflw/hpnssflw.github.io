import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { digestBlocks, digestHtml, recordedDigest } from "./digest";
import type { PendingItem } from "./pending-queue";
import { parseRunResult } from "./run-result";

function read(slug: string, file: string): string {
  // Fixtures may check out with CRLF (core.autocrlf); the engine writes LF.
  return readFileSync(join(process.cwd(), "agent", "tests", "fixtures", slug, "golden", file), "utf8").replace(/\r\n/g, "\n");
}

function item(url: string, topicName: string, score: number, title = url, summary = "s"): PendingItem {
  return { url, title, source: "rss", topic: topicName, topic_name: topicName, summary, score, pending_since: "2026-10-06T06:00:00+00:00" };
}

describe("digestHtml", () => {
  it.each(["newsroom-demo", "agro-demo"])("reproduces %s's sent digest byte for byte", (slug) => {
    const run1 = parseRunResult(JSON.parse(read(slug, "run1.json")));
    expect(run1).not.toBeNull();
    expect(`${digestHtml(recordedDigest(run1!))}\n`).toBe(read(slug, "outbox.html"));
  });

  it("escapes like Python's html.escape", () => {
    const html = digestHtml(digestBlocks([item('https://x.example/?a=1&b="2"', "T<1>", 5, `<a & "b">`, "it's")], "T&T", "en"));
    expect(html).toBe(
      "<b>T&amp;T — 1 item</b>\n\n<b>T&lt;1&gt;</b>\n" +
        '• <a href="https://x.example/?a=1&amp;b=&quot;2&quot;">&lt;a &amp; &quot;b&quot;&gt;</a>\nit&#x27;s',
    );
  });
});

describe("digestBlocks", () => {
  it("groups by topic name in first-appearance order, highest score first", () => {
    const blocks = digestBlocks([item("a", "B", 6), item("b", "A", 9), item("c", "B", 8)], "Digest", "en");
    expect(blocks.topics.map((t) => [t.name, t.items.map((i) => i.url)])).toEqual([
      ["B", ["c", "a"]],
      ["A", ["b"]],
    ]);
  });

  it("counts in the preset's language", () => {
    expect(digestBlocks([item("a", "A", 1), item("b", "A", 1)], "x", "en").count).toBe("2 items");
    expect(digestBlocks([item("a", "A", 1)], "x", "en").count).toBe("1 item");
    expect(digestBlocks([item("a", "A", 1), item("b", "A", 1), item("c", "A", 1)], "x", "ru").count).toBe("материалов: 3");
  });
});
