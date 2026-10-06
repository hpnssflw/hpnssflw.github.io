"use client";

import { useState } from "react";
import ControlPulse from "@/components/ControlPulse";
import QueuePane from "@/components/QueuePane";
import { useInbox } from "@/components/useInbox";
import { useJson } from "@/components/useJson";
import type { AgentConfig } from "@/lib/agent-config";
import { type AgentStatus, STATUS_URL, isAgentStatus } from "@/lib/agent-status";
import type { Decision } from "@/lib/inbox";
import { type PendingItem, type PendingQueue, PENDING_URL, isPendingQueue } from "@/lib/pending-queue";
import type { TopicFilter } from "@/lib/pipeline-stages";
import {
  type StatusFilter,
  nextSelection,
  resolveSelection,
  statusCounts,
  topicCounts,
  visibleItems,
} from "@/lib/queue-view";

const acceptStatus = (value: unknown): AgentStatus | null => (isAgentStatus(value) ? value : null);
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
 * status.json, pending.json, the inbox decisions — is fetched here, each
 * on its own, so one failing source never blanks the rest.
 */
export default function ControlRoom({ config }: { config: AgentConfig }) {
  const status = useJson(STATUS_URL, acceptStatus);
  const pending = useJson(PENDING_URL, acceptQueue);
  const inbox = useInbox(pending.data, pending.loadedAt);

  const [topic, setTopic] = useState<TopicFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("waiting");
  const [selectedUrl, setSelectedUrl] = useState<string | null>(null);

  const items = pending.data?.items ?? [];
  const rows = visibleItems(items, inbox.decisions, topic, statusFilter);
  const topicNames = topic === "all" ? Object.fromEntries(config.topics.map((t) => [t.slug, t.name])) : null;

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
        </div>
      </div>
    </section>
  );
}
