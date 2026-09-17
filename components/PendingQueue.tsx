"use client";

import { useEffect, useState } from "react";
import {
  type PendingQueue as PendingQueueData,
  PENDING_URL,
  groupByTopic,
  isPendingQueue,
} from "@/lib/pending-queue";

function Unavailable() {
  return <p className="agent-unavailable mono">queue unavailable</p>;
}

export default function PendingQueue() {
  const [queue, setQueue] = useState<PendingQueueData | null>(null);
  const [failed, setFailed] = useState(false);

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
    return () => {
      cancelled = true;
    };
  }, []);

  if (failed) return <Unavailable />;
  if (!queue) return null;

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
              {items.map((item) => (
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
                    </span>
                    <span className="title">{item.title}</span>
                    <span className="excerpt">{item.summary}</span>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
    </div>
  );
}
