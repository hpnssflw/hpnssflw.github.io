import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { type CronSchedule, parseCron } from "./cron";

// The research agent's configuration as the control room shows it, read at
// build time from the same files the agent runs with: agent/defaults.yaml
// merged under each agent/topics/<slug>.yaml exactly as agent/config.py
// does, plus the constants that live in code. A missing file, field or
// constant throws, so the build fails instead of the page showing a config
// the agent no longer has. Server-only (node:fs): client components import
// its types with `import type`.

export interface TopicConfigView {
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
}

export interface AgentConfig {
  cron: string; // agent-run.yml's schedule line, as written
  schedule: CronSchedule;
  llm: { model: string; baseUrl: string; temperature: number; batchSize: number; promptVersion: number };
  reader: string;
  queueWindowHours: number;
  delivery: { channel: string; cadenceHours: number };
  inbox: { repo: string; expireDays: number };
  topics: TopicConfigView[];
}

type Raw = Record<string, unknown>;

const BATCH_RE = /^RANK_BATCH_SIZE = (\d+)\s*$/gm;
const PROMPT_RE = /^RANK_PROMPT_VERSION = (\d+)\s*$/gm;
const TEMPERATURE_RE = /\btemperature=(\d+(?:\.\d+)?)/g;
const WINDOW_RE = /^QUEUE_WINDOW = timedelta\(hours=(\d+)\)\s*$/gm;
const CRON_RE = /^\s*-\s*cron:\s*["']([^"'\r\n]+)["']\s*$/gm;
const INBOX_REPO_RE = /^https:\/\/api\.github\.com\/repos\/([^/]+\/[^/]+)\/contents\//;

function isRecord(value: unknown): value is Raw {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(message: string): never {
  throw new Error(`agent config: ${message}`);
}

/** agent/config.py's _deep_merge: the override wins; dicts merge key by key. */
export function deepMerge(base: Raw, override: Raw): Raw {
  const merged: Raw = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const current = merged[key];
    merged[key] = isRecord(current) && isRecord(value) ? deepMerge(current, value) : value;
  }
  return merged;
}

function readYaml(path: string, where: string): Raw {
  const data: unknown = parse(readFileSync(path, "utf8"));
  if (data === null || data === undefined) return {}; // yaml.safe_load(...) or {}
  return isRecord(data) ? data : fail(`${where} is not a mapping`);
}

function get(obj: Raw, path: string, where: string): unknown {
  let current: unknown = obj;
  for (const key of path.split(".")) {
    if (!isRecord(current) || !(key in current)) fail(`missing ${path} in ${where}`);
    current = (current as Raw)[key];
  }
  return current;
}

function str(obj: Raw, path: string, where: string): string {
  const value = get(obj, path, where);
  return typeof value === "string" ? value : fail(`${path} in ${where} is not a string`);
}

function num(obj: Raw, path: string, where: string): number {
  const value = get(obj, path, where);
  return typeof value === "number" ? value : fail(`${path} in ${where} is not a number`);
}

function strings(value: unknown, path: string, where: string): string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string")
    ? value
    : fail(`${path} in ${where} is not a list of strings`);
}

/** Exactly one match of `pattern` (global) in a source file, first group. */
function constant(root: string, file: string, pattern: RegExp, what: string): string {
  const matches = [...readFileSync(join(root, file), "utf8").matchAll(pattern)];
  if (matches.length !== 1) fail(`expected one ${what} in ${file}, found ${matches.length}`);
  return matches[0][1];
}

function topicView(slug: string, merged: Raw, where: string): TopicConfigView {
  const attention: Raw = isRecord(merged.attention) ? merged.attention : {};
  const sources = get(merged, "sources", where);
  if (!isRecord(sources)) fail(`sources in ${where} is not a mapping`);
  const hn = sources.hacker_news;
  const gh = sources.github_trending;
  return {
    slug,
    name: str(merged, "name", where),
    description: str(merged, "description", where).trim(),
    include: "include" in merged ? strings(merged.include, "include", where) : [],
    exclude: "exclude" in merged ? strings(merged.exclude, "exclude", where) : [],
    keywords: strings(get(merged, "keywords", where), "keywords", where),
    maxAgeDays: num(merged, "max_age_days", where),
    minRelevance: num(merged, "min_relevance", where),
    maxItemsPerDay: num(merged, "max_items_per_day", where),
    attention: {
      enabled: attention.enabled === true,
      minScoreGain: typeof attention.min_score_gain === "number" ? attention.min_score_gain : 0,
    },
    hackerNews: isRecord(hn) ? { minPoints: num(hn, "min_points", `${where} sources.hacker_news`) } : null,
    github: isRecord(gh)
      ? {
          minStars: num(gh, "min_stars", `${where} sources.github_trending`),
          topics: strings(get(gh, "topics", `${where} sources.github_trending`), "topics", where),
        }
      : null,
  };
}

export function loadAgentConfig(root: string = process.cwd()): AgentConfig {
  const defaultsFile = "agent/defaults.yaml";
  const defaults = readYaml(join(root, defaultsFile), defaultsFile);
  const topicsDir = join(root, "agent", "topics");
  const files = readdirSync(topicsDir)
    .filter((file) => file.endsWith(".yaml"))
    .sort();
  if (files.length === 0) fail("no topics in agent/topics/");
  const topics = files.map((file) => {
    const where = `agent/topics/${file}`;
    return topicView(file.slice(0, -".yaml".length), deepMerge(defaults, readYaml(join(topicsDir, file), where)), where);
  });

  const decisionsUrl = str(defaults, "inbox.decisions_url", defaultsFile);
  const repo = INBOX_REPO_RE.exec(decisionsUrl)?.[1] ?? fail(`inbox.decisions_url is not a GitHub contents URL`);
  const cron = constant(root, ".github/workflows/agent-run.yml", CRON_RE, "cron schedule");

  return {
    cron,
    schedule: parseCron(cron),
    llm: {
      model: str(defaults, "llm.model", defaultsFile),
      baseUrl: str(defaults, "llm.base_url", defaultsFile),
      temperature: Number(constant(root, "agent/summarize.py", TEMPERATURE_RE, "temperature=")),
      batchSize: Number(constant(root, "agent/summarize.py", BATCH_RE, "RANK_BATCH_SIZE")),
      promptVersion: Number(constant(root, "agent/summarize.py", PROMPT_RE, "RANK_PROMPT_VERSION")),
    },
    reader: str(defaults, "ranking.reader", defaultsFile).trim(),
    queueWindowHours: Number(constant(root, "agent/rank_cache.py", WINDOW_RE, "QUEUE_WINDOW")),
    delivery: {
      channel: str(defaults, "delivery.telegram_channel", defaultsFile),
      cadenceHours: num(defaults, "delivery.delivery_cadence_hours", defaultsFile),
    },
    inbox: { repo, expireDays: num(defaults, "inbox.expire_days", defaultsFile) },
    topics,
  };
}
