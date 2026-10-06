"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { type AgentStatus, isAgentStatus, isStale, STATUS_URL } from "@/lib/agent-status";
import TonyMark from "@/components/TonyMark";
import { TELEGRAM_CHANNEL } from "@/lib/telegram-post";

const FEATURES = ["themes", "inbox", "publishing", "live runs"];

/**
 * The home page's teaser for Tony Scraponi, the agent's coming control
 * room, under the columns: two dense lines on the home cards' surface.
 * Left: the name and what it is, then the features. Right:
 * a proof line from the agent's live status.json (hidden until it loads)
 * then "open ↗" (the control room) and "follow the build ↗" (Telegram).
 */
export default function AppsStrip() {
  const [status, setStatus] = useState<AgentStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(STATUS_URL, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: unknown) => {
        if (!cancelled && isAgentStatus(data)) setStatus(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const found = status?.topics.reduce((n, t) => n + t.collected, 0) ?? 0;
  const kept = status?.topics.reduce((n, t) => n + t.kept, 0) ?? 0;
  const live = status !== null && !isStale(status);

  return (
    <section id="apps">
      <div className="wrap">
        <article className="tony-card">
          <TonyMark size={36} />
          <div className="tony-copy">
            <p className="tony-head">
              <span className="tony-name">Tony Scraponi</span>
              <span className="tony-pitch">a control room for the research agent</span>
            </p>
            <ul className="tony-features">
              {FEATURES.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </div>
          <div className="tony-side">
            <p className="tony-proof">
              {status && (
                <>
                  <span className={live ? "agent-dot-online" : "agent-muted"} aria-hidden="true">
                    ●
                  </span>{" "}
                  agent {live ? "live" : "paused"} · <b>{found}</b> found · <b>{kept}</b> kept ·{" "}
                  <b>{status.pending_count}</b> queued
                </>
              )}
            </p>
            <p className="tony-links">
              <Link className="card-action" href="/researcher/queue/">
                Open <span aria-hidden="true">↗</span>
              </Link>
              <a className="card-action" href={`https://t.me/${TELEGRAM_CHANNEL}`}>
                Follow the build <span aria-hidden="true">↗</span>
              </a>
            </p>
          </div>
          <div className="card-comet" aria-hidden="true">
            <span className="card-comet-run" />
          </div>
        </article>
      </div>
    </section>
  );
}
