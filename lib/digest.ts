import { type PendingItem, groupByTopic } from "./pending-queue";
import type { Language, QueueStory, RunResult } from "./run-result";
import { storyOf } from "./run-result";

/** A digest item: a queue item, with its story when the preset has stories. */
export type DigestItem = PendingItem & { story?: QueueStory };

// The digest the engine sends, mirrored for the demo section: approved
// items grouped as agent/pending.py's group_by_topic does, under
// agent/digest.py's header. digestHtml is digest.build's one-message
// output, pinned to the demos' outbox.html by lib/digest.test.ts; the
// split at Telegram's 4096 characters isn't mirrored (a demo digest never
// reaches it). The page renders DigestBlocks, never the HTML.

/** agent/digest.py's COUNT_PHRASES. */
export const COUNT_PHRASES: Record<Language, (total: number) => string> = {
  en: (total) => `${total} item${total === 1 ? "" : "s"}`,
  ru: (total) => `материалов: ${total}`,
};

export interface DigestBlocks {
  title: string;
  count: string;
  topics: { name: string; items: DigestItem[] }[];
}

export function digestBlocks(items: DigestItem[], title: string, language: Language): DigestBlocks {
  return {
    title,
    count: COUNT_PHRASES[language](items.length),
    topics: Object.entries(groupByTopic({ last_email_at: null, items }) as Record<string, DigestItem[]>).map(([name, group]) => ({
      name,
      items: group,
    })),
  };
}

/** The digest a demo's second run sent: its first run's queue items that
 * the preset's decisions file approves, in queue order. */
export function recordedDigest(run1: RunResult): DigestBlocks {
  return digestBlocks(
    run1.queue.items.filter((i) => i.decision === "approve"),
    run1.config.delivery.title,
    run1.preset.language,
  );
}

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#x27;" };

/** Python's html.escape(text) (quote=True). */
function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => ESCAPES[char]);
}

/** agent/digest.py's _render_item: a story with two or more reports gets
 * its facts (each followed by links to the reports it cites, or the
 * summary when there are none) and the "first" line. */
function itemHtml(i: DigestItem): string {
  const head = `• <a href="${escapeHtml(i.url)}">${escapeHtml(i.title)}</a>`;
  const story = storyOf(i);
  if (!story) return `${head}\n${escapeHtml(i.summary)}`;
  const urlOf = new Map(story.reports.map((r) => [r.n, r.url]));
  const lines = [head];
  if (story.facts.length) {
    for (const fact of story.facts) {
      const links = fact.refs.map((n) => `<a href="${escapeHtml(urlOf.get(n) ?? "")}">[${n}]</a>`).join("");
      lines.push(`${escapeHtml(fact.text)} ${links}`);
    }
  } else {
    lines.push(escapeHtml(i.summary));
  }
  if (story.first) lines.push(escapeHtml(story.first));
  return lines.join("\n");
}

export function digestHtml(digest: DigestBlocks): string {
  const header = `<b>${escapeHtml(digest.title)} — ${digest.count}</b>`;
  const topics = digest.topics.map(({ name, items }) => [`<b>${escapeHtml(name)}</b>`, ...items.map(itemHtml)].join("\n"));
  return [header, ...topics].join("\n\n");
}
