"use client";

import { useState } from "react";
import ConfigSpine from "@/components/ConfigSpine";
import ControlPulse from "@/components/ControlPulse";
import Outcomes from "@/components/Outcomes";
import PipelineRail from "@/components/PipelineRail";
import QueuePane from "@/components/QueuePane";
import { useInbox } from "@/components/useInbox";
import { useJson } from "@/components/useJson";
import type { AgentConfig } from "@/lib/agent-config";
import { STATUS_URL, parseAgentStatus } from "@/lib/agent-status";
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

const acceptQueue = (value: unknown): PendingQueue | null => (isPendingQueue(value) ? value : null);

function TopicChips({
  config,
  counts,
  topic,
  onPick,
}: {
  config: AgentConfig;
  counts: Record<string, number>;
  topic: TopicFilter;
  onPick: (topic: TopicFilter) => void;
}) {
  const options: [TopicFilter, string][] = [["all", "all"], ...config.topics.map((t): [TopicFilter, string] => [t.slug, t.name])];
  return (
    <div className="cr-chips cr-topics" role="group" aria-label="Topic">
      {options.map(([key, label]) => (
        <button key={key} type="button" className="cr-chip" aria-pressed={topic === key} onClick={() => onPick(key)}>
          {label} <span className="cr-chip-n">{counts[key] ?? 0}</span>
        </button>
      ))}
    </div>
  );
}

/**
 * Tony Scraponi's control room (/researcher/queue/). `config` is read at
 * build time from agent/ (lib/agent-config.ts); everything live —
 * status.json, pending.json, state.json, the inbox decisions — is fetched
 * here, each on its own, so one failing source never blanks the rest.
 * The topic chips filter the rail, the queue, the spine and the outcomes.
 */
export default function ControlRoom({ config }: { config: AgentConfig }) {
  const status = useJson(STATUS_URL, parseAgentStatus);
  const pending = useJson(PENDING_URL, acceptQueue);
  const state = useJson(STATE_URL, parseAgentState);
  const inbox = useInbox(pending.data, pending.loadedAt);

  const [topic, setTopic] = useState<TopicFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("waiting");
  const [selectedUrl, setSelectedUrl] = useState<string | null>(null);
  const [stage, setStage] = useState<StageKey | null>(null);

  const slugs = topicSlugs(config, topic);
  const items = pending.data?.items ?? [];
  const rows = visibleItems(items, inbox.decisions, topic, statusFilter);
  const topicNames = topic === "all" ? Object.fromEntries(config.topics.map((t) => [t.slug, t.name])) : null;
  const threshold = Math.min(...config.topics.filter((t) => slugs.includes(t.slug)).map((t) => t.minRelevance));
  const cadence = config.schedule.hourStep !== null ? `every ${config.schedule.hourStep} hours` : "once a day";

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
          schedule={config.schedule}
          owner={{ signedIn: inbox.signedIn, error: inbox.error, onSignIn: inbox.signIn, onSignOut: inbox.signOut }}
        />
        <PipelineRail
          stages={buildStages(config, { status: status.data, queue: pending.data, decisions: inbox.decisions }, topic)}
          active={stage}
          onPick={(key) => setStage((current) => (current === key ? null : key))}
          titles={{
            review: `approved items go out with the next digest; the agent picks up decisions at the start of its next run (${cadence})`,
          }}
        />
        <TopicChips
          config={config}
          counts={topicCounts(items, config.topics.map((t) => t.slug))}
          topic={topic}
          onPick={setTopic}
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
          />
          <section className="cr-pane cr-flow" aria-label="Config and outcomes">
            <header className="cr-pane-head">
              <span className="cr-label">Config</span>
              <span className="agent-muted">from main · a criteria change re-scores the topic</span>
            </header>
            <div className="cr-scroll">
              <ConfigSpine
                config={config}
                topic={topic}
                active={stage}
                onPick={setStage}
                verdicts={state.data ? topicVerdicts(state.data, slugs) : null}
              />
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
