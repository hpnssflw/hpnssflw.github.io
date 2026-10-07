import type { DigestBlocks } from "@/lib/digest";

/** A digest as the editor gets it in Telegram: bold header and topic
 * names, each item a linked title over its one-line summary. */
export default function DigestPanel({ digest, empty }: { digest: DigestBlocks; empty: string }) {
  if (digest.topics.length === 0) return <p className="agent-muted cr-digest-empty">{empty}</p>;
  return (
    <article className="cr-digest">
      <p>
        <b>
          {digest.title} — {digest.count}
        </b>
      </p>
      {digest.topics.map((topic) => (
        <section key={topic.name}>
          <p>
            <b>{topic.name}</b>
          </p>
          <ul>
            {topic.items.map((item) => (
              <li key={item.url}>
                •{" "}
                <a href={item.url} target="_blank" rel="noreferrer">
                  {item.title}
                </a>
                <br />
                {item.summary}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </article>
  );
}
