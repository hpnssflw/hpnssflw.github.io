"use client";

import { type ReactNode, useEffect, useState } from "react";
import type { AgentConfig, TopicConfigView } from "@/lib/agent-config";
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

function Tags({ items, max }: { items: string[]; max?: number }) {
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
          {open ? "less" : `+${items.length - max}`}
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

function Collect({ topic }: { topic: TopicConfigView }) {
  return (
    <>
      {topic.hackerNews ? (
        <>
          hn: <V>{topic.keywords.length}</V> title keywords, ≥<V>{topic.hackerNews.minPoints}</V> points
        </>
      ) : (
        <>hn: off</>
      )}
      {" · "}
      {topic.github ? (
        <>
          github: <V>{topic.github.topics.length}</V> topics, ≥<V>{topic.github.minStars}</V>★
        </>
      ) : (
        <>github: off</>
      )}
    </>
  );
}

interface Row {
  params: ReactNode;
  detail?: ReactNode;
}

function rowsFor(
  config: AgentConfig,
  one: TopicConfigView | null,
  verdicts: { count: number; rubric: string | null } | null,
): Record<StageKey, Row> {
  const scope = one ? [one] : config.topics;
  const growth = scope.filter((t) => t.attention.enabled);
  return {
    collect: {
      params: one ? (
        <Collect topic={one} />
      ) : (
        <>
          hn title search, ≥<V>{spread(scope.flatMap((t) => (t.hackerNews ? [t.hackerNews.minPoints] : [])))}</V> points ·
          github topic search, ≥<V>{spread(scope.flatMap((t) => (t.github ? [t.github.minStars] : [])))}</V>★ · per topic
        </>
      ),
      detail: one ? (
        <>
          <div className="cr-detail-row">
            <span className="cr-k">hn keywords</span>
            <Tags items={one.keywords} max={8} />
          </div>
          {one.github && (
            <div className="cr-detail-row">
              <span className="cr-k">github topics</span>
              <Tags items={one.github.topics} />
            </div>
          )}
        </>
      ) : undefined,
    },
    window: {
      params: (
        <>
          published in the last <V>{spread(scope.map((t) => t.maxAgeDays))}</V> days
        </>
      ),
    },
    dedupe: { params: <>already sent, queued, rejected or expired · the same url twice in a run</> },
    cache: {
      params: (
        <>
          one verdict per url × topic
          {one && verdicts?.rubric && (
            <>
              {" "}· rubric <V>{verdicts.rubric}</V>
            </>
          )}
          {verdicts && (
            <>
              {" "}· <V>{verdicts.count}</V> cached
            </>
          )}
          {" · "}
          {/* 2× is rank_cache.is_valid's rule, fixed in code. */}
          {growth.length ? (
            <>
              re-score at <V>2×</V> and <V>+{spread(growth.map((t) => t.attention.minScoreGain))}</V> points/stars
            </>
          ) : (
            <>no re-score on growth</>
          )}
        </>
      ),
    },
    rank: {
      params: (
        <>
          <V>{config.llm.model}</V> · temperature <V>{config.llm.temperature}</V> · batches of <V>{config.llm.batchSize}</V> ·
          prompt v<V>{config.llm.promptVersion}</V> · pass ≥<V>{spread(scope.map((t) => t.minRelevance))}</V>
        </>
      ),
      detail: (
        <>
          <div className="cr-detail-row">
            <span className="cr-k">reader</span>
            <span className="cr-prose">{config.reader}</span>
          </div>
          <div className="cr-detail-row">
            <span className="cr-k">criteria</span>
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
              <span className="agent-muted">pick a topic to see its include / exclude</span>
            )}
          </div>
        </>
      ),
    },
    cap: {
      params: (
        <>
          <V>{scope.map((t) => t.maxItemsPerDay).join(" + ")}</V> a day · rolling <V>{config.queueWindowHours}h</V> · the rest
          waits for a later run
        </>
      ),
    },
    queue: { params: <>held for your review</> },
    review: {
      params: (
        <>
          your decisions in <V>{config.inbox.repo}</V> · undecided expire after <V>{config.inbox.expireDays}d</V>
        </>
      ),
    },
    deliver: {
      params: (
        <>
          approved only · telegram <V>{config.delivery.channel}</V> · every <V>{config.delivery.cadenceHours}h</V>
        </>
      ),
    },
  };
}

/**
 * The agent's config, one row per rail stage on a vertical spine. With a
 * topic picked, collect unfolds its keywords and GitHub topics, and rank
 * its include/exclude criteria.
 */
export default function ConfigSpine({
  config,
  topic,
  active,
  onPick,
  verdicts,
}: {
  config: AgentConfig;
  topic: TopicFilter;
  active: StageKey | null;
  onPick: (key: StageKey) => void;
  verdicts: { count: number; rubric: string | null } | null;
}) {
  const one = topic === "all" ? null : (config.topics.find((t) => t.slug === topic) ?? null);
  const rows = rowsFor(config, one, verdicts);

  useEffect(() => {
    if (active) document.getElementById(`cr-stage-${active}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [active]);

  return (
    <ol className="cr-spine" aria-label="Config by stage">
      {STAGE_KEYS.map((key) => (
        <li key={key} id={`cr-stage-${key}`} className="cr-stage" data-active={active === key} onClick={() => onPick(key)}>
          <span className="cr-dot" aria-hidden="true" />
          <span className="cr-label">{key}</span>
          <span className="cr-params">{rows[key].params}</span>
          {rows[key].detail && <div className="cr-detail">{rows[key].detail}</div>}
        </li>
      ))}
    </ol>
  );
}
