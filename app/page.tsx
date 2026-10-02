import { Fragment } from "react";
import Link from "next/link";
import { getAllPosts } from "@/lib/posts";
import { subtopics, topics } from "@/lib/topics";
import AgentWidget from "@/components/AgentWidget";
import ClaudePresence from "@/components/ClaudePresence";
import GitHubGrid from "@/components/GitHubGrid";
import LabCarousel from "@/components/LabCarousel";

export default function HomePage() {
  const posts = getAllPosts();

  return (
    <>
      <section id="hero">
        <div className="wrap">
          <div className="hero-card">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              className="avatar"
              src="/avatar.jpg"
              width={352}
              height={352}
              alt="Artem Polozov"
            />
            <div className="hero-id">
              <h1>Artem Polozov</h1>
              <p className="hero-roles">
                Web products · data visualization · systems integration · AI
                agent orchestration
              </p>
            </div>
            <nav className="hero-actions" aria-label="Contact">
              <a href="mailto:hypnosisflow@gmail.com">
                Email <span aria-hidden="true">↗</span>
              </a>
              <a href="https://github.com/hpnssflw">
                GitHub <span aria-hidden="true">↗</span>
              </a>
              <Link href="/now/">
                Now <span aria-hidden="true">→</span>
              </Link>
            </nav>
            <p className="hero-thesis accent">
              Understand how it fails, then build so it doesn&apos;t.
            </p>
            <div className="hero-now">
              <span className="hero-now-label">Claude Code</span>
              <ClaudePresence variant="inline" />
            </div>
            <GitHubGrid />
          </div>
        </div>
      </section>

      <div className="wrap home-columns">
        <section id="researcher">
          <p className="section-label">
            <Link href="/researcher/">Researcher</Link>:{" "}
            <span className="section-topics">
              {topics.map((topic, i) => (
                <Fragment key={topic.name}>
                  {i > 0 && ", "}
                  {topic.href ? (
                    <Link href={topic.href}>{topic.name}</Link>
                  ) : (
                    topic.name
                  )}
                </Fragment>
              ))}
              .
            </span>
          </p>
          <AgentWidget variant="compact" />
          <p className="subtopic-tags">{subtopics.join(", ")}.</p>
        </section>

        <section id="lab">
          <p className="section-label">
            <Link href="/lab/">
              Lab:{" "}
              <span className="section-topics">takes on experience.</span>
            </Link>
          </p>
          <LabCarousel posts={posts} />
        </section>
      </div>
    </>
  );
}
