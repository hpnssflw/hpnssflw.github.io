"use client";

import { useEffect, useState } from "react";
import { type AgentStatus, isAgentStatus, isStale, STATUS_URL } from "@/lib/agent-status";
import { TELEGRAM_CHANNEL } from "@/lib/telegram-post";

/**
 * Tony Scraponi's mark: a spy — a lime fedora with a band, dark glasses —
 * for a scraper with a mobster's name. Now and then the hat tips and a
 * glint crosses the lenses (CSS, off under reduced motion).
 */
function TonyIcon({ size = 28 }: { size?: number }) {
  return (
    <svg className="app-icon" width={size} height={size} viewBox="0 0 28 28" aria-hidden="true">
      <defs>
        <clipPath id="tony-lenses">
          <circle cx="10.9" cy="19" r="2.6" />
          <circle cx="17.1" cy="19" r="2.6" />
        </clipPath>
      </defs>
      <rect x="0.5" y="0.5" width="27" height="27" rx="6" className="app-icon-tile" />
      <g className="tony-hat">
        <path d="M8.5 13.2 C8.5 9.6 10.4 7.6 14 7.6 C17.6 7.6 19.5 9.6 19.5 13.2 Z" className="tony-hat-crown" />
        <path d="M11 9.6 Q14 11.2 17 9.6" className="tony-hat-dent" />
        <path d="M8.7 11.9 L19.3 11.9" className="tony-hat-band" />
        <path d="M4.6 13.5 Q14 17.4 23.4 13.5 Q14 15.4 4.6 13.5 Z" className="tony-hat-brim" />
      </g>
      <circle cx="10.9" cy="19" r="2.6" className="tony-lens" />
      <circle cx="17.1" cy="19" r="2.6" className="tony-lens" />
      <path d="M13.5 18.6 Q14 18.1 14.5 18.6" className="tony-bridge" />
      <g clipPath="url(#tony-lenses)">
        <rect x="6" y="14" width="2.2" height="10" className="tony-glint" />
      </g>
    </svg>
  );
}

const FEATURES = ["themes", "inbox", "publishing", "live runs"];

/**
 * The home page's teaser for Tony Scraponi, the agent's coming control
 * room, under the columns: two dense lines on the home cards' surface.
 * Left: the name, "coming soon" and what it is, then the features. Right:
 * a proof line from the agent's live status.json (hidden until it loads)
 * and "follow the build ↗" to the Telegram channel.
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
          <TonyIcon size={36} />
          <div className="tony-copy">
            <p className="tony-head">
              <span className="tony-name">Tony Scraponi</span>
              <span className="tony-eyebrow">coming soon</span>
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
            <a className="card-action tony-follow" href={`https://t.me/${TELEGRAM_CHANNEL}`}>
              Follow the build <span aria-hidden="true">↗</span>
            </a>
          </div>
          <div className="card-comet" aria-hidden="true">
            <span className="card-comet-run" />
          </div>
        </article>
      </div>
    </section>
  );
}
