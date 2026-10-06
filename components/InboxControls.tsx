"use client";

import { type FormEvent, useState } from "react";

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

/**
 * The control room pulse's right end: "owner" opens the token field in
 * place; signed in, "sign out". Errors (a rejected token, a failed write)
 * show under it in red.
 */
export function OwnerSlot({
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
    <div className="owner-slot">
      {signedIn ? (
        <button type="button" className="inbox-button" onClick={onSignOut}>
          sign out
        </button>
      ) : open ? (
        <form className="inbox-token-form" onSubmit={submit}>
          <input
            type="password"
            className="inbox-token"
            aria-label="GitHub token for hpnssflw/tony-inbox"
            placeholder="github token"
            autoComplete="off"
            autoFocus
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
