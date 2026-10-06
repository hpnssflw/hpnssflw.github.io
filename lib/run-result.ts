import type { PendingItem } from "./pending-queue";

// The engine's per-run contract, agent/run_result.py (schema 2): the
// assembled config, numbers per stage and scope, drop reasons, failures,
// the queue and the delivery. Tony's comes from agent-data (written by
// every agent-run.yml run); the demo presets' from their committed
// goldens (lib/demo-presets.ts). parseRunResult validates the parts the
// pages read and returns a normalized copy: a bad core rejects the file,
// a bad optional part costs only itself (as lib/agent-status.ts does).

export const RUN_RESULT_URL =
  "https://raw.githubusercontent.com/hpnssflw/hpnssflw.github.io/agent-data/agent/run-result.json";
/** agent/run_result.py's SCHEMA_VERSION this site reads. */
export const RUN_RESULT_SCHEMA = 2;
/** A preset feed's items before classification (agent/run_result.py). */
export const FEED_SCOPE = "*";

export type Language = "en" | "ru";

export interface ScopeCounts {
  in: number;
  out: number;
  drops: Record<string, number>;
  notes?: Record<string, number>;
  /** rank's `*` scope: shared-feed items sorted into each topic. */
  assigned?: Record<string, number>;
}

export interface StageResult {
  stage: string;
  group: string;
  scopes: Record<string, ScopeCounts>;
}

/** Which stage failed, never why (no error text in the file). */
export interface RunFailureRecord {
  stage: string;
  scope: string;
  source: string | null;
  error_type: string;
}

export interface FeedConfig {
  id: string;
  name: string;
  url: string;
  full_text: boolean;
}

export interface TopicResult {
  slug: string;
  name: string;
  description: string;
  keywords: string[];
  include: string[];
  exclude: string[];
  sources: {
    hacker_news?: { min_points?: number };
    github_trending?: { topics: string[]; min_stars?: number };
  };
  rss: FeedConfig[];
  max_age_days: number;
  min_relevance: number;
  max_items_per_day: number;
  attention: { enabled: boolean; min_score_gain: number };
  rubric_hash: string;
}

export interface TelegramStub {
  channels: { handle: string; name: string }[];
}

export type ApprovalResult =
  | { type: "inbox"; decisions_url: string; expire_days: number }
  | { type: "file"; path: string; expire_days: number };

export interface DeliveryConfig {
  type: "telegram" | "file";
  title: string;
  cadence_hours: number;
  chat: string | null;
}

export interface RunConfig {
  max_age_days: number;
  sources: { rss: FeedConfig[]; telegram_public: TelegramStub | null };
  topics: TopicResult[];
  ranking: {
    reader: string;
    model: string;
    base_url: string;
    temperature: number;
    batch_size: number;
    rank_prompt_version: number;
  };
  cap_window_hours: number;
  approval: ApprovalResult;
  delivery: DeliveryConfig;
}

export interface QueueItem extends PendingItem {
  decision: "approve" | "reject" | null;
}

export interface RunResult {
  schema_version: typeof RUN_RESULT_SCHEMA;
  preset: { slug: string; name: string; language: Language };
  run: { id: string; at: string; offline: boolean };
  config: RunConfig;
  stages: StageResult[];
  failures: RunFailureRecord[];
  queue: { items: QueueItem[] };
  delivery: { sent_items: number; messages: number; last_sent_at: string | null };
}

type Raw = Record<string, unknown>;

class Malformed extends Error {}

function rec(value: unknown): Raw {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Malformed();
  return value as Raw;
}

function str(value: unknown): string {
  if (typeof value !== "string") throw new Malformed();
  return value;
}

function num(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Malformed();
  return value;
}

function bool(value: unknown): boolean {
  if (typeof value !== "boolean") throw new Malformed();
  return value;
}

function date(value: unknown): string {
  const text = str(value);
  if (Number.isNaN(Date.parse(text))) throw new Malformed();
  return text;
}

function list<T>(value: unknown, item: (value: unknown) => T): T[] {
  if (!Array.isArray(value)) throw new Malformed();
  return value.map(item);
}

const strs = (value: unknown): string[] => list(value, str);

function counts(value: unknown): Record<string, number> {
  return Object.fromEntries(Object.entries(rec(value)).map(([key, n]) => [key, num(n)]));
}

/** `parse()`, or `fallback` when what it reads is malformed. */
function optional<T>(parse: () => T, fallback: T): T {
  try {
    return parse();
  } catch (error) {
    if (error instanceof Malformed) return fallback;
    throw error;
  }
}

/** The entries that parse; malformed ones are left out. */
function lenient<T>(value: unknown, item: (value: unknown) => T): T[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => optional<T[]>(() => [item(entry)], []));
}

function feed(value: unknown): FeedConfig {
  const f = rec(value);
  return { id: str(f.id), name: str(f.name), url: str(f.url), full_text: bool(f.full_text) };
}

