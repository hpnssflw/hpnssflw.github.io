"use client";

import { useRef } from "react";

/** Tony Scraponi's mark: a small radar — the agent watching its themes. */
function TonyIcon({ size = 28 }: { size?: number }) {
  return (
    <svg className="app-icon" width={size} height={size} viewBox="0 0 28 28" aria-hidden="true">
      <rect x="0.5" y="0.5" width="27" height="27" rx="6" className="app-icon-tile" />
      <circle cx="14" cy="14" r="8" className="app-icon-ring" />
      <circle cx="14" cy="14" r="4" className="app-icon-ring" />
      <path d="M14 14 L19.7 8.3" className="app-icon-sweep" />
      <circle cx="17.5" cy="10.8" r="1.6" className="app-icon-blip" />
    </svg>
  );
}

/**
 * The home page's apps, under the columns: one low full-width strip per
 * app on the home cards' surface, no section label. Apps that aren't out
 * yet open a "coming soon" dialog (native <dialog>: focus is trapped, Esc
 * closes it; a click on the backdrop does too).
 */
export default function AppsStrip() {
  const dialog = useRef<HTMLDialogElement>(null);

  return (
    <section id="apps">
      <div className="wrap">
        <ul className="apps-list" aria-label="Apps">
          <li>
            <button type="button" className="app-tile" onClick={() => dialog.current?.showModal()}>
              <TonyIcon />
              <span className="app-text">
                <span className="app-name">Tony Scraponi</span>
                <span className="app-desc"> — a control room for the research agent</span>
              </span>
              <span className="app-soon">
                Coming soon <span aria-hidden="true">→</span>
              </span>
            </button>
          </li>
        </ul>
        <dialog
          ref={dialog}
          className="app-dialog"
          aria-labelledby="app-dialog-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) e.currentTarget.close();
          }}
        >
          <div className="app-dialog-body">
            <TonyIcon size={40} />
            <p className="app-dialog-title" id="app-dialog-title">
              Tony Scraponi
            </p>
            <p className="app-dialog-soon">Coming soon…</p>
            <p className="app-dialog-text">
              A control room for the research agent: its themes, the queue of what it found, and
              what got published.
            </p>
            <form method="dialog">
              <button type="submit" className="card-action app-dialog-close">
                Close
              </button>
            </form>
          </div>
        </dialog>
      </div>
    </section>
  );
}
