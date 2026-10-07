"use client";

import { useEffect, useRef } from "react";
import { type Decision, type Decisions, itemStatus } from "@/lib/inbox";
import type { Text } from "@/lib/control-room-text";
import { type PendingItem, itemDomain, safeHref } from "@/lib/pending-queue";
import { STATUS_FILTERS, type StatusFilter, moveSelection } from "@/lib/queue-view";

function typingIn(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
  );
}

/**
 * The moderation queue: status chips, one row per item (score, title,
 * source · domain · topic · date), the selected row unfolded with its
 * summary and actions. Keys: j/k move and o opens an http(s) link for everyone; a/r/u
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
  linkItems = true,
  canDecide,
  busy,
  loaded,
  failed,
  onDecide,
  text,
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
  /** false: no open button, no `o` key, no `o` in the keys legend (the demo's URLs are synthetic). Default true. */
  linkItems?: boolean;
  canDecide: boolean;
  busy: boolean;
  loaded: boolean;
  failed: boolean;
  onDecide: (item: PendingItem, decision: Decision | null) => void;
  text: Text["queue"];
}) {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey || typingIn(event.target)) return;
      const key = event.key;
      if (key === "j" || key === "k") {
        onSelect(moveSelection(rows, selected?.url ?? null, key === "j" ? 1 : -1));
      } else if (key === "o" && linkItems && selected) {
        const href = safeHref(selected.url);
        if (href) window.open(href, "_blank", "noopener,noreferrer");
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
  }, [rows, selected, canDecide, busy, decisions, onSelect, onDecide, linkItems]);

  useEffect(() => {
    listRef.current?.querySelector('[data-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [selected?.url]);

  return (
    <section className="cr-pane cr-queue" aria-label={text.label}>
      <header className="cr-pane-head">
        <span className="cr-label">{text.label}</span>
        {decisions && (
          <div className="cr-chips" role="group" aria-label={text.statusLabel}>
            {STATUS_FILTERS.map((status) => (
              <button
                key={status}
                type="button"
                className="cr-chip"
                aria-pressed={statusFilter === status}
                onClick={() => onStatusFilter(status)}
              >
                {text.statuses[status]} <span className="cr-chip-n">{counts[status]}</span>
              </button>
            ))}
          </div>
        )}
      </header>
      <div className="cr-scroll" ref={listRef}>
        {failed ? (
          <p className="agent-unavailable cr-empty">{text.unavailable}</p>
        ) : loaded && rows.length === 0 ? (
          <p className="agent-muted cr-empty">{text.empty}</p>
        ) : (
          <ul className="cr-rows">
            {rows.map((item) => {
              const on = selected?.url === item.url;
              const status = itemStatus(decisions, item.url);
              const href = safeHref(item.url);
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
                      <span className={`cr-decision inbox-${status}`}>{text.statuses[status]}</span>
                    )}
                  </div>
                  <div className="cr-meta">
                    {item.source} · {itemDomain(item.url, text.invalidUrl)}
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
                                <kbd>a</kbd> {text.approve}
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
                                <kbd>r</kbd> {text.reject}
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
                              <kbd>u</kbd> {text.undo}
                            </button>
                          ))}
                        {linkItems &&
                          (href ? (
                            <a
                              className="inbox-button"
                              href={href}
                              target="_blank"
                              rel="noreferrer"
                              onClick={(event) => event.stopPropagation()}
                            >
                              <kbd>o</kbd> {text.open}
                            </a>
                          ) : (
                            <button type="button" className="inbox-button" disabled title={text.notWebLink}>
                              <kbd>o</kbd> {text.open}
                            </button>
                          ))}
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
        <kbd>j</kbd>/<kbd>k</kbd> {text.keysMove}
        {canDecide && (
          <>
            {" "}· <kbd>a</kbd> {text.approve} · <kbd>r</kbd> {text.reject} · <kbd>u</kbd> {text.undo}
          </>
        )}
        {linkItems && (
          <>
            {" "}· <kbd>o</kbd> {text.keysOpen}
          </>
        )}
      </p>
    </section>
  );
}