function topic(value: unknown): TopicResult {
  const t = rec(value);
  const sources = rec(t.sources);
  const attention = rec(t.attention);
  const parsed: TopicResult["sources"] = {};
  if (sources.hacker_news !== undefined) {
    const hn = rec(sources.hacker_news);
    parsed.hacker_news = hn.min_points === undefined ? {} : { min_points: num(hn.min_points) };
  }
  if (sources.github_trending !== undefined) {
    const gh = rec(sources.github_trending);
    const github: { topics: string[]; min_stars?: number } = { topics: strs(gh.topics) };
    if (gh.min_stars !== undefined) github.min_stars = num(gh.min_stars);
    parsed.github_trending = github;
  }
  return {
    slug: str(t.slug),
    name: str(t.name),
    description: str(t.description),
    keywords: strs(t.keywords),
    include: strs(t.include),
    exclude: strs(t.exclude),
    sources: parsed,
    rss: list(t.rss, feed),
    max_age_days: num(t.max_age_days),
    min_relevance: num(t.min_relevance),
    max_items_per_day: num(t.max_items_per_day),
    attention: { enabled: bool(attention.enabled), min_score_gain: num(attention.min_score_gain) },
    rubric_hash: str(t.rubric_hash),
  };
}

function telegram(value: unknown): TelegramStub | null {
  if (value === null) return null;
  return {
    channels: list(rec(value).channels, (entry) => {
      const channel = rec(entry);
      return { handle: str(channel.handle), name: str(channel.name) };
    }),
  };
}

function approval(value: unknown): ApprovalResult {
  const a = rec(value);
  if (a.type === "inbox") return { type: "inbox", decisions_url: str(a.decisions_url), expire_days: num(a.expire_days) };
  if (a.type === "file") return { type: "file", path: str(a.path), expire_days: num(a.expire_days) };
  throw new Malformed();
}

function deliveryConfig(value: unknown): DeliveryConfig {
  const d = rec(value);
  const type = d.type === "telegram" || d.type === "file" ? d.type : null;
  if (type === null) throw new Malformed();
  return {
    type,
    title: str(d.title),
    cadence_hours: num(d.cadence_hours),
    chat: type === "telegram" ? str(d.chat) : null,
  };
}

function languageOf(value: unknown): Language {
  if (value === "en" || value === "ru") return value;
  throw new Malformed();
}

function decisionOf(value: unknown): QueueItem["decision"] {
  if (value === null || value === "approve" || value === "reject") return value;
  throw new Malformed();
}

function scope(value: unknown): ScopeCounts {
  const s = rec(value);
  const parsed: ScopeCounts = { in: num(s.in), out: num(s.out), drops: counts(s.drops) };
  if (s.notes !== undefined) parsed.notes = counts(s.notes);
  if (s.assigned !== undefined) parsed.assigned = counts(s.assigned);
  return parsed;
}

function stage(value: unknown): StageResult {
  const s = rec(value);
  return {
    stage: str(s.stage),
    group: str(s.group),
    scopes: Object.fromEntries(Object.entries(rec(s.scopes)).map(([key, counted]) => [key, scope(counted)])),
  };
}

function failure(value: unknown): RunFailureRecord {
  const f = rec(value);
  return {
    stage: str(f.stage),
    scope: str(f.scope),
    source: f.source === null ? null : str(f.source),
    error_type: str(f.error_type),
  };
}

function queueItem(value: unknown): QueueItem {
  const i = rec(value);
  return {
    url: str(i.url),
    title: str(i.title),
    source: str(i.source),
    topic: str(i.topic),
    topic_name: str(i.topic_name),
    summary: str(i.summary),
    score: num(i.score),
    pending_since: str(i.pending_since),
    decision: decisionOf(i.decision),
  };
}

export function parseRunResult(value: unknown): RunResult | null {
  try {
    const r = rec(value);
    if (r.schema_version !== RUN_RESULT_SCHEMA) return null;
    const preset = rec(r.preset);
    const run = rec(r.run);
    const config = rec(r.config);
    const sources = rec(config.sources);
    const ranking = rec(config.ranking);
    const delivery = optional(() => rec(r.delivery), {} as Raw);
    return {
      schema_version: RUN_RESULT_SCHEMA,
      preset: { slug: str(preset.slug), name: str(preset.name), language: languageOf(preset.language) },
      run: { id: str(run.id), at: date(run.at), offline: bool(run.offline) },
      config: {
        max_age_days: num(config.max_age_days),
        sources: {
          rss: list(sources.rss, feed),
          telegram_public: optional(() => telegram(sources.telegram_public), null),
        },
        topics: list(config.topics, topic),
        ranking: {
          reader: str(ranking.reader),
          model: str(ranking.model),
          base_url: str(ranking.base_url),
          temperature: num(ranking.temperature),
          batch_size: num(ranking.batch_size),
          rank_prompt_version: num(ranking.rank_prompt_version),
        },
        cap_window_hours: num(config.cap_window_hours),
        approval: approval(config.approval),
        delivery: deliveryConfig(config.delivery),
      },
      stages: list(r.stages, stage),
      failures: optional(() => list(r.failures, failure), []),
      queue: { items: lenient(optional(() => rec(r.queue).items, []), queueItem) },
      delivery: {
        sent_items: optional(() => num(delivery.sent_items), 0),
        messages: optional(() => num(delivery.messages), 0),
        last_sent_at: optional<string | null>(() => date(delivery.last_sent_at), null),
      },
    };
  } catch (error) {
    if (error instanceof Malformed) return null;
    throw error;
  }
}
