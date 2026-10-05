"use client";

import { useEffect, useState } from "react";
import { type Presence, parsePresence } from "@/lib/claude-presence";
import { PRESENCE_POLL_MS, PRESENCE_URL } from "@/lib/now-config";

export type PresenceLoad =
  | { kind: "loading" }
  | { kind: "failed" }
  | { kind: "ok"; presence: Presence };

/**
 * Reads presence.json from the presence-data branch on mount, then every
 * PRESENCE_POLL_MS while the tab is visible. A failed refresh after a
 * good one keeps the last good payload — presenceView() still flips it
 * to offline once it goes stale. `now` ticks every minute so relative
 * times ("4 min ago") keep moving between polls.
 *
 * Used by ClaudePresence (on /now/ and in the home hero).
 */
export function usePresence(): { load: PresenceLoad; now: number } {
  const [load, setLoad] = useState<PresenceLoad>({ kind: "loading" });
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
    const clock = setInterval(() => setNow(Date.now()), 60_000);
    document.addEventListener("visibilitychange", refreshIfVisible);
    return () => {
      cancelled = true;
      clearInterval(poll);
      clearInterval(clock);
      document.removeEventListener("visibilitychange", refreshIfVisible);
    };
  }, []);

  return { load, now };
}
