"use client";

import { useEffect, useState } from "react";
import { type Presence, parsePresence, presenceView } from "@/lib/claude-presence";
import { PRESENCE_POLL_MS, PRESENCE_URL } from "@/lib/now-config";

const GLYPH = { working: "●", waiting: "◐", offline: "○" } as const;

type Load =
  | { kind: "loading" }
  | { kind: "failed" }
  | { kind: "ok"; presence: Presence };

/**
 * Reads presence.json from the presence-data branch on mount, then every
 * PRESENCE_POLL_MS while the tab is visible. A failed refresh after a
 * good one keeps the last good payload — presenceView() still flips it
 * to offline once it goes stale.
 *
 * `block` is /now/'s three-line widget; `inline` is the home hero's one
 * line (status, then today's stats muted, no "updated" footer).
 */
export default function ClaudePresence({
  variant = "block",
}: {
  variant?: "block" | "inline";
}) {
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [now, setNow] = useState(0);

  useEffect(() => {
    let cancelled = false;

    const refresh = () => {
      fetch(PRESENCE_URL, { cache: "no-store" })
        .then((res) => {
          if (!res.ok) throw new Error(`presence fetch failed: ${res.status}`);
          return res.json();
        })
        .then((data: unknown) => {
          if (cancelled) return;
          const presence = parsePresence(data);
          setLoad((prev) =>
            presence
              ? { kind: "ok", presence }
              : prev.kind === "ok"
                ? prev
                : { kind: "failed" },
          );
          setNow(Date.now());
        })
        .catch(() => {
          if (!cancelled) setLoad((prev) => (prev.kind === "ok" ? prev : { kind: "failed" }));
        });
    };

    const refreshIfVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };

    refresh();
    const poll = setInterval(refreshIfVisible, PRESENCE_POLL_MS);
    // Relative times ("4 min ago") keep ticking between polls.
    const clock = setInterval(() => setNow(Date.now()), 60_000);
    document.addEventListener("visibilitychange", refreshIfVisible);
    return () => {
      cancelled = true;
      clearInterval(poll);
      clearInterval(clock);
      document.removeEventListener("visibilitychange", refreshIfVisible);
    };
  }, []);

  const root = variant === "inline" ? "presence-inline" : "now-presence";
  if (load.kind === "loading") return <p className={root}>…</p>;
  if (load.kind === "failed") {
    return <p className={`${root} now-muted`}>status unavailable</p>;
  }

  const view = presenceView(load.presence, now);
  const dot = (
    <span className={`now-dot now-dot-${view.state}`} aria-hidden="true">
      {GLYPH[view.state]}
    </span>
  );

  if (variant === "inline") {
    const rest = [view.today, load.presence.model].filter(Boolean).join(" · ");
    return (
      <p className={root}>
        {dot} {view.headline}
        {rest && <span className="now-muted"> · {rest}</span>}
      </p>
    );
  }

  return (
    <div className="now-presence">
      <p>
        {dot} {view.headline}
      </p>
      {view.today && <p className="now-presence-sub">{view.today}</p>}
      <p className="now-presence-sub">{view.footer}</p>
    </div>
  );
}
