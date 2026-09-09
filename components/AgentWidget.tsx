"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  type AgentStatus,
  type SparkCell,
  STATUS_URL,
  fmtCountdown,
  isStale,
  nextRunAt,
  sparklineCells,
} from "@/lib/agent-status";

type Variant = "compact" | "dashboard";

function Spark({ cells }: { cells: SparkCell[] }) {
  return (
    <>
      {cells.map((c, i) =>
        c.zero ? (
          <span key={i} className="agent-spark-zero">
            ▁
          </span>
        ) : (
          <span key={i}>{c.glyph}</span>
        ),
      )}
    </>
  );
}

function Unavailable() {
  return <p className="agent-unavailable mono">agent status unavailable</p>;
}

export default function AgentWidget({ variant }: { variant: Variant }) {
  const mountId = variant === "compact" ? "agent-widget" : "agent-dashboard";

  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [failed, setFailed] = useState(false);
  const [countdown, setCountdown] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    fetch(STATUS_URL, { cache: "no-store" })
      .then((res) => {
        if (!res.ok) throw new Error(`status fetch failed: ${res.status}`);
        return res.json();
      })
      .then((data: AgentStatus) => {
        if (!cancelled) setStatus(data);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!status || variant !== "compact") return;
    const target = nextRunAt(status);
    const tick = () => {
      const remaining = Math.round((target - Date.now()) / 1000);
      setCountdown(`next check ${fmtCountdown(remaining)}`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [status, variant]);

  if (variant === "compact") {
    return (
      <div id={mountId}>
        {failed ? (
          <Unavailable />
        ) : status ? (
          <CompactBody status={status} countdown={countdown} />
        ) : null}
      </div>
    );
  }

  return (
    <div id={mountId}>
      {failed ? <Unavailable /> : status ? <DashboardBody status={status} /> : null}
    </div>
  );
}

function CompactBody({
  status,
  countdown,
}: {
  status: AgentStatus;
  countdown: string;
}) {
  const stale = isStale(status);
  const dotClass = stale ? "agent-dot-stale" : "agent-dot-online";
  const label = stale ? "stale" : "online";
  const cells = sparklineCells(status.run_history);

  return (
    <Link className="agent-widget-link" href="/researcher/agent/">
      <span className={dotClass}>●</span> agent {label}
      <span className="agent-muted">
        {" "}
        · runs every {status.cadence_hours}h · streak {status.streak}
      </span>
      <br />
      <span className="agent-tagline">
        schema-validated LLM ranking · full audit trail
      </span>
      <br />
      <span className="agent-spark">
        <Spark cells={cells} />
      </span>{" "}
      <span className="agent-muted">
        last {status.run_history.length} runs
      </span>
      <br />
      <span className="agent-topics">
        {status.topics.map((t, i) => (
          <span key={t.slug}>
            {i > 0 ? "   " : ""}
            {t.name}{" "}
            <span className="agent-count">
              {t.kept}/{t.collected}
            </span>
          </span>
        ))}
      </span>
      <br />
      <span className="agent-muted">{countdown}</span>{" "}
      <span className="agent-arrow">view dashboard →</span>
    </Link>
  );
}

function DashboardBody({ status }: { status: AgentStatus }) {
  const stale = isStale(status);
  const dotClass = stale ? "agent-dot-stale" : "agent-dot-online";
  const label = stale ? "stale" : "online";
  const cells = sparklineCells(status.run_history);

  return (
    <>
      <div className="agent-dashboard-header">
        <span className={dotClass}>●</span> AGENT{" "}
        <span className="agent-status-word">{label}</span>{" "}
        <span className="agent-muted">
          runs every {status.cadence_hours}h · streak {status.streak}
        </span>
      </div>
      <div>
        <span className="agent-muted">
          {status.pending_email_count} queued for next digest
        </span>
      </div>
      <p className="agent-tagline">
        Building production AI pipelines: schema-validated LLM calls, automatic
        fallback, full audit trail of every decision the ranker makes.
      </p>
      <div className="agent-spark">
        <Spark cells={cells} />{" "}
        <span className="agent-muted">
          last {status.run_history.length} runs
        </span>
      </div>
      <hr className="agent-divider" />
      <div className="agent-funnel">
        {status.topics.map((t) => {
          const f = status.funnel[t.slug];
          return (
            <div className="agent-funnel-row" key={t.slug}>
              <span className="agent-funnel-label">{t.name}</span>
              <span className="agent-funnel-counts">
                collected {f.collected} → in-window {f.in_window} → new {f.new} →
                kept {f.kept}
              </span>
            </div>
          );
        })}
      </div>
      <hr className="agent-divider" />
      <div className="agent-ticker">
        {status.recent_events.map((e, i) => {
          const kept = e.verdict === "kept";
          const detail = kept ? `score ${e.score}` : e.reason;
          return (
            <div className="agent-ticker-row" key={i}>
              <span className="agent-muted">{e.ts.slice(11, 19)}</span>{" "}
              <span className={kept ? "agent-kept" : "agent-drop"}>
                {kept ? "KEPT" : "DROP"}
              </span>{" "}
              <span className="agent-ticker-topic">{e.topic}</span>{" "}
              <span className="agent-ticker-title">&quot;{e.title}&quot;</span>{" "}
              <span className="agent-muted">{detail}</span>
            </div>
          );
        })}
      </div>
    </>
  );
}
