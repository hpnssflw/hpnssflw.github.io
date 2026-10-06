"use client";

import { Fragment, type ReactNode, useEffect, useState } from "react";
import type { ConfigView, TopicView } from "@/lib/config-view";
import type { Part, Text } from "@/lib/control-room-text";
import { STAGE_KEYS, type StageKey, type TopicFilter } from "@/lib/pipeline-stages";

/**
 * One config value on the spine. Every value goes through here so a later
 * editing step (settings in a repo the agent only reads, like the inbox)
 * can turn them into inputs in one place.
 */
export function ConfigValue({ children }: { children: ReactNode }) {
  return <b className="cr-value">{children}</b>;
}

const V = ConfigValue;

/** A dictionary line: text, with its values as <ConfigValue>. */
function Parts({ parts }: { parts: Part[] }) {
  return (
    <>
      {parts.map((part, i) => (typeof part === "string" ? <Fragment key={i}>{part}</Fragment> : <V key={i}>{part.v}</V>))}
    </>
  );
}

/** Groups of parts joined by " · ". */
function joined(groups: Part[][]): Part[] {
  return groups.flatMap((group, i) => (i ? [" · ", ...group] : group));
}

function Tags({ items, max, text }: { items: string[]; max?: number; text: Text["spine"] }) {
  const [open, setOpen] = useState(false);
  const shown = open || max === undefined ? items : items.slice(0, max);
  return (
    <span className="cr-tags">
      {shown.map((item) => (
        <span key={item} className="cr-tag">
          {item}
        </span>
      ))}
      {max !== undefined && items.length > max && (
        <button
          type="button"
          className="cr-more"
          onClick={(event) => {
            event.stopPropagation();
            setOpen(!open);
          }}
        >
          {open ? text.less : text.more(items.length - max)}
        </button>
      )}
    </span>
  );
}

/** "30" when the topics agree, "50–100" when they don't. */
function spread(values: number[]): string {
  if (values.length === 0) return "—";
  const low = Math.min(...values);
  const high = Math.max(...values);
  return low === high ? String(low) : `${low}–${high}`;
}

function feedNames(feeds: { name: string; full_text: boolean }[], text: Text["spine"]): string[] {
  return feeds.map((f) => (f.full_text ? `${f.name} · ${text.fullText}` : f.name));
}

/** What one topic collects from: its enabled sources, else the shared feeds. */
function collectOne(config: ConfigView, topic: TopicView, text: Text["spine"]): Part[] {
  const groups: Part[][] = [];
  if (topic.hackerNews) groups.push(text.hnOn(topic.keywords.length, topic.hackerNews.minPoints));
  if (topic.github) groups.push(text.githubOn(topic.github.topics.length, topic.github.minStars));
  if (topic.rss.length) groups.push(text.rssOn(topic.rss.length));
  if (config.feeds.length) groups.push(text.presetFeeds(config.feeds.length));
  return joined(groups);
}

function collectAll(config: ConfigView, text: Text["spine"]): Part[] {
  const groups: Part[][] = [];
  const points = config.topics.flatMap((t) => (t.hackerNews ? [t.hackerNews.minPoints] : []));
  const stars = config.topics.flatMap((t) => (t.github ? [t.github.minStars] : []));
  const topicFeeds = config.topics.reduce((n, t) => n + t.rss.length, 0);
  if (points.length) groups.push(text.hnSearch(spread(points)));
  if (stars.length) groups.push(text.githubSearch(spread(stars)));
  if (topicFeeds) groups.push(text.rssOn(topicFeeds));
  if (groups.length) groups.push([text.perTopic]);
  if (config.feeds.length) groups.push(text.presetFeeds(config.feeds.length));
  return joined(groups);
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="cr-detail-row">
      <span className="cr-k">{label}</span>
      {children}
    </div>
  );
}

interface StageRow {
  params: ReactNode;
  detail?: ReactNode;
}

