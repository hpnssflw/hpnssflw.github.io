"use client";

import { useEffect, useState } from "react";
import {
  type PendingItem,
  type PendingQueue as PendingQueueData,
  PENDING_URL,
  groupByTopic,
  isPendingQueue,
} from "@/lib/pending-queue";
import {
  type Decision,
  type Decisions,
  type OwnerSnapshot,
  DECISIONS_PATH,
  DECISIONS_REPO,
  commitMessage,
  fetchOwnerDecisions,
  fetchPublicDecisions,
  itemStatus,
  pruneDecisions,
  serializeDecisions,
  setDecision,
} from "@/lib/inbox";
import { GitHubAuthError, GitHubConflictError, putFile } from "@/lib/github-contents";
import {
  InboxItemActions,
  InboxOwnerBar,
  clearToken,
  readToken,
  writeToken,
} from "@/components/InboxControls";

function Unavailable() {
  return <p className="agent-unavailable mono">queue unavailable</p>;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "something went wrong";
}

export default function PendingQueue() {
  const [queue, setQueue] = useState<PendingQueueData | null>(null);
  const [failed, setFailed] = useState(false);
  const [publicDecisions, setPublicDecisions] = useState<Decisions | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [owner, setOwner] = useState<OwnerSnapshot | null>(null);
  const [ownerError, setOwnerError] = useState<string | null>(null);
  const [busyUrl, setBusyUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(PENDING_URL, { cache: "no-store" })
      .then((res) => {
        if (!res.ok) throw new Error(`pending fetch failed: ${res.status}`);
        return res.json();
      })
      .then((data: unknown) => {
        if (cancelled) return;
        if (isPendingQueue(data)) setQueue(data);
        else setFailed(true);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

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
            setOwnerError("token rejected — signed out");
          } else {
            setToken(stored);
            setOwnerError(errorMessage(err));
          }
        });
    }

    return () => {
      cancelled = true;
    };
  }, []);

  async function signIn(candidate: string) {
    setOwnerError(null);
    try {
      const snapshot = await fetchOwnerDecisions(candidate);
      writeToken(candidate);
      setToken(candidate);
      setOwner(snapshot);
    } catch (err) {
      setOwnerError(err instanceof GitHubAuthError ? "token rejected — not saved" : errorMessage(err));
    }
  }

  function signOut() {
    clearToken();
    setToken(null);
    setOwner(null);
    setOwnerError(null);
  }

  async function decide(item: PendingItem, decision: Decision | null) {
    if (!token || !owner || !queue) return;
    const liveUrls = queue.items.map((i) => i.url);
    const apply = (base: Decisions) =>
      pruneDecisions(setDecision(base, item.url, decision, new Date()), liveUrls);
    const message = commitMessage(decision ?? "undo", item.title);
    const previous = owner;
    const optimistic = apply(previous.decisions);

    setBusyUrl(item.url);
    setOwnerError(null);
    setOwner({ decisions: optimistic, sha: previous.sha });
    try {
      try {
        const { sha } = await putFile(
          DECISIONS_REPO,
          DECISIONS_PATH,
          serializeDecisions(optimistic),
          previous.sha,
          message,
          token,
        );
        setOwner({ decisions: optimistic, sha });
      } catch (err) {
        if (!(err instanceof GitHubConflictError)) throw err;
        // Stale sha (e.g. another tab wrote first): re-read, re-apply, retry once.
        const fresh = await fetchOwnerDecisions(token);
        const retried = apply(fresh.decisions);
        const { sha } = await putFile(
          DECISIONS_REPO,
          DECISIONS_PATH,
          serializeDecisions(retried),
          fresh.sha,
          message,
          token,
        );
        setOwner({ decisions: retried, sha });
      }
    } catch (err) {
      if (err instanceof GitHubAuthError) {
        clearToken();
        setToken(null);
        setOwner(null);
        setOwnerError("token rejected — signed out");
      } else {
        setOwner(previous);
        setOwnerError(errorMessage(err));
      }
    } finally {
      setBusyUrl(null);
    }
  }

  if (failed) return <Unavailable />;
  if (!queue) return null;

  const decisions = owner?.decisions ?? publicDecisions;
  const lastSent = queue.last_email_at
    ? new Date(queue.last_email_at).toLocaleDateString()
    : "never";
  const grouped = groupByTopic(queue);

  return (
    <div id="pending-queue">
      <p className="agent-muted mono">
        {queue.items.length} queued · last sent {lastSent}
      </p>
      {queue.items.length === 0 ? (
        <p className="agent-muted">nothing queued right now</p>
      ) : (
        Object.entries(grouped).map(([topicName, items]) => (
          <div key={topicName}>
            <h2 className="section-label">{topicName}</h2>
            <ul className="feed">
              {items.map((item) => {
                const status = itemStatus(decisions, item.url);
                return (
                  <li key={item.url}>
                    <a href={item.url} target="_blank" rel="noreferrer">
                      <span className="meta">
                        <span className="mono date">
                          {new Date(item.pending_since).toLocaleDateString()}
                        </span>
                        <span className="mono sep">·</span>
                        <span className="mono tag">{item.source}</span>
                        <span className="mono sep">·</span>
                        <span className="mono tag">score {item.score}</span>
                        {decisions && (
                          <>
                            <span className="mono sep">·</span>
                            <span className={`mono tag inbox-status inbox-${status}`}>
                              {status}
                            </span>
                          </>
                        )}
                      </span>
                      <span className="title">{item.title}</span>
                      <span className="excerpt">{item.summary}</span>
                    </a>
                    {token && (
                      <InboxItemActions
                        status={status}
                        disabled={owner === null || busyUrl !== null}
                        onDecide={(d) => void decide(item, d)}
                      />
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))
      )}
      <InboxOwnerBar
        signedIn={token !== null}
        error={ownerError}
        onSignIn={signIn}
        onSignOut={signOut}
      />
    </div>
  );
}
