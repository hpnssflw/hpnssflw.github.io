import { Fragment } from "react";
import type { DigestBlocks } from "@/lib/digest";
import { storyOf } from "@/lib/run-result";

/** A digest as the editor gets it in Telegram: bold header and topic
 * names, each item a title over its one-line summary — or, for a story,
 * over its facts (each with the [n] of the reports it cites; the summary
 * when there are none) and its "first" line, as agent/digest.py renders
 * it. Nothing is linked: this panel is the demo's, and the demo's URLs
 * are synthetic. */
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
            {topic.items.map((item) => {
              const story = storyOf(item);
              return (
                <li key={item.url}>
                  •{" "}
                  <span className="cr-digest-title">{item.title}</span>
                  {story && story.facts.length > 0 ? (
                    story.facts.map((fact) => (
                      <Fragment key={fact.text}>
                        <br />
                        {fact.text}{" "}
                        {fact.refs.map((n) => (
                          <span key={n}>[{n}]</span>
                        ))}
                      </Fragment>
                    ))
                  ) : (
                    <>
                      <br />
                      {item.summary}
                    </>
                  )}
                  {story?.first && (
                    <>
                      <br />
                      {story.first}
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </article>
  );
}
