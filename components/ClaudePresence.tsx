"use client";

import { presenceView } from "@/lib/claude-presence";
import { usePresence } from "./usePresence";

export const GLYPH = { working: "●", waiting: "◐", offline: "○" } as const;

/** /now/'s three-line Claude Code widget (data: usePresence). */
export default function ClaudePresence() {
  const { load, now } = usePresence();

  if (load.kind === "loading") return <p className="now-presence">…</p>;
  if (load.kind === "failed") {
    return <p className="now-presence now-muted">status unavailable</p>;
  }

  const view = presenceView(load.presence, now);
  return (
    <div className="now-presence">
      <p>
        <span className={`now-dot now-dot-${view.state}`} aria-hidden="true">
          {GLYPH[view.state]}
        </span>{" "}
        {view.headline}
      </p>
      {view.today && <p className="now-presence-sub">{view.today}</p>}
      <p className="now-presence-sub">{view.footer}</p>
    </div>
  );
}
