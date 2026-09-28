import type { Playlist } from "@/lib/yandex-music";
import { formatDuration } from "@/lib/now-format";

interface Props {
  playlist: Playlist;
  open: boolean;
  onToggle: () => void;
}

/**
 * One playlist: mosaic, title (links to Yandex), meta, and a play toggle.
 * The Yandex iframe is only mounted while open — it has no dark theme,
 * and three of them on first paint would be heavy on mobile.
 */
export default function PlaylistCard({ playlist, open, onToggle }: Props) {
  const panelId = `player-${playlist.uuid}`;
  return (
    <div className="now-playlist">
      <div className="now-playlist-row">
        <div
          className="now-mosaic"
          data-count={playlist.coverTiles.length}
          aria-hidden="true"
        >
          {playlist.coverTiles.map((src, i) => (
            // Keyed by position: a mosaic can repeat a cover. The list is static.
            // eslint-disable-next-line @next/next/no-img-element
            <img key={i} src={src} alt="" width={32} height={32} loading="lazy" />
          ))}
        </div>
        <div className="now-playlist-body">
          <a
            className="now-playlist-title"
            href={playlist.url}
            target="_blank"
            rel="noopener noreferrer"
          >
            {playlist.title}
          </a>
          <span className="now-playlist-meta">
            {playlist.trackCount} tracks · {formatDuration(playlist.durationMs)}
          </span>
          <button
            type="button"
            className="now-play"
            aria-expanded={open}
            aria-controls={panelId}
            aria-label={`${open ? "Close" : "Play"} ${playlist.title}`}
            onClick={onToggle}
          >
            {open ? "▾ close" : "▸ play"}
          </button>
        </div>
      </div>
      <div id={panelId} className="now-player" hidden={!open}>
        {open && (
          <iframe
            src={playlist.embedUrl}
            title={`Yandex Music player: ${playlist.title}`}
            loading="lazy"
            allow="autoplay; encrypted-media"
          />
        )}
      </div>
    </div>
  );
}
