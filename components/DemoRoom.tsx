"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import ConfigSpine from "@/components/ConfigSpine";
import DigestPanel from "@/components/DigestPanel";
import PipelineRail from "@/components/PipelineRail";
import QueuePane from "@/components/QueuePane";
import TopicChips from "@/components/TopicChips";
import { configView } from "@/lib/config-view";
import { TEXT } from "@/lib/control-room-text";
import type { Demo, DemoLink } from "@/lib/demo-presets";
import { digestBlocks, recordedDigest } from "@/lib/digest";
import { type Decision, type Decisions, EMPTY_DECISIONS, itemStatus, setDecision } from "@/lib/inbox";
import type { PendingItem } from "@/lib/pending-queue";
import { type StageKey, type TopicFilter, buildStages } from "@/lib/pipeline-stages";
import {
  type StatusFilter,
  nextSelection,
  resolveSelection,
  statusCounts,
  topicCounts,
  visibleItems,
} from "@/lib/queue-view";
import type { RunResult } from "@/lib/run-result";

/** A run's own decisions on its queue items, as the queue pane reads them. */
function recordedDecisions(run: RunResult): Decisions {
  const decisions: Decisions["decisions"] = {};
  for (const item of run.queue.items) {
    if (item.decision) decisions[item.url] = { decision: item.decision, at: run.run.at };
  }
  return { version: 1, decisions };
}

/**
 * A demo preset (/researcher/demo/<slug>/): the control room's shell over
 * the engine's two recorded offline runs, in the preset's language. Run 1
 * is a sandbox — the visitor approves and rejects, the review stage and
 * the digest preview follow, nothing is saved; run 2 is what the engine
 * did with the preset's own decisions, and the digest it sent.
 */
export default function DemoRoom({ demo, presets }: { demo: Demo; presets: DemoLink[] }) {
  const { run1, run2 } = demo;
  const language = run1.preset.language;
  const text = TEXT[language];

  const [runNo, setRunNo] = useState<1 | 2>(1);
  const [sandbox, setSandbox] = useState<Decisions>(EMPTY_DECISIONS);
  const [topic, setTopic] = useState<TopicFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("waiting");
  const [selectedUrl, setSelectedUrl] = useState<string | null>(null);
  const [stage, setStage] = useState<StageKey | null>(null);

  const run = runNo === 1 ? run1 : run2;
  const config = useMemo(() => configView(run.config), [run]);
  const recorded = useMemo(() => recordedDecisions(run2), [run2]);
  const decisions = runNo === 1 ? sandbox : recorded;
  const items: PendingItem[] = run.queue.items;
  const slugs = config.topics.map((t) => t.slug);
  const rows = visibleItems(items, decisions, topic, statusFilter);
  const digest =
    runNo === 1
      ? digestBlocks(
          run1.queue.items.filter((i) => itemStatus(sandbox, i.url) === "approved"),
          run1.config.delivery.title,
          language,
        )
      : recordedDigest(run1);

  function pickRun(next: 1 | 2) {
    setRunNo(next);
    setStatusFilter(next === 1 ? "waiting" : "all");
    setSelectedUrl(null);
  }

  function decide(item: PendingItem, decision: Decision | null) {
    setSelectedUrl(nextSelection(rows, item.url));
    setSandbox((current) => setDecision(current, item.url, decision, new Date()));
  }

  return (
    <section className="cr" lang={language}>
      <div className="wrap cr-wrap">
        <header className="cr-pulse cr-demo-head">
          <p className="cr-pulse-id">
            <span className="tony-name">{run1.preset.name}</span>
            <span className="agent-muted">{text.demo.tag(run1.run.at.slice(0, 10))}</span>
          </p>
          <div className="cr-runs">
            <div className="cr-chips" role="group" aria-label={text.demo.runs}>
              {([1, 2] as const).map((n) => (
                <button key={n} type="button" className="cr-chip" aria-pressed={runNo === n} onClick={() => pickRun(n)}>
                  {n === 1 ? text.demo.run1 : text.demo.run2}
                </button>
              ))}
            </div>
            {runNo === 1 && (
              <p className="cr-sandbox agent-muted">
                {text.demo.sandbox} ·{" "}
                <button type="button" className="cr-chip" onClick={() => setSandbox(EMPTY_DECISIONS)}>
                  {text.queue.reset}
                </button>
              </p>
            )}
          </div>
          <nav className="cr-demo-nav" aria-label={text.demo.switcher}>
            {presets.map((preset) => (
              <Link
                key={preset.slug}
                href={`/researcher/demo/${preset.slug}/`}
                aria-current={preset.slug === demo.slug ? "page" : undefined}
              >
                {preset.name}
              </Link>
            ))}
            <Link href="/researcher/queue/">{text.demo.tonyLive}</Link>
          </nav>
        </header>
        <PipelineRail
          stages={buildStages(run, { queue: null, decisions: runNo === 1 ? sandbox : null }, topic, text.rail)}
          active={stage}
          onPick={(key) => setStage((current) => (current === key ? null : key))}
          titles={{}}
          text={text}
        />
        <TopicChips topics={config.topics} counts={topicCounts(items, slugs)} topic={topic} onPick={setTopic} text={text.topics} />
        <div className="cr-grid">
          <QueuePane
            rows={rows}
            counts={statusCounts(items, decisions, topic)}
            statusFilter={statusFilter}
            onStatusFilter={setStatusFilter}
            selected={resolveSelection(rows, selectedUrl)}
            onSelect={setSelectedUrl}
            decisions={decisions}
            topicNames={topic === "all" ? Object.fromEntries(config.topics.map((t) => [t.slug, t.name])) : null}
            canDecide={runNo === 1}
            busy={false}
            loaded
            failed={false}
            onDecide={decide}
            text={text.queue}
          />
          <section className="cr-pane cr-flow" aria-label={text.demo.region}>
            <header className="cr-pane-head">
              <span className="cr-label">{text.demo.digest}</span>
              <span className="agent-muted">{runNo === 1 ? text.demo.digestPreview : text.demo.digestSent}</span>
            </header>
            <div className="cr-scroll">
              <DigestPanel digest={digest} empty={text.demo.digestEmpty} />
              <p className="cr-label cr-demo-config">{text.configPane.label}</p>
              <ConfigSpine config={config} topic={topic} active={stage} onPick={setStage} verdicts={null} text={text} />
            </div>
          </section>
        </div>
      </div>
    </section>
  );
}
