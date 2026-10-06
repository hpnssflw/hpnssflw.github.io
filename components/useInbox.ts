import { useEffect, useState } from "react";
import { clearToken, readToken, writeToken } from "@/components/InboxControls";
import { GitHubAuthError, GitHubConflictError, putFile } from "@/lib/github-contents";
import {
  type Decision,
  type Decisions,
  type OwnerSnapshot,
  DECISIONS_PATH,
  DECISIONS_REPO,
  PRUNE_GRACE_MS,
  commitMessage,
  fetchOwnerDecisions,
  fetchPublicDecisions,
  pruneDecisions,
  serializeDecisions,
  setDecision,
} from "@/lib/inbox";
import type { PendingItem, PendingQueue } from "@/lib/pending-queue";

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "something went wrong";
}

export interface Inbox {
  /** The owner's API copy when signed in, else the public file; null if neither loaded. */
  decisions: Decisions | null;
  signedIn: boolean;
  /** Signed in and the owner snapshot (with its sha) loaded: writes are possible. */
  canWrite: boolean;
  busy: boolean;
  error: string | null;
  signIn: (token: string) => Promise<void>;
  signOut: () => void;
  decide: (item: PendingItem, decision: Decision | null) => Promise<void>;
}

/**
 * The inbox's owner mode (docs/superpowers/specs/2026-09-28-tony-scraponi-inbox-design.md),
 * moved out of the old PendingQueue component unchanged: the token lives
 * in localStorage; every decision is an optimistic write of decisions.json
 * to hpnssflw/tony-inbox with the last sha, retried once on a conflict
 * after re-reading; entries for items no longer queued are pruned with a
 * grace period so a stale tab can't delete another device's decisions.
 */
export function useInbox(queue: PendingQueue | null, queueLoadedAt: Date | null): Inbox {
  const [publicDecisions, setPublicDecisions] = useState<Decisions | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [owner, setOwner] = useState<OwnerSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchPublicDecisions().then((decisions) => {
      if (!cancelled) setPublicDecisions(decisions);
    });
    const stored = readToken();
    if (stored) {
      fetchOwnerDecisions(stored)
        .then((snapshot) => {
          if (cancelled) return;
          setToken(stored);
          setOwner(snapshot);
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          if (err instanceof GitHubAuthError) {
            clearToken();
            setError("token rejected — signed out");
          } else {
            setToken(stored);
            setError(errorMessage(err));
          }
        });
    }
    return () => {
      cancelled = true;
    };
  }, []);

  async function signIn(candidate: string) {
    setError(null);
    try {
      const snapshot = await fetchOwnerDecisions(candidate);
      writeToken(candidate);
      setToken(candidate);
      setOwner(snapshot);
    } catch (err) {
      setError(err instanceof GitHubAuthError ? "token rejected — not saved" : errorMessage(err));
    }
  }

  function signOut() {
    clearToken();
    setToken(null);
    setOwner(null);
    setError(null);
  }

  async function decide(item: PendingItem, decision: Decision | null) {
    if (!token || !owner || !queue || !queueLoadedAt) return;
    const liveUrls = queue.items.map((i) => i.url);
    const keepNewerThan = new Date(queueLoadedAt.getTime() - PRUNE_GRACE_MS);
    const apply = (base: Decisions) =>
      pruneDecisions(setDecision(base, item.url, decision, new Date()), liveUrls, keepNewerThan);
    const message = commitMessage(decision ?? "undo", item.title);
    const previous = owner;
    const optimistic = apply(previous.decisions);

    setBusy(true);
    setError(null);
    setOwner({ decisions: optimistic, sha: previous.sha });
    try {
      try {
        const { sha } = await putFile(DECISIONS_REPO, DECISIONS_PATH, serializeDecisions(optimistic), previous.sha, message, token);
        setOwner({ decisions: optimistic, sha });
      } catch (err) {
        if (!(err instanceof GitHubConflictError)) throw err;
        // Stale sha (e.g. another tab wrote first): re-read, re-apply, retry once.
        const fresh = await fetchOwnerDecisions(token);
        const retried = apply(fresh.decisions);
        const { sha } = await putFile(DECISIONS_REPO, DECISIONS_PATH, serializeDecisions(retried), fresh.sha, message, token);
        setOwner({ decisions: retried, sha });
      }
    } catch (err) {
      if (err instanceof GitHubAuthError) {
        clearToken();
        setToken(null);
        setOwner(null);
        setError("token rejected — signed out");
      } else {
        setOwner(previous);
        setError(errorMessage(err));
      }
    } finally {
      setBusy(false);
    }
  }

  return {
    decisions: owner?.decisions ?? publicDecisions,
    signedIn: token !== null,
    canWrite: token !== null && owner !== null,
    busy,
    error,
    signIn,
    signOut,
    decide,
  };
}
