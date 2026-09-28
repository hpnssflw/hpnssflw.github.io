"use client";

import { useEffect, useState } from "react";
import { PLAYLISTS_URL, YANDEX_MUSIC_FALLBACK_URL } from "@/lib/now-config";
import { type Playlist, normalizePlaylists } from "@/lib/yandex-music";
import PlaylistList from "./PlaylistList";

type Load =
  | { kind: "loading" }
  | { kind: "failed" }
  | { kind: "ok"; playlists: Playlist[] };

/**
 * Reads playlists.json from the presence-data branch once on mount.
 * scripts/presence/run.mjs publishes it from Artem's machine, because the
 * Yandex API refuses both browsers (403) and GitHub's runners (451). No
 * polling: playlists change every few days.
 */
export default function NowMusic() {
  const [load, setLoad] = useState<Load>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    fetch(PLAYLISTS_URL, { cache: "no-store" })
      .then((res) => {
        if (!res.ok) throw new Error(`playlists fetch failed: ${res.status}`);
        return res.json();
      })
      .then((data: unknown) => {
        if (cancelled) return;
        const playlists = normalizePlaylists(data);
        setLoad(playlists.length > 0 ? { kind: "ok", playlists } : { kind: "failed" });
      })
      .catch(() => {
        if (!cancelled) setLoad({ kind: "failed" });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (load.kind === "loading") return <p className="now-loading">…</p>;
  if (load.kind === "failed") {
    return (
      <a
        className="now-fallback"
        href={YANDEX_MUSIC_FALLBACK_URL}
        target="_blank"
        rel="noopener noreferrer"
      >
        yandex music ↗
      </a>
    );
  }
  return <PlaylistList playlists={load.playlists} />;
}
