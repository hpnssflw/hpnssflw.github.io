"use client";

import { useEffect, useState } from "react";
import { OwnerSlot } from "@/components/InboxControls";
import TonyMark from "@/components/TonyMark";
import { type AgentStatus, fmtCountdown, isStale, sparklineCells } from "@/lib/agent-status";
import { type CronSchedule, nextRun } from "@/lib/cron";

function hhmm(date: Date): string {
  return date.toISOString().slice(11, 16);
}

function ago(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return hours < 48 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`;
}

export interface OwnerControls {
  signedIn: boolean;
  error: string | null;
  onSignIn: (token: string) => Promise<void>;
  onSignOut: () => void;
}

/**
 * The control room's top strip: live/stale, the last run, the next cron
 * slot with a countdown (from agent-run.yml's schedule — a manual run at
 * 18:22 is followed by the 20:00 slot, not 22:22), streak, kept-per-run
 * sparkline, the last digest, and the owner slot.
 */
export default function ControlPulse({
  status,
  failed,
  schedule,
  owner,
}: {
  status: AgentStatus | null;
  failed: boolean;
  schedule: CronSchedule;
  owner: OwnerControls;
}) {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  const next = now === null ? null : nextRun(schedule, new Date(now));
  const stale = status !== null && now !== null && isStale(status, now);
  const cells = status ? sparklineCells(status.run_history) : [];

  return (
    <div className="cr-pulse">
      <TonyMark size={32} />
      <p className="cr-pulse-id">
        <span className="tony-name">Tony Scraponi</span>
        <span className="agent-muted">control room</span>
      </p>
      <p className="cr-pulse-line">
        {status ? (
          <>
            <span className={stale ? "agent-dot-stale" : "agent-dot-online"} aria-hidden="true">
              ●
            </span>{" "}
            {stale ? "stale" : "live"}
            <span className="cr-sep">·</span>
            last run <b>{hhmm(new Date(status.updated_at))}</b> utc
            {now !== null && <span className="agent-muted"> ({ago(now - Date.parse(status.updated_at))})</span>}
            <span className="cr-sep">·</span>
          </>
        ) : failed ? (
          <>
            <span className="agent-muted">status unavailable</span>
            <span className="cr-sep">·</span>
          </>
        ) : null}
        next <b>{next ? hhmm(next) : "--:--"}</b>
        {next && now !== null && <span className="agent-muted"> in {fmtCountdown((next.getTime() - now) / 1000)}</span>}
        {status && (
          <>
            <span className="cr-sep">·</span>
            streak <b>{status.streak}</b>
            <span className="cr-sep">·</span>
            <span className="agent-spark" title={`kept per run, last ${cells.length} runs`}>
              {cells.map((cell, i) => (
                <span key={i} className={cell.zero ? "agent-spark-zero" : undefined}>
                  {cell.glyph}
                </span>
              ))}
            </span>
            <span className="cr-sep">·</span>
            digest <b>{status.last_sent_at ? status.last_sent_at.slice(5, 10) : "never"}</b>
          </>
        )}
      </p>
      <OwnerSlot {...owner} />
      <div className="card-comet" aria-hidden="true">
        <span className="card-comet-run" />
      </div>
    </div>
  );
}
