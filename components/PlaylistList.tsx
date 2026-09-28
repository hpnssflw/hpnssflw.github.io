"use client";

import { useState } from "react";
import type { Playlist } from "@/lib/yandex-music";
import PlaylistCard from "./PlaylistCard";

/** Owns which single player is open; opening one closes the other. */
export default function PlaylistList({ playlists }: { playlists: Playlist[] }) {
  const [openUuid, setOpenUuid] = useState<string | null>(null);
  return (
    <ul className="now-playlists">
      {playlists.map((playlist) => (
        <li key={playlist.uuid}>
          <PlaylistCard
            playlist={playlist}
            open={openUuid === playlist.uuid}
            onToggle={() =>
              setOpenUuid((current) => (current === playlist.uuid ? null : playlist.uuid))
            }
          />
        </li>
      ))}
    </ul>
  );
}
