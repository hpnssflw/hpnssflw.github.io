"use client";

import { useMemo, useState } from "react";
import ConfigSpine from "@/components/ConfigSpine";
import ControlPulse from "@/components/ControlPulse";
import Outcomes from "@/components/Outcomes";
import PipelineRail from "@/components/PipelineRail";
import QueuePane from "@/components/QueuePane";
import TopicChips from "@/components/TopicChips";
import { useInbox } from "@/components/useInbox";
import { useJson } from "@/components/useJson";
import { STATUS_URL, parseAgentStatus } from "@/lib/agent-status";
import { configView } from "@/lib/config-view";
import { TEXT } from "@/lib/control-room-text";
import type { CronSchedule } from "@/lib/cron";
import type { Decision } from "@/lib/inbox";
import { STATE_URL, buildOutcomes, parseAgentState, topicVerdicts } from "@/lib/outcomes";
import { type PendingItem, type PendingQueue, PENDING_URL, isPendingQueue } from "@/lib/pending-queue";
import { type StageKey, type TopicFilter, buildStages, topicSlugs } from "@/lib/pipeline-stages";
import {
  type StatusFilter,
  nextSelection,
  resolveSelection,
  statusCounts,
  topicCounts,
  visibleItems,
} from "@/lib/queue-view";
import { RUN_RESULT_URL, parseRunResult } from "@/lib/run-result";

const acceptQueue = (value: unknown): PendingQueue | null => (isPendingQueue(value) ? value : null);
const text = TEXT.en;

/**
 * Tony Scraponi's control room (/researcher/queue/). The config and the
 * rail come from the last run's run-result.json; the pulse from
 * status.json and the workflow's schedule (read at build time); the
 * queue from pending.json with the inbox's decisions; the outcomes from
 * state.json. Each is fetched on its own, so one failing source never
 * blanks the rest. The topic chips filter the rail, the queue, the spine
 * and the outcomes.
 */
export default function ControlRoom({ schedule }: { schedule: CronSchedule }) {
  const status = useJson(STATUS_URL, parseAgentStatus);
  const run = useJson(RUN_RESULT_URL, parseRunResult);
  const pending = useJson(PENDING_URL, acceptQueue);
  const state = useJson(STATE_URL, parseAgentState);
  const inbox = useInbox(pending.data, pending.loadedAt);

  const [topic, setTopic] = useState<TopicFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("waiting");
  const [selectedUrl, setSelectedUrl] = useState<string | null>(null);
  const [stage, setStage] = useState<StageKey | null>(null);

  const config = useMemo(() => (run.data ? configView(run.data.config) : null), [run.data]);
  const topics: { slug: string; name: string }[] = config?.topics ?? status.data?.topics ?? [];
  const slugs = topicSlugs(topics, topic);
  const items = pending.data?.items ?? [];
  const rows = visibleItems(items, inbox.decisions, topic, statusFilter);
  const topicNames = topic === "all" ? Object.fromEntries(topics.map((t) => [t.slug, t.name])) : null;
  const thresholds = (config?.topics ?? []).filter((t) => slugs.includes(t.slug)).map((t) => t.minRelevance);
  const threshold = thresholds.length ? Math.min(...thresholds) : null;
  const cadence = schedule.hourStep !== null ? text.rail.every(schedule.hourStep) : text.rail.daily;
  const caption = run.data
    ? `${text.configPane.fromRun(new Date(run.data.run.at).toISOString().slice(11, 16))} · ${text.configPane.hint}`
    : text.configPane.hint;

  function decide(item: PendingItem, decision: Decision | null) {
    setSelectedUrl(nextSelection(rows, item.url));
    void inbox.decide(item, decision);
  }

  return (
    <section className="cr">
      <div className="wrap cr-wrap">
        <ControlPulse
          status={status.data}
          failed={status.failed}
          schedule={schedule}
          owner={{ signedIn: inbox.signedIn, error: inbox.error, onSignIn: inbox.signIn, onSignOut: inbox.signOut }}
        />
        <PipelineRail
          stages={buildStages(run.data, { queue: pending.data?.items ?? null, decisions: inbox.decisions }, topic, text.rail)}
          active={stage}
          onPick={(key) => setStage((current) => (current === key ? null : key))}
          titles={{ review: text.rail.reviewHint(cadence) }}
          text={text}
        />
        <TopicChips
          topics={topics}
          counts={topicCounts(items, topics.map((t) => t.slug))}
          topic={topic}
          onPick={setTopic}
          text={text.topics}
        />
        <div className="cr-grid">
          <QueuePane
            rows={rows}
            counts={statusCounts(items, inbox.decisions, topic)}
            statusFilter={statusFilter}
            onStatusFilter={setStatusFilter}
            selected={resolveSelection(rows, selectedUrl)}
            onSelect={setSelectedUrl}
            decisions={inbox.decisions}
            topicNames={topicNames}
            canDecide={inbox.canWrite}
            busy={inbox.busy}
            loaded={pending.data !== null}
            failed={pending.failed}
            onDecide={decide}
            text={text.queue}
          />
          <section className="cr-pane cr-flow" aria-label={text.configPane.region}>
            <header className="cr-pane-head">
              <span className="cr-label">{text.configPane.label}</span>
              <span className="agent-muted">{caption}</span>
            </header>
            <div className="cr-scroll">
              {config ? (
                <ConfigSpine
                  config={config}
                  topic={topic}
                  active={stage}
                  onPick={setStage}
                  verdicts={state.data ? topicVerdicts(state.data, slugs) : null}
                  text={text}
                />
              ) : (
                run.failed && <p className="agent-unavailable cr-empty">{text.configPane.unavailable}</p>
              )}
              <Outcomes
                data={state.data && state.loadedAt ? buildOutcomes(state.data, slugs, state.loadedAt) : null}
                failed={state.failed}
                threshold={threshold}
              />
            </div>
          </section>
        </div>
      </div>
    </section>
  );
}
