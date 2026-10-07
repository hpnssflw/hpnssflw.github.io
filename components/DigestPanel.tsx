import type { DigestBlocks } from "@/lib/digest";

/** A digest as the editor gets it in Telegram: bold header and topic
 * names, each item a title over its one-line summary. Titles aren't linked:
 * this panel is the demo's, and the demo's URLs are synthetic. */
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
                <span className="cr-digest-title">{item.title}</span>
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
