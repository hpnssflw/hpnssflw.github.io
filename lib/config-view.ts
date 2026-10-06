import type { FeedConfig, RunConfig } from "./run-result";

// A run's config (run-result.json's `config`) shaped for ConfigSpine:
// camelCase, connector defaults filled in (agent/sources/hn.py and
// github_trending.py read a missing minimum as 0), the inbox repo
// parsed out of its contents URL.

export interface TopicView {
  slug: string;
  name: string;
  description: string;
  include: string[];
  exclude: string[];
  keywords: string[];
  maxAgeDays: number;
  minRelevance: number;
  maxItemsPerDay: number;
  attention: { enabled: boolean; minScoreGain: number };
  hackerNews: { minPoints: number } | null;
  github: { minStars: number; topics: string[] } | null;
  rss: FeedConfig[];
}

export interface ConfigView {
  llm: { model: string; baseUrl: string; temperature: number; batchSize: number; promptVersion: number };
  reader: string;
  queueWindowHours: number;
  approval: { kind: "inbox"; repo: string; expireDays: number } | { kind: "file"; expireDays: number };
  delivery: { kind: "telegram" | "file"; chat: string | null; title: string; cadenceHours: number };
  /** Preset-level feeds, classified across the topics. */
  feeds: FeedConfig[];
  /** telegram_public's channels, shown as "coming soon"; null when the preset has none. */
  telegram: { handle: string; name: string }[] | null;
  topics: TopicView[];
}

const INBOX_REPO_RE = /^https:\/\/api\.github\.com\/repos\/([^/]+\/[^/]+)\/contents\//;

export function configView(config: RunConfig): ConfigView {
  const { approval, delivery, ranking } = config;
  return {
    llm: {
      model: ranking.model,
      baseUrl: ranking.base_url,
      temperature: ranking.temperature,
      batchSize: ranking.batch_size,
      promptVersion: ranking.rank_prompt_version,
    },
    reader: ranking.reader,
    queueWindowHours: config.cap_window_hours,
    approval:
      approval.type === "inbox"
        ? {
            kind: "inbox",
            repo: INBOX_REPO_RE.exec(approval.decisions_url)?.[1] ?? approval.decisions_url,
            expireDays: approval.expire_days,
          }
        : { kind: "file", expireDays: approval.expire_days },
    delivery: { kind: delivery.type, chat: delivery.chat, title: delivery.title, cadenceHours: delivery.cadence_hours },
    feeds: config.sources.rss,
    telegram: config.sources.telegram_public?.channels ?? null,
    topics: config.topics.map((t) => ({
      slug: t.slug,
      name: t.name,
      description: t.description,
      include: t.include,
      exclude: t.exclude,
      keywords: t.keywords,
      maxAgeDays: t.max_age_days,
      minRelevance: t.min_relevance,
      maxItemsPerDay: t.max_items_per_day,
      attention: { enabled: t.attention.enabled, minScoreGain: t.attention.min_score_gain },
      hackerNews: t.sources.hacker_news ? { minPoints: t.sources.hacker_news.min_points ?? 0 } : null,
      github: t.sources.github_trending
        ? { minStars: t.sources.github_trending.min_stars ?? 0, topics: t.sources.github_trending.topics }
        : null,
      rss: t.rss,
    })),
  };
}
