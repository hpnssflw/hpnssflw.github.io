"use client";

import { meterCells, presenceView } from "@/lib/claude-presence";
import { formatDuration } from "@/lib/now-format";
import { GLYPH } from "./ClaudePresence";
import { usePresence } from "./usePresence";

/**
 * The home hero's Claude Code widget, beside the GitHub grid: the status
 * line, a 24-cell meter of today's active hours (meterCells — a count,
 * not a clock) in the same 8px cells as the grid, and a caption on the
 * grid caption's baseline. Every state renders the same three rows, so
 * the card never jumps when the data arrives.
 */
export default function ClaudeWidget() {
  const { load, now } = usePresence();
  const presence = load.kind === "ok" ? load.presence : null;
  const view = presence ? presenceView(presence, now) : null;
  // presenceView drops "today" for another day's file or zero sessions.
  const todayMinutes = presence && view?.today ? presence.todayMinutes : 0;
  const cells = meterCells(todayMinutes, view?.state ?? "offline");

  return (
    <div className={`cc${view?.state === "working" ? " cc-working" : ""}`}>
      <p className="cc-status">
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
      <div className="cc-meter" aria-hidden="true">
        {cells.map((cell, i) => (
          <i key={i} className={cell.live ? `${cell.fill} live` : cell.fill} />
        ))}
      </div>
      <p className="cc-caption">
        claude code
        {presence && view?.today && (
          <>
            {" · "}
            <span className="cc-total">{formatDuration(todayMinutes * 60_000)}</span> today ·{" "}
            {presence.sessionsToday} {presence.sessionsToday === 1 ? "session" : "sessions"}
          </>
        )}
      </p>
    </div>
  );
}
