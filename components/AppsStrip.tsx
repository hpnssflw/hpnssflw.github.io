"use client";

import { useEffect, useRef, useState } from "react";
import { type AgentStatus, isAgentStatus, isStale, STATUS_URL } from "@/lib/agent-status";
import { TELEGRAM_CHANNEL } from "@/lib/telegram-post";

/**
 * Tony Scraponi's mark: a spy — fedora and dark glasses, for a scraper
 * with a mobster's name.
 */
function TonyIcon({ size = 28 }: { size?: number }) {
  return (
    <svg className="app-icon" width={size} height={size} viewBox="0 0 28 28" aria-hidden="true">
      <rect x="0.5" y="0.5" width="27" height="27" rx="6" className="app-icon-tile" />
      {/* fedora: crown with a pinched top, then a curved brim */}
      <path d="M8.5 13.2 C8.5 9.6 10.4 7.6 14 7.6 C17.6 7.6 19.5 9.6 19.5 13.2" className="app-icon-line" />
      <path d="M11 9.6 Q14 11.2 17 9.6" className="app-icon-line" />
      <path d="M4.8 13.6 Q14 17.2 23.2 13.6" className="app-icon-line" />
      {/* dark glasses */}
      <circle cx="10.9" cy="19" r="2.5" className="app-icon-lens" />
      <circle cx="17.1" cy="19" r="2.5" className="app-icon-lens" />
      <path d="M13.4 18.6 Q14 18.1 14.6 18.6" className="app-icon-line" />
    </svg>
  );
}

const FEATURES = ["themes", "inbox", "publishing", "live runs"];

/**
 * The home page's promo for Tony Scraponi, the agent's coming control
 * room, under the columns — in the site's own language (the home cards'
 * surface, mono meta, lime for the agent). The proof line reads the same
 * status.json as the agent widget; it stays hidden until that loads.
 * "What's inside" opens a native <dialog> (focus trapped, Esc or a
 * backdrop click closes it).
 */
export default function AppsStrip() {
  const dialog = useRef<HTMLDialogElement>(null);
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
          <TonyIcon size={44} />
          <div className="tony-copy">
            <h2 className="tony-name">
              Tony Scraponi <span className="tony-eyebrow">app · coming soon</span>
            </h2>
            <p className="tony-pitch">
              A control room for the research agent: watch what it reads, approve what&apos;s worth
              keeping, and let it publish.
            </p>
            <ul className="tony-features">
              {FEATURES.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </div>
          <div className="tony-side">
            {status && (
              <p className="tony-proof">
                <span className={live ? "agent-dot-online" : "agent-muted"} aria-hidden="true">
                  ●
                </span>{" "}
                agent {live ? "live" : "paused"} · last run <b>{found}</b> found · <b>{kept}</b>{" "}
                kept · <b>{status.pending_count}</b> in queue
              </p>
            )}
            <div className="tony-cta">
              <a className="tony-btn" href={`https://t.me/${TELEGRAM_CHANNEL}`}>
                Follow the build <span aria-hidden="true">↗</span>
              </a>
              <button type="button" className="tony-more" onClick={() => dialog.current?.showModal()}>
                What&apos;s inside <span aria-hidden="true">→</span>
              </button>
            </div>
          </div>
          <div className="card-comet" aria-hidden="true">
            <span className="card-comet-run" />
          </div>
        </article>
        <dialog
          ref={dialog}
          className="app-dialog"
          aria-labelledby="app-dialog-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) e.currentTarget.close();
          }}
        >
          <div className="app-dialog-body">
            <TonyIcon size={40} />
            <p className="app-dialog-title" id="app-dialog-title">
              Tony Scraponi
            </p>
            <p className="app-dialog-soon">Coming soon…</p>
            <p className="app-dialog-text">
              A control room for the research agent: its themes, the queue of what it found, and
              what got published.
            </p>
            <form method="dialog">
              <button type="submit" className="card-action app-dialog-close">
                Close
              </button>
            </form>
          </div>
        </dialog>
      </div>
    </section>
  );
}