function rowsFor(
  config: ConfigView,
  one: TopicView | null,
  verdicts: { count: number; rubric: string | null } | null,
  text: Text["spine"],
): Record<StageKey, StageRow> {
  const scope = one ? [one] : config.topics;
  const growth = scope.filter((t) => t.attention.enabled);
  const feeds = one ? one.rss : config.feeds;

  const collectDetail: ReactNode[] = [];
  if (one?.keywords.length)
    collectDetail.push(
      <Row key="kw" label={text.hnKeywords}>
        <Tags items={one.keywords} max={8} text={text} />
      </Row>,
    );
  if (one?.github)
    collectDetail.push(
      <Row key="gh" label={text.githubTopics}>
        <Tags items={one.github.topics} text={text} />
      </Row>,
    );
  if (feeds.length)
    collectDetail.push(
      <Row key="rss" label={text.feeds}>
        <Tags items={feedNames(feeds, text)} text={text} />
      </Row>,
    );
  if (config.telegram)
    collectDetail.push(
      <Row key="tg" label={text.telegram}>
        <Tags items={config.telegram.map((c) => c.name)} text={text} />
        <span className="agent-muted"> {text.telegramSoon}</span>
      </Row>,
    );

  const cache: Part[] = [text.cache];
  if (one && verdicts?.rubric) cache.push(` · ${text.rubric} `, { v: verdicts.rubric });
  if (verdicts) cache.push(" · ", { v: verdicts.count }, ` ${text.cached}`);
  cache.push(" · ", ...(growth.length ? text.regrow(spread(growth.map((t) => t.attention.minScoreGain))) : [text.noRegrow]));

  return {
    collect: {
      params: <Parts parts={one ? collectOne(config, one, text) : collectAll(config, text)} />,
      detail: collectDetail.length ? collectDetail : undefined,
    },
    window: { params: <Parts parts={text.window(spread(scope.map((t) => t.maxAgeDays)))} /> },
    dedupe: { params: text.dedupe },
    cache: { params: <Parts parts={cache} /> },
    rank: {
      params: (
        <Parts
          parts={text.rank(
            config.llm.model,
            config.llm.temperature,
            config.llm.batchSize,
            config.llm.promptVersion,
            spread(scope.map((t) => t.minRelevance)),
          )}
        />
      ),
      detail: (
        <>
          <Row label={text.reader}>
            <span className="cr-prose">{config.reader}</span>
          </Row>
          <Row label={text.criteria}>
            {one ? (
              <ul className="cr-criteria">
                {one.include.map((c) => (
                  <li key={`+${c}`} className="cr-include">
                    {c}
                  </li>
                ))}
                {one.exclude.map((c) => (
                  <li key={`-${c}`} className="cr-exclude">
                    {c}
                  </li>
                ))}
              </ul>
            ) : (
              <span className="agent-muted">{text.pickTopic}</span>
            )}
          </Row>
        </>
      ),
    },
    cap: { params: <Parts parts={text.cap(scope.map((t) => t.maxItemsPerDay).join(" + "), config.queueWindowHours)} /> },
    queue: { params: text.queue },
    review: {
      params: (
        <Parts
          parts={
            config.approval.kind === "inbox"
              ? text.reviewInbox(config.approval.repo, config.approval.expireDays)
              : text.reviewFile(config.approval.expireDays)
          }
        />
      ),
    },
    deliver: {
      params: (
        <Parts
          parts={
            config.delivery.kind === "telegram" && config.delivery.chat
              ? text.deliverTelegram(config.delivery.chat, config.delivery.cadenceHours)
              : text.deliverFile(config.delivery.title, config.delivery.cadenceHours)
          }
        />
      ),
    },
  };
}

/**
 * A preset's config, one row per rail stage on a vertical spine. With a
 * topic picked, collect unfolds its keywords, GitHub topics and feeds,
 * and rank its include/exclude criteria. Preset feeds and the Telegram
 * "coming soon" channels unfold under collect.
 */
export default function ConfigSpine({
  config,
  topic,
  active,
  onPick,
  verdicts,
  text,
}: {
  config: ConfigView;
  topic: TopicFilter;
  active: StageKey | null;
  onPick: (key: StageKey) => void;
  verdicts: { count: number; rubric: string | null } | null;
  text: Text;
}) {
  const one = topic === "all" ? null : (config.topics.find((t) => t.slug === topic) ?? null);
  const rows = rowsFor(config, one, verdicts, text.spine);

  useEffect(() => {
    if (active) document.getElementById(`cr-stage-${active}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [active]);

  return (
    <ol className="cr-spine" aria-label={text.spine.label}>
      {STAGE_KEYS.map((key) => (
        <li key={key} id={`cr-stage-${key}`} className="cr-stage" data-active={active === key} onClick={() => onPick(key)}>
          <span className="cr-dot" aria-hidden="true" />
          <span className="cr-label">{text.stages[key]}</span>
          <span className="cr-params">{rows[key].params}</span>
          {rows[key].detail && <div className="cr-detail">{rows[key].detail}</div>}
        </li>
      ))}
    </ol>
  );
}
