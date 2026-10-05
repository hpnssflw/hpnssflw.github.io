"use client";

import { presenceView, recentDays } from "@/lib/claude-presence";
import { formatDuration } from "@/lib/now-format";
import { usePresence } from "./usePresence";

const GLYPH = { working: "●", waiting: "◐", offline: "○" } as const;
const CELL = 8;
const STEP = 10; // cell + 2px gap

/**
 * The home hero's Claude Code block, under the roles: the status line, a
 * strip of the last 28 days' active minutes (recentDays — today on the
 * right, lit while a session runs) in the GitHub grid's 8px squares, and
 * a caption. Every state renders the same three rows, so the card never
 * jumps when the data arrives.
 */
export default function ClaudeActivity() {
  const { load, now } = usePresence();
  const presence = load.kind === "ok" ? load.presence : null;
  const view = presence ? presenceView(presence, now) : null;
  const days = presence ? recentDays(presence, now) : null;
  const live = view !== null && view.state !== "offline";

  return (
    <div className="hero-claude">
      <p className="hc-status">
        {view ? (
          <>
            <span className={`now-dot now-dot-${view.state}`} aria-hidden="true">
              {GLYPH[view.state]}
            </span>{" "}
            {view.headline}
          </>
        ) : (
          <span className="now-muted">{load.kind === "failed" ? "status unavailable" : "…"}</span>
        )}
      </p>
      <svg
        className="hc-strip"
        width={28 * STEP - (STEP - CELL)}
        height={CELL}
        viewBox={`0 0 ${28 * STEP - (STEP - CELL)} ${CELL}`}
        role="img"
        aria-label="Claude Code active minutes per day, the last 28 days"
      >
        {Array.from({ length: 28 }, (_, i) => {
          const day = days?.[i];
          const cls = `l${day?.level ?? 0}${day?.today && live ? " live" : ""}`;
          return (
            <rect key={i} x={i * STEP} y={0} width={CELL} height={CELL} rx={1} className={cls}>
              {day && <title>{`${day.date}: ${formatDuration(day.minutes * 60_000)}`}</title>}
            </rect>
          );
        })}
      </svg>
      <p className="hc-caption">
        claude code
        {view?.today && presence && (
          <>
            {" · "}
            <span className="hc-total">{formatDuration(presence.todayMinutes * 60_000)}</span> today
          </>
        )}
        {" · 28 days"}
      </p>
    </div>
  );
}
