"use client";

import { type FormEvent, useState } from "react";
import type { Decision, ItemStatus } from "@/lib/inbox";

const TOKEN_KEY = "tony-inbox-token";

/* localStorage can throw (blocked site data, some private modes); any
   failure just means public mode. */

export function readToken(): string | null {
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function writeToken(token: string): void {
  try {
    window.localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // Not persisted: owner mode lasts for this page view only.
  }
}

export function clearToken(): void {
  try {
    window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Nothing stored to clear.
  }
}

export function InboxItemActions({
  status,
  disabled,
  onDecide,
}: {
  status: ItemStatus;
  disabled: boolean;
  onDecide: (decision: Decision | null) => void;
}) {
  return (
    <div className="inbox-actions">
      {status === "waiting" ? (
        <>
          <button
            type="button"
            className="inbox-button"
            disabled={disabled}
            onClick={() => onDecide("approve")}
          >
            approve
          </button>
          <button
            type="button"
            className="inbox-button"
            disabled={disabled}
            onClick={() => onDecide("reject")}
          >
            reject
          </button>
        </>
      ) : (
        <button
          type="button"
          className="inbox-button"
          disabled={disabled}
          onClick={() => onDecide(null)}
        >
          undo
        </button>
      )}
    </div>
  );
}

export function InboxOwnerBar({
  signedIn,
  error,
  onSignIn,
  onSignOut,
}: {
  signedIn: boolean;
  error: string | null;
  onSignIn: (token: string) => Promise<void>;
  onSignOut: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [checking, setChecking] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const candidate = draft.trim();
    if (!candidate) return;
    setChecking(true);
    await onSignIn(candidate);
    setChecking(false);
    setDraft("");
  }

  return (
    <div className="inbox-owner">
      {signedIn ? (
        <>
          <p className="inbox-note">
            approved items go out with the next digest; the agent picks up
            decisions on its run every 4 hours.
          </p>
          <button type="button" className="inbox-button" onClick={onSignOut}>
            sign out
          </button>
        </>
      ) : open ? (
        <form className="inbox-token-form" onSubmit={submit}>
          <input
            type="password"
            className="inbox-token"
            aria-label="GitHub token for hpnssflw/tony-inbox"
            placeholder="github token"
            autoComplete="off"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
          <button type="submit" className="inbox-button" disabled={checking}>
            {checking ? "checking" : "save"}
          </button>
        </form>
      ) : (
        <button type="button" className="inbox-button" onClick={() => setOpen(true)}>
          owner
        </button>
      )}
      {error && <p className="inbox-error">{error}</p>}
    </div>
  );
}
