"use client";

import { useEffect, useRef } from "react";
import { type Decision, type Decisions, itemStatus } from "@/lib/inbox";
import type { PendingItem } from "@/lib/pending-queue";
import { STATUS_FILTERS, type StatusFilter, moveSelection } from "@/lib/queue-view";

function domain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function typingIn(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
  );
}

/**
 * The moderation queue: status chips, one row per item (score, title,
 * source · domain · topic · date), the selected row unfolded with its
 * summary and actions. Keys: j/k move and o opens for everyone; a/r/u
 * approve, reject and undo for the owner.
 */
export default function QueuePane({
  rows,
  counts,
  statusFilter,
  onStatusFilter,
  selected,
  onSelect,
  decisions,
  topicNames,
  canDecide,
  busy,
  loaded,
  failed,
  onDecide,
}: {
  rows: PendingItem[];
  counts: Record<StatusFilter, number>;
  statusFilter: StatusFilter;
  onStatusFilter: (status: StatusFilter) => void;
  selected: PendingItem | null;
  onSelect: (url: string | null) => void;
  decisions: Decisions | null;
  /** slug → name, shown in each row's meta line; null when one topic is picked. */
  topicNames: Record<string, string> | null;
  canDecide: boolean;
  busy: boolean;
  loaded: boolean;
  failed: boolean;
  onDecide: (item: PendingItem, decision: Decision | null) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey || typingIn(event.target)) return;
      const key = event.key;
      if (key === "j" || key === "k") {
        onSelect(moveSelection(rows, selected?.url ?? null, key === "j" ? 1 : -1));
      } else if (key === "o" && selected) {
        window.open(selected.url, "_blank", "noopener,noreferrer");
      } else if ((key === "a" || key === "r" || key === "u") && canDecide && !busy && selected) {
        const status = itemStatus(decisions, selected.url);
        if (key === "u" && status !== "waiting") onDecide(selected, null);
        if (key !== "u" && status === "waiting") onDecide(selected, key === "a" ? "approve" : "reject");
      } else {
        return;
      }
      event.preventDefault();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rows, selected, canDecide, busy, decisions, onSelect, onDecide]);

  useEffect(() => {
    listRef.current?.querySelector('[data-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [selected?.url]);

  return (
    <section className="cr-pane cr-queue" aria-label="Queue">
      <header className="cr-pane-head">
        <span className="cr-label">Queue</span>
        {decisions && (
          <div className="cr-chips" role="group" aria-label="Status">
            {STATUS_FILTERS.map((status) => (
              <button
                key={status}
                type="button"
                className="cr-chip"
                aria-pressed={statusFilter === status}
                onClick={() => onStatusFilter(status)}
              >
                {status} <span className="cr-chip-n">{counts[status]}</span>
              </button>
            ))}
          </div>
        )}
      </header>
      <div className="cr-scroll" ref={listRef}>
        {failed ? (
          <p className="agent-unavailable cr-empty">queue unavailable</p>
        ) : loaded && rows.length === 0 ? (
          <p className="agent-muted cr-empty">nothing here</p>
        ) : (
          <ul className="cr-rows">
            {rows.map((item) => {
              const on = selected?.url === item.url;
              const status = itemStatus(decisions, item.url);
              return (
                <li
                  key={item.url}
                  className="cr-row"
                  data-selected={on}
                  data-status={status}
                  onClick={() => onSelect(item.url)}
                >
                  <div className="cr-row-line">
                    <span className={item.score >= 8 ? "cr-score is-high" : "cr-score"}>{item.score}</span>
                    <span className="cr-title">{item.title}</span>
                    {decisions && status !== "waiting" && (
                      <span className={`cr-decision inbox-${status}`}>{status}</span>
                    )}
                  </div>
                  <div className="cr-meta">
                    {item.source} · {domain(item.url)}
                    {topicNames && ` · ${topicNames[item.topic] ?? item.topic}`} · {item.pending_since.slice(5, 10)}
                  </div>
                  {on && (
                    <div className="cr-open">
                      <p className="cr-summary">{item.summary}</p>
                      <div className="cr-actions">
                        {canDecide &&
                          (status === "waiting" ? (
                            <>
                              <button
                                type="button"
                                className="inbox-button cr-approve"
                                disabled={busy}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  onDecide(item, "approve");
                                }}
                              >
                                <kbd>a</kbd> approve
                              </button>
                              <button
                                type="button"
                                className="inbox-button cr-reject"
                                disabled={busy}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  onDecide(item, "reject");
                                }}
                              >
                                <kbd>r</kbd> reject
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              className="inbox-button"
                              disabled={busy}
                              onClick={(event) => {
                                event.stopPropagation();
                                onDecide(item, null);
                              }}
                            >
                              <kbd>u</kbd> undo
                            </button>
                          ))}
                        <a
                          className="inbox-button"
                          href={item.url}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(event) => event.stopPropagation()}
                        >
                          <kbd>o</kbd> open ↗
                        </a>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <p className="cr-keys">
        <kbd>j</kbd>/<kbd>k</kbd> move
        {canDecide && (
          <>
            {" "}· <kbd>a</kbd> approve · <kbd>r</kbd> reject · <kbd>u</kbd> undo
          </>
        )}{" "}
        · <kbd>o</kbd> open
      </p>
    </section>
  );
}
